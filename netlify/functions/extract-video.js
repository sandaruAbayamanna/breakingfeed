// extract-video.js
// Fetches an article URL server-side and extracts video sources from:
//   - <video src> / <source src>
//   - og:video meta tags
//   - Twitter player meta
//   - YouTube/Vimeo embeds
//   - Common CDN video URL patterns in page HTML
//   - JSON-LD VideoObject schema

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
    const { url } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url" }) };

    console.log(`[ExtractVideo] Fetching: ${url}`);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching article`);
    const html = await res.text();
    const videos = [];

    // ── 1. og:video / og:video:url ──
    const ogMatches = [...html.matchAll(/property=["']og:video(?::url)?["']\s+content=["']([^"']+)["']/gi),
                       ...html.matchAll(/content=["']([^"']+)["']\s+property=["']og:video(?::url)?["']/gi)];
    for (const m of ogMatches) {
      const v = m[1]; if (v && isVideoUrl(v)) addVideo(videos, v, "og:video");
    }

    // ── 2. Twitter player / card ──
    const twMatches = [...html.matchAll(/name=["']twitter:player:stream["']\s+content=["']([^"']+)["']/gi),
                       ...html.matchAll(/content=["']([^"']+)["']\s+name=["']twitter:player:stream["']/gi)];
    for (const m of twMatches) addVideo(videos, m[1], "twitter:player");

    // ── 3. <video> / <source> tags ──
    const videoTagMatches = [...html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)];
    for (const m of videoTagMatches) if (isVideoUrl(m[1])) addVideo(videos, m[1], "video-tag");

    // ── 4. YouTube embeds ──
    const ytMatches = [...html.matchAll(/(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/g)];
    for (const m of ytMatches) addVideo(videos, `https://www.youtube.com/watch?v=${m[1]}`, "youtube");

    // ── 5. Vimeo embeds ──
    const vimeoMatches = [...html.matchAll(/vimeo\.com\/(?:video\/)?(\d{6,12})/g)];
    for (const m of vimeoMatches) addVideo(videos, `https://vimeo.com/${m[1]}`, "vimeo");

    // ── 6. JSON-LD VideoObject ──
    const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of jsonLdMatches) {
      try {
        const data = JSON.parse(m[1]);
        const items = Array.isArray(data) ? data : [data, ...(data["@graph"] || [])];
        for (const item of items) {
          if (item["@type"] === "VideoObject") {
            if (item.contentUrl) addVideo(videos, item.contentUrl, "json-ld");
            if (item.embedUrl)   addVideo(videos, item.embedUrl, "json-ld-embed");
          }
        }
      } catch {}
    }

    // ── 7. Raw MP4/WebM/M3U8 URLs in HTML ──
    const rawMatches = [...html.matchAll(/["'](https?:\/\/[^"']*\.(?:mp4|webm|m3u8|mov)(?:\?[^"']*)?)/gi)];
    for (const m of rawMatches) addVideo(videos, m[1], "raw-url");

    // ── 8. Common CDN patterns (Reuters, AP, AFP, BBC, etc.) ──
    const cdnPatterns = [
      /["'](https?:\/\/[^"']*(?:reuters|ap\.org|apnews|bbc\.co|aljazeera|cnn)[^"']*\.mp4[^"']*)/gi,
      /["'](https?:\/\/[^"']*brightcove[^"']*\.mp4[^"']*)/gi,
      /["'](https?:\/\/[^"']*jwplatform[^"']*\.mp4[^"']*)/gi,
      /["'](https?:\/\/[^"']*akamaihd[^"']*\.mp4[^"']*)/gi,
      /["'](https?:\/\/[^"']*cloudfront[^"']*\.mp4[^"']*)/gi,
    ];
    for (const pat of cdnPatterns) {
      const matches = [...html.matchAll(pat)];
      for (const m of matches) addVideo(videos, m[1], "cdn");
    }

    // Dedupe and return
    const unique = [...new Map(videos.map(v => [v.url, v])).values()];
    console.log(`[ExtractVideo] Found ${unique.length} video(s) at ${url}`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ videos: unique, total: unique.length }),
    };

  } catch (err) {
    console.error("[ExtractVideo Error]", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, videos: [] }) };
  }
};

function isVideoUrl(url) {
  return /\.(mp4|webm|mov|m3u8|avi|mkv)(\?|$)/i.test(url) ||
         url.includes("youtube.com") || url.includes("youtu.be") || url.includes("vimeo.com");
}

function addVideo(arr, url, source) {
  if (!url || url.length < 10) return;
  url = url.trim().replace(/&amp;/g, "&");
  if (!url.startsWith("http")) return;
  const isYT  = url.includes("youtube") || url.includes("youtu.be");
  const isVim = url.includes("vimeo.com");
  const isM3U = url.includes(".m3u8");
  arr.push({
    url,
    source,
    type: isYT ? "youtube" : isVim ? "vimeo" : isM3U ? "hls" : "direct",
    label: isYT ? "YouTube Video" : isVim ? "Vimeo Video" : isM3U ? "HLS Stream" : url.split("/").pop().split("?")[0].slice(0, 40),
  });
}
