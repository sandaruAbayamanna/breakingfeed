// fetch-video-rss.js — Video-rich RSS feeds with confirmed MP4/HLS enclosures
// Tier 1: Feeds that reliably publish direct video URLs in RSS
// Tier 2: Odysee/PeerTube MRSS with full MP4 direct links

const VIDEO_FEEDS = [

  // ── TIER 1: Confirmed video enclosures in RSS ──
  {
    name: "Al Jazeera",
    url:  "https://www.aljazeera.com/xml/rss/all.xml",
    videoTag: "media:content", // publishes mp4 via media:content
  },
  {
    name: "DW News Video",
    url:  "https://rss.dw.com/rdf/rss-en-top",
    videoTag: "enclosure",
  },
  {
    name: "AP News",
    url:  "https://feeds.apnews.com/rss/apf-topnews",
    videoTag: "media:content",
  },
  {
    name: "VOA News",
    url:  "https://gdb.voanews.com/rss/english/topstories.xml",
    videoTag: "enclosure",
  },
  {
    name: "France 24",
    url:  "https://www.france24.com/en/rss",
    videoTag: "media:content",
  },
  {
    name: "RFI English",
    url:  "https://www.rfi.fr/en/rss",
    videoTag: "enclosure",
  },
  {
    name: "Defence Blog",
    url:  "https://defence-blog.com/feed/",
    videoTag: "enclosure",
  },
  {
    name: "The War Zone",
    url:  "https://www.thedrive.com/the-war-zone/feed",
    videoTag: "media:content",
  },
  {
    name: "Military Times",
    url:  "https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml",
    videoTag: "enclosure",
  },
  {
    name: "Al Jazeera War",
    url:  "https://www.aljazeera.com/xml/rss/news.xml",
    videoTag: "media:content",
  },

  // ── TIER 2: Odysee MRSS — direct MP4 links guaranteed ──
  {
    name: "Odysee War News",
    url:  "https://odysee.com/$/rss/@WarNews247:5",
    videoTag: "enclosure",
    mrss: true,
  },
  {
    name: "Odysee Conflict",
    url:  "https://odysee.com/$/rss/@ConflictNews:f",
    videoTag: "enclosure",
    mrss: true,
  },

  // ── TIER 3: Newsfeed RSS with video articles ──
  {
    name: "Reuters Video",
    url:  "https://feeds.reuters.com/Reuters/worldNews",
    videoTag: "media:content",
  },
  {
    name: "Sky News Video",
    url:  "https://feeds.skynews.com/feeds/rss/world.xml",
    videoTag: "media:content",
  },
  {
    name: "Euronews",
    url:  "https://www.euronews.com/rss?format=mrss&level=theme&name=news",
    videoTag: "media:content",
    mrss: true,
  },
];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { query, videoOnly } = JSON.parse(event.body || "{}");
    const kw = (query || "").toLowerCase().split(/\s+or\s+|\s*,\s*|\s+/).map(k => k.trim()).filter(Boolean);

    console.log(`[video-rss] Fetching ${VIDEO_FEEDS.length} feeds, query: "${query}", videoOnly: ${videoOnly}`);

    const results = await Promise.allSettled(
      VIDEO_FEEDS.map(f => fetchVideoFeed(f))
    );

    let articles = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        console.log(`[video-rss] ${VIDEO_FEEDS[i].name}: ${r.value.length} items`);
        articles.push(...r.value);
      } else {
        console.log(`[video-rss] ${VIDEO_FEEDS[i].name} failed: ${r.reason?.message || r.reason}`);
      }
    });

    // Filter: only articles with video URL if videoOnly mode
    if (videoOnly) {
      articles = articles.filter(a => a.video_url);
    }

    // Keyword filter
    if (kw.length) {
      articles = articles.filter(a => {
        const text = (a.title + " " + (a.description || "")).toLowerCase();
        return kw.some(k => text.includes(k));
      });
    }

    // Dedupe + sort
    const seen = new Set();
    articles = articles
      .filter(a => {
        if (!a.title || seen.has(a.url)) return false;
        seen.add(a.url);
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 120);

    const withVideo = articles.filter(a => a.video_url).length;
    console.log(`[video-rss] Total: ${articles.length} articles, ${withVideo} with direct video`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ status: "ok", totalResults: articles.length, withVideo, articles })
    };

  } catch (err) {
    console.error("[video-rss] Error:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ status: "error", message: err.message, articles: [] }) };
  }
};

async function fetchVideoFeed(feed) {
  const PROXIES = [
    url => url, // direct
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    url => `https://rss2json.com/api.json?rss_url=${encodeURIComponent(url)}`,
  ];

  let xml = "";
  let useRss2json = false;

  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const proxyUrl = PROXIES[i](feed.url);
      const res = await fetchT(proxyUrl, 10000, {
        "User-Agent": "Mozilla/5.0 (compatible; FeedFetcher/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, application/json, */*",
      });
      if (!res.ok) continue;

      if (i === 2) { // rss2json
        const data = await res.json();
        if (data.status === "ok" && data.items?.length) {
          return data.items.map(item => normaliseRss2jsonItem(item, feed));
        }
        continue;
      }

      const text = await res.text();
      if (i === 1) { // allorigins wrapper
        try {
          const wrapper = JSON.parse(text);
          xml = wrapper.contents || "";
        } catch { xml = text; }
      } else {
        xml = text;
      }

      if (xml && !xml.trim().startsWith("<!DOCTYPE html")) break;
      xml = "";
    } catch (e) {
      console.log(`[video-rss] ${feed.name} proxy ${i} failed: ${e.message}`);
    }
  }

  if (!xml) return [];
  return parseVideoXml(xml, feed);
}

