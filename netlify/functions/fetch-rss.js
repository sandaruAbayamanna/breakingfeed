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
    const { query, lkOnly, lkLang } = JSON.parse(event.body || "{}");

    // ── RSS FEEDS — tested reliable sources ──
    const RSS_FEEDS = [
      // ── INTERNATIONAL ──
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

      // ── SRI LANKA — English ──
      { name: "Daily Mirror LK",    url: "https://www.dailymirror.lk/rss.xml" },
      { name: "Daily FT",           url: "https://www.ft.lk/rss.xml" },
      { name: "The Morning LK",     url: "https://www.themorning.lk/feed/" },
      { name: "Ceylon Today",       url: "https://ceylontoday.lk/feed/" },
      { name: "NewsFirst LK",       url: "https://www.newsfirst.lk/feed/" },
      { name: "Ada Derana English", url: "https://www.adaderana.lk/rss.php" },
      { name: "Hiru News English",  url: "https://www.hirunews.lk/english/rss.xml" },
      { name: "Sunday Times LK",    url: "https://www.sundaytimes.lk/feed/" },
      { name: "Island Online",      url: "https://island.lk/feed/" },
      { name: "Economy Next",       url: "https://economynext.com/feed/" },
      { name: "Colombo Gazette",    url: "https://colombogazette.com/feed/" },
      { name: "Lanka Business",     url: "https://www.lankabusinessonline.com/feed/" },

      // ── SRI LANKA — Sinhala ──
      { name: "Ada Derana සිංහල",  url: "https://sinhala.adaderana.lk/rss.php" },
      { name: "Hiru News සිංහල",   url: "https://www.hirunews.lk/sinhala/rss.xml" },
      { name: "Lankadeepa",         url: "https://www.lankadeepa.lk/rss.xml" },
      { name: "Divaina",            url: "https://www.divaina.lk/rss.xml" },
      { name: "Mawbima",            url: "https://www.mawbima.lk/rss.xml" },
      { name: "Silumina",           url: "https://www.silumina.lk/rss.xml" },

      // ── SRI LANKA — Tamil ──
      { name: "Thinakkural",        url: "https://www.thinakkural.lk/feed/" },
      { name: "Virakesari",         url: "https://www.virakesari.lk/feed/" },

      // ── SRI LANKA — Extra verified feeds ──
      { name: "LankaWeb",           url: "https://www.lankaweb.com/news/feed/" },
      { name: "NewsWire LK",        url: "https://www.newswire.lk/feed/" },
      { name: "Ceylon News",        url: "https://ceylonnews.net/feed/" },
    ];

    // Fetch all feeds in parallel using rss2json proxy + direct fallback
    // Sinhala-only sources
    const SI_SOURCES = ['Ada Derana සිංහල','Hiru News සිංහල','Lankadeepa','Divaina','Mawbima','Silumina'];

    // Select which feeds to fetch
    let feedsToFetch;
    if(lkLang === 'si') {
      // Only Sinhala sources — guaranteed to have Sinhala content
      feedsToFetch = RSS_FEEDS.filter(f => SI_SOURCES.includes(f.name));
    } else if(lkOnly) {
      feedsToFetch = RSS_FEEDS.filter(f => f.name.includes('LK') || f.name.includes('Lanka') || 
          f.name.includes('Ceylon') || f.name.includes('Derana') || 
          f.name.includes('Hiru') || f.name.includes('Lankadeepa') ||
          f.name.includes('Divaina') || f.name.includes('Mawbima') ||
          f.name.includes('Silumina') || f.name.includes('Thinakkural') ||
          f.name.includes('Virakesari') || f.name.includes('Sunday Times') ||
          f.name.includes('Island') || f.name.includes('Morning') ||
          f.name.includes('NewsWire') || f.name.includes('LankaWeb') ||
          f.name.includes('Colombo') || f.name.includes('Economy Next') ||
          f.name.includes('සිංහල') || f.name.includes('NewsFirst'));
    } else {
      feedsToFetch = RSS_FEEDS;
    }

    const results = await Promise.allSettled(
      feedsToFetch.map(feed => fetchWithFallback(feed))
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

    // Filter by query keywords — skip for Sinhala sources (text won't match English keywords)
    if (!lkLang && query && query.trim()) {
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
        articles: deduped.slice(0, 100),
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
  const enc = item.enclosure || {};
  const isVideoEnc = enc.type && enc.type.includes('video');
  const videoUrl = isVideoEnc ? enc.link : extractVideoFromHtml(item.description || item.content || '');
  const imageUrl = (!isVideoEnc && enc.link && enc.type?.includes('image') ? enc.link : null)
                || item.thumbnail
                || extractImageFromHtml(item.description || item.content || '');
  return {
    title:       clean(item.title || ''),
    description: clean(stripHtml(item.description || item.content || '')).slice(0, 300),
    url:         item.link || item.guid || '',
    urlToImage:  imageUrl,
    video_url:   videoUrl || null,
    publishedAt: normalizeDate(item.pubDate),
    source:      { name: sourceName },
    _provider:   'rss',
    _hasVideo:   !!videoUrl,
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

      const videoUrl = extractVideoUrl(block);
      articles.push({
        title,
        description: desc.slice(0, 300),
        url:         link.trim(),
        urlToImage:  videoUrl ? null : image,  // if has video, image is secondary
        video_url:   videoUrl || null,
        publishedAt: normalizeDate(date),
        source:      { name: sourceName },
        _provider:   'rss',
        _hasVideo:   !!videoUrl,
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
    /media:content[^>]+url=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["'](?![^>]*type=["']video)/i,
    /media:thumbnail[^>]+url=["']([^"']+)["']/i,
    /enclosure[^>]+url=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["'][^>]*type=["']image/i,
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m) return m[1];
  }
  return null;
}

// Extract direct video URL from RSS item XML
function extractVideoUrl(xml) {
  const patterns = [
    // enclosure with video type
    /enclosure[^>]+url=["']([^"']+\.(?:mp4|webm|mov|m3u8|ts)[^"']*)["']/i,
    /enclosure[^>]+type=["']video[^"']*["'][^>]*url=["']([^"']+)["']/i,
    /enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']video/i,
    // media:content with video type
    /media:content[^>]+url=["']([^"']+\.(?:mp4|webm|mov|m3u8)[^"']*)["']/i,
    /media:content[^>]+type=["']video[^"']*["'][^>]*url=["']([^"']+)["']/i,
    /media:content[^>]+url=["']([^"']+)["'][^>]*type=["']video/i,
    // media:video
    /media:video[^>]+url=["']([^"']+)["']/i,
    // jwplayer or similar embed patterns
    /file:\s*["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/i,
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// Extract video URL embedded in HTML description
function extractVideoFromHtml(html) {
  const patterns = [
    /<video[^>]+src=["']([^"']+\.(?:mp4|webm|mov)[^"']*)["']/i,
    /source[^>]+src=["']([^"']+\.(?:mp4|webm|mov)[^"']*)["']/i,
    /"contentUrl"\s*:\s*"([^"]+\.(?:mp4|webm|mov)[^"]*)"/i,
    /videoUrl["\s]*:\s*["']([^"']+\.(?:mp4|webm)[^"']*)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
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
