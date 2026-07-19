// fetch-yt-feeds.js — YouTube channel RSS feed fetcher
// YouTube RSS: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
// Returns latest videos as BreakingFeed article format with video_url = YouTube watch URL

const YT_CHANNELS = [
  // ── WAR / CONFLICT / WORLD ──
  { name: "Al Jazeera English",  id: "UCNye-wNBqNL5ZzHSJdpkiRg" },
  { name: "DW News",             id: "UCknLrEdhRCp1aegoMqRaCZg" },
  { name: "France 24 English",   id: "UCQfwfsi5VrQ8yKZ-UWmAEFg" },
  { name: "Sky News",            id: "UCoMdktPbSTixAyNGwb-UYkQ" },
  { name: "WION",                id: "UCstDUFdqwezsoR-6pXmQWlg" },
  { name: "CNN",                 id: "UCupvZG-5ko_eiXAupbDfxWw" },
  { name: "BBC News",            id: "UCnye-wNBqNL5ZzHSJdpkiRg" },
  { name: "Reuters",             id: "UCkufJgM8Qfm0cV8L5-lFNqw" },
  { name: "AP News",             id: "UC_1D29DF5oLuEn95cGwbq2g" },
  { name: "TRT World",           id: "UC7fWeaHhqgM4Ry-RMpM2YYw" },
  { name: "Euronews",            id: "UCeg5D_UhBHhIL8j-zPqHeNg" },
  { name: "Times of India",      id: "UCmxI4MLBELBkALx6rOqLOWw" },
  // ── SRI LANKA ──
  { name: "Ada Derana",          id: "UCnpWGSX-4XTDJ-ZqbNQQO1g" },
  { name: "Hiru News",           id: "UCBqU9bASdMl0Gg_pSZRSiog" },
  { name: "Newsfirst LK",        id: "UCHRp19HU7Y2LwfI0Ai6WAGQ" },
  { name: "Sirasa TV",           id: "UCF9T8RObhDYMpbLI-ZWQTOw" },
];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { query, lkOnly } = JSON.parse(event.body || "{}");
    const kw = (query || "").toLowerCase().split(/\s+or\s+|\s*,\s*|\s+/).filter(Boolean);

    // Pick channels to fetch
    const channels = lkOnly
      ? YT_CHANNELS.filter(c => ["Ada Derana","Hiru News","Newsfirst LK","Sirasa TV"].includes(c.name))
      : YT_CHANNELS;

    console.log(`[yt-feeds] Fetching ${channels.length} channels, query: "${query}"`);

    const results = await Promise.allSettled(
      channels.map(ch => fetchChannelFeed(ch))
    );

    let articles = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.length) {
        articles.push(...r.value);
      } else if (r.status === "rejected") {
        console.log(`[yt-feeds] ${channels[i].name} failed: ${r.reason}`);
      }
    });

    // Filter by keyword if provided
    if (kw.length) {
      articles = articles.filter(a => {
        const text = (a.title + " " + (a.description || "")).toLowerCase();
        return kw.some(k => text.includes(k));
      });
    }

    // Sort newest first, dedupe by URL
    const seen = new Set();
    articles = articles
      .filter(a => { if(seen.has(a.url)) return false; seen.add(a.url); return true; })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 100);

    console.log(`[yt-feeds] Total: ${articles.length} videos`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ status: "ok", totalResults: articles.length, articles })
    };

  } catch (err) {
    console.error("[yt-feeds] Error:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ status: "error", message: err.message, articles: [] }) };
  }
};

async function fetchChannelFeed(channel) {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;

  // Try direct first, then via allorigins proxy
  let xml = "";
  try {
    const res = await fetchT(rssUrl, 8000, {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
    });
    if (res.ok) xml = await res.text();
  } catch {}

  if (!xml || xml.includes("<!DOCTYPE html")) {
    try {
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
      const res = await fetchT(proxy, 10000, { "User-Agent": "Mozilla/5.0" });
      if (res.ok) {
        const data = await res.json();
        xml = data.contents || "";
      }
    } catch {}
  }

  if (!xml) return [];

  return parseYtXml(xml, channel.name);
}

function parseYtXml(xml, channelName) {
  const articles = [];

  // Each entry in YouTube RSS
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  for (const entry of entries) {
    const videoId  = extract(entry, /<yt:videoId>(.*?)<\/yt:videoId>/);
    const title    = decodeHtml(extract(entry, /<title>(.*?)<\/title>/) || "");
    const pubDate  = extract(entry, /<published>(.*?)<\/published>/);
    const desc     = decodeHtml(extract(entry, /<media:description>([\s\S]*?)<\/media:description>/) || "").slice(0, 250);
    const thumb    = extract(entry, /<media:thumbnail[^>]+url="([^"]+)"/) ||
                     (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);

    if (!videoId || !title) continue;

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    articles.push({
      title,
      description: desc || `${channelName} — Watch on YouTube`,
      url: watchUrl,
      urlToImage: thumb,
      video_url: watchUrl,   // marks it as video content
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source: { id: `yt-${channelName.toLowerCase().replace(/\s+/g,"-")}`, name: channelName },
      _ytVideo: true,
      _ytVideoId: videoId,
      _hasVideo: true,
    });
  }

  return articles;
}

function extract(str, regex) {
  const m = str.match(regex);
  return m ? m[1].trim() : null;
}

function decodeHtml(str) {
  return str.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
            .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,"");
}

async function fetchT(url, ms, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders } });
  } finally { clearTimeout(timer); }
}