function normaliseRss2jsonItem(item, feed) {
  // rss2json normalises enclosures into item.enclosure
  const enc = item.enclosure || {};
  const isVideo = enc.type?.includes("video") || enc.link?.match(/\.(mp4|webm|m3u8|mov)/i);
  const videoUrl = isVideo ? enc.link : null;
  const imageUrl = (!isVideo && enc.type?.includes("image") ? enc.link : null)
                || item.thumbnail
                || extractImage(item.description || "");

  return {
    title:       stripHtml(item.title || ""),
    description: stripHtml(item.description || "").slice(0, 280),
    url:         item.link || item.guid || "",
    urlToImage:  imageUrl,
    video_url:   videoUrl,
    publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    source:      { id: sanitizeId(feed.name), name: feed.name },
    _hasVideo:   !!videoUrl,
    _videoSource:"rss",
  };
}

function parseVideoXml(xml, feed) {
  const articles = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];

  for (const item of items) {
    const title    = decodeXml(extract(item, /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/));
    const link     = extract(item, /<link[^>]*>(.*?)<\/link>/) || extract(item, /<guid[^>]*>(.*?)<\/guid>/);
    const pubDate  = extract(item, /<pubDate[^>]*>(.*?)<\/pubDate>/) || extract(item, /<dc:date[^>]*>(.*?)<\/dc:date>/);
    const desc     = decodeXml(extract(item, /<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || "").slice(0, 280);

    if (!title || !link) continue;

    // ── Extract video URL using multiple strategies ──
    let videoUrl = null;

    // Strategy 1: enclosure with video type
    const encMatch = item.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']video[^"']*["']/i)
                  || item.match(/<enclosure[^>]+type=["']video[^"']*["'][^>]+url=["']([^"']+)["']/i)
                  || item.match(/<enclosure[^>]+url=["']([^"'.]+\.(?:mp4|webm|m3u8|mov)[^"']*)["']/i);
    if (encMatch?.[1]) videoUrl = encMatch[1];

    // Strategy 2: media:content with video type
    if (!videoUrl) {
      const mcMatch = item.match(/<media:content[^>]+url=["']([^"']+)["'][^>]*type=["']video[^"']*["']/i)
                   || item.match(/<media:content[^>]+type=["']video[^"']*["'][^>]+url=["']([^"']+)["']/i)
                   || item.match(/<media:content[^>]+url=["']([^"'.]+\.(?:mp4|webm|m3u8)[^"']*)["']/i);
      if (mcMatch?.[1]) videoUrl = mcMatch[1];
    }

    // Strategy 3: media:group → media:content
    if (!videoUrl) {
      const groupMatch = item.match(/<media:group[^>]*>([\s\S]*?)<\/media:group>/i);
      if (groupMatch) {
        const inner = groupMatch[1];
        const vMatch = inner.match(/url=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/i);
        if (vMatch?.[1]) videoUrl = vMatch[1];
      }
    }

    // Strategy 4: Odysee / PeerTube MRSS direct link
    if (!videoUrl && feed.mrss) {
      const mrssMatch = item.match(/<link[^>]*>([^<]+\.(?:mp4|webm)[^<]*)<\/link>/i);
      if (mrssMatch?.[1]) videoUrl = mrssMatch[1];
    }

    // Strategy 5: any mp4/m3u8 URL anywhere in item
    if (!videoUrl) {
      const rawMatch = item.match(/https?:\/\/[^"'\s<>]+\.(?:mp4|webm|m3u8)(?:[^"'\s<>]*)/i);
      if (rawMatch?.[0]) videoUrl = rawMatch[0];
    }

    // Extract thumbnail
    const thumbMatch = item.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
                    || item.match(/<media:content[^>]+url=["']([^"'.]+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    const imageUrl = thumbMatch?.[1] || extractImage(desc);

    articles.push({
      title:       stripHtml(title),
      description: stripHtml(desc),
      url:         link.trim(),
      urlToImage:  imageUrl || null,
      video_url:   videoUrl || null,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source:      { id: sanitizeId(feed.name), name: feed.name },
      _hasVideo:   !!videoUrl,
      _videoSource:"rss",
    });
  }

  return articles;
}

function extract(str, regex) {
  const m = str.match(regex);
  return m ? m[1].trim() : null;
}

function stripHtml(str) {
  return (str || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(str) {
  return (str || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function extractImage(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
  return m?.[1] || null;
}

function sanitizeId(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

async function fetchT(url, ms, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders },
    });
  } finally { clearTimeout(timer); }
}
