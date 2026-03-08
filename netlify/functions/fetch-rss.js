// fetch-rss.js — Real-time RSS via multiple reliable proxy methods
// Uses rss2json.com (free, no key) + direct fetch fallback
// Zero delay, no API key needed

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
    const { query } = JSON.parse(event.body || "{}");

    // ── RSS FEEDS — tested reliable sources ──
    const RSS_FEEDS = [
      // These work reliably server-side
      { name: "BBC World",          url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
      { name: "BBC Top Stories",    url: "https://feeds.bbci.co.uk/news/rss.xml" },
      { name: "Al Jazeera",         url: "https://www.aljazeera.com/xml/rss/all.xml" },
      { name: "Reuters",            url: "https://feeds.reuters.com/reuters/worldNews" },
      { name: "Sky News",           url: "https://feeds.skynews.com/feeds/rss/world.xml" },
      { name: "The Guardian",       url: "https://www.theguardian.com/world/rss" },
      { name: "DW News",            url: "https://rss.dw.com/xml/rss-en-all" },
      { name: "France24",           url: "https://www.france24.com/en/rss" },
      { name: "Middle East Eye",    url: "https://www.middleeasteye.net/rss" },
      { name: "NPR World",          url: "https://feeds.npr.org/1004/rss.xml" },
      { name: "VOA News",           url: "https://www.voanews.com/api/z-q-oqevei_t" },
      { name: "CNN World",          url: "http://rss.cnn.com/rss/edition_world.rss" },
      { name: "Times of India",     url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms" },
      { name: "NDTV World",         url: "https://feeds.feedburner.com/ndtvnews-world-news" },
      { name: "Euronews",           url: "https://www.euronews.com/rss?format=mrss&level=theme&name=news" },
    ];

    // Fetch all feeds in parallel using rss2json proxy + direct fallback
    const results = await Promise.allSettled(
      RSS_FEEDS.map(feed => fetchWithFallback(feed))
    );

    let allArticles = [];
    let successCount = 0;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value?.length) {
        allArticles.push(...result.value);
        successCount++;
      }
    }

    console.log(`[RSS] ${successCount}/${RSS_FEEDS.length} feeds OK, ${allArticles.length} raw articles`);

    // Filter by query keywords
    if (query && query.trim()) {
      const keywords = query.toLowerCase()
        .split(/\s+OR\s+|\s*,\s*/)
        .map(k => k.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      
      allArticles = allArticles.filter(a => {
        const text = (a.title + " " + (a.description||"")).toLowerCase();
        return keywords.some(k => text.includes(k));
      });
    }

    // Sort newest first
    allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Dedupe by URL and title
    const seenUrls = new Set();
    const seenTitles = new Set();
    const deduped = allArticles.filter(a => {
      const titleKey = a.title.slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seenUrls.has(a.url) || seenTitles.has(titleKey)) return false;
      seenUrls.add(a.url);
      seenTitles.add(titleKey);
      return true;
    });

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ 
        status: "ok", 
        totalResults: deduped.length, 
        articles: deduped.slice(0, 60),
        meta: { feedsOk: successCount, feedsTotal: RSS_FEEDS.length }
      }),
    };

  } catch (err) {
    console.error("[fetch-rss]", err.message);
    return { 
      statusCode: 500, headers, 
      body: JSON.stringify({ status: "error", message: err.message, articles: [] }) 
    };
  }
};

// ══════════════════════════════════════════
// FETCH WITH MULTIPLE FALLBACK METHODS
// ══════════════════════════════════════════
async function fetchWithFallback(feed) {
  // Method 1: rss2json.com free proxy (most reliable, handles CORS & blocked feeds)
  try {
    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}&count=20`;
    const res = await fetchWithTimeout(proxyUrl, 7000);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok" && data.items?.length) {
        return data.items.map(item => normaliseRss2json(item, feed.name));
      }
    }
  } catch {}

  // Method 2: Direct fetch with browser-like headers
  try {
    const res = await fetchWithTimeout(feed.url, 7000, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    });
    if (res.ok) {
      const xml = await res.text();
      const parsed = parseXML(xml, feed.name);
      if (parsed.length) return parsed;
    }
  } catch {}

  // Method 3: allorigins.win proxy
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(feed.url)}`;
    const res = await fetchWithTimeout(proxyUrl, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data.contents) {
        const parsed = parseXML(data.contents, feed.name);
        if (parsed.length) return parsed;
      }
    }
  } catch {}

  return [];
}

async function fetchWithTimeout(url, ms, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ══════════════════════════════════════════
// NORMALISE rss2json.com response
// ══════════════════════════════════════════
function normaliseRss2json(item, sourceName) {
  return {
    title:       clean(item.title || ""),
    description: clean(stripHtml(item.description || item.content || "")).slice(0, 300),
    url:         item.link || item.guid || "",
    urlToImage:  item.thumbnail || item.enclosure?.link || extractImageFromHtml(item.description || ""),
    publishedAt: normalizeDate(item.pubDate),
    source:      { name: sourceName },
    _provider:   "rss",
  };
}

// ══════════════════════════════════════════
// PARSE RAW RSS/ATOM XML
// ══════════════════════════════════════════
function parseXML(xml, sourceName) {
  const articles = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || 
                     xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];

  for (const block of itemBlocks) {
    try {
      const title  = clean(extractTag(block, "title"));
      const link   = extractTag(block, "link") || extractAttr(block, "link", "href") || extractTag(block, "id");
      const desc   = clean(stripHtml(extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content") || ""));
      const date   = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated") || extractTag(block, "dc:date");
      const image  = extractImage(block) || extractImageFromHtml(extractTag(block, "description") || "");

      if (!title || !link) continue;

      articles.push({
        title,
        description: desc.slice(0, 300),
        url:         link.trim(),
        urlToImage:  image,
        publishedAt: normalizeDate(date),
        source:      { name: sourceName },
        _provider:   "rss",
      });
    } catch {}
  }
  return articles;
}

// ══════════════════════════════════════════
// XML HELPERS
// ══════════════════════════════════════════
function extractTag(xml, tag) {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, "i"));
  return m ? m[1] : "";
}

function extractImage(xml) {
  const patterns = [
    /media:content[^>]+url=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/i,
    /media:thumbnail[^>]+url=["']([^"']+)["']/i,
    /enclosure[^>]+url=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/i,
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractImageFromHtml(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/i);
  return m ? m[1] : null;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function clean(text) {
  return (text || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    // Remove any raw URLs that leaked into title/text
    .replace(/https?:\/\/[^\s<>"')]+/g, "")
    // Remove leftover XML/HTML tags
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(str) {
  if (!str) return new Date().toISOString();
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}
