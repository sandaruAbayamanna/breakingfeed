// fetch-rss.js — Fetch and parse RSS feeds from major news outlets
// Zero delay, no API key, completely free, updates every few minutes

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { feeds, query } = JSON.parse(event.body || "{}");

    // Default feeds — all real-time, zero delay
    const RSS_FEEDS = feeds || [
      // ── WAR / CONFLICT / BREAKING ──
      { name: "Al Jazeera",        url: "https://www.aljazeera.com/xml/rss/all.xml",                  category: "war" },
      { name: "Al Jazeera War",    url: "https://www.aljazeera.com/xml/rss/all.xml",                  category: "war" },
      { name: "Reuters World",     url: "https://feeds.reuters.com/reuters/worldNews",                 category: "world" },
      { name: "Reuters Top News",  url: "https://feeds.reuters.com/reuters/topNews",                   category: "breaking" },
      { name: "BBC World",         url: "https://feeds.bbci.co.uk/news/world/rss.xml",                 category: "world" },
      { name: "BBC Top Stories",   url: "https://feeds.bbci.co.uk/news/rss.xml",                       category: "breaking" },
      { name: "AP Top News",       url: "https://rsshub.app/apnews/topics/ap-top-news",               category: "breaking" },
      { name: "AP World",          url: "https://rsshub.app/apnews/topics/world-news",                category: "world" },
      { name: "Sky News",          url: "https://feeds.skynews.com/feeds/rss/world.xml",              category: "world" },
      { name: "CNN World",         url: "http://rss.cnn.com/rss/edition_world.rss",                    category: "world" },
      { name: "The Guardian World",url: "https://www.theguardian.com/world/rss",                      category: "world" },
      { name: "DW News",           url: "https://rss.dw.com/xml/rss-en-all",                          category: "world" },
      { name: "France24",          url: "https://www.france24.com/en/rss",                            category: "world" },
      { name: "Middle East Eye",   url: "https://www.middleeasteye.net/rss",                          category: "war" },
      { name: "Times of India",    url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms", category: "world" },
    ];

    // Fetch all feeds in parallel (with timeout)
    const results = await Promise.allSettled(
      RSS_FEEDS.map(feed => fetchFeed(feed))
    );

    // Collect all articles
    let allArticles = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        allArticles.push(...result.value);
      }
    }

    // Filter by query keywords if provided
    if (query && query.trim()) {
      const keywords = query.toLowerCase().split(/\s+OR\s+|\s+AND\s+|,/).map(k => k.trim()).filter(Boolean);
      allArticles = allArticles.filter(a => {
        const text = (a.title + " " + a.description).toLowerCase();
        return keywords.some(k => text.includes(k));
      });
    }

    // Sort by date — newest first
    allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Dedupe by title similarity
    const seen = new Set();
    const deduped = allArticles.filter(a => {
      const key = a.title.slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    console.log(`[RSS] Fetched ${deduped.length} articles from ${RSS_FEEDS.length} feeds`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ status: "ok", totalResults: deduped.length, articles: deduped.slice(0, 50) }),
    };

  } catch (err) {
    console.error("[fetch-rss]", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ status: "error", message: err.message, articles: [] }) };
  }
};

// ══════════════════════════════════════
// FETCH + PARSE A SINGLE RSS FEED
// ══════════════════════════════════════
async function fetchFeed(feed) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout per feed

    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSS(xml, feed.name, feed.category);

  } catch (err) {
    console.warn(`[RSS] Failed ${feed.name}: ${err.message}`);
    return [];
  }
}

// ══════════════════════════════════════
// RSS XML PARSER (no dependencies)
// ══════════════════════════════════════
function parseRSS(xml, sourceName, category) {
  const articles = [];

  // Extract <item> blocks
  const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];

  for (const item of itemMatches) {
    try {
      const title       = extractTag(item, "title");
      const link        = extractTag(item, "link") || extractAttr(item, "link", "href");
      const description = stripHtml(extractTag(item, "description") || extractTag(item, "summary") || "");
      const pubDate     = extractTag(item, "pubDate") || extractTag(item, "published") || extractTag(item, "dc:date") || new Date().toISOString();
      const image       = extractImage(item);

      if (!title || !link) continue;
      if (title.trim() === "") continue;

      articles.push({
        title:       cleanText(title),
        description: cleanText(description).slice(0, 300),
        url:         link.trim(),
        urlToImage:  image,
        publishedAt: normalizeDate(pubDate),
        source:      { name: sourceName },
        _provider:   "rss",
        _category:   category,
      });
    } catch {}
  }

  return articles;
}

function extractTag(xml, tag) {
  // Handle CDATA and regular content
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return "";
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, "i"));
  return m ? m[1] : "";
}

function extractImage(item) {
  // Try media:content, enclosure, og tags
  const patterns = [
    /media:content[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
    /enclosure[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
    /<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
  ];
  for (const p of patterns) {
    const m = item.match(p);
    if (m) return m[1];
  }
  return null;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function normalizeDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}
