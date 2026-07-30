// extract-video.js — Aggressive video extractor from article pages
// Tries 8 strategies to find direct MP4/HLS/WebM URLs from any news article

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url" }) };

    console.log(`[extract-video] Extracting from: ${url}`);

    // Fetch the article page
    let html = "";
    const origin = (() => { try { return new URL(url).origin; } catch { return ""; } })();

    // Try direct fetch first, then allorigins proxy
    for (const fetchUrl of [url, `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`]) {
      try {
        const res = await fetchT(fetchUrl, 12000, {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122",
          "Accept": "text/html,application/xhtml+xml,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": origin,
        });
        if (!res.ok) continue;
        const text = await res.text();
        // Handle allorigins wrapper
        if (fetchUrl.includes("allorigins")) {
          try { html = JSON.parse(text).contents || ""; } catch { html = text; }
        } else {
          html = text;
        }
        if (html && html.length > 500) break;
      } catch (e) {
        console.log(`[extract-video] Fetch failed: ${e.message}`);
      }
    }

    if (!html) {
      return { statusCode: 200, headers, body: JSON.stringify({ videos: [], images: [], error: "Could not fetch page" }) };
    }

    const videos = [];
    const seen = new Set();

    function addVideo(url, label, type, source) {
      if (!url || seen.has(url)) return;
      // Skip obvious non-video URLs
      if (url.match(/\.(jpg|jpeg|png|gif|webp|svg|css|js|woff|ico)$/i)) return;
      seen.add(url);
      const isYT  = url.includes("youtube.com") || url.includes("youtu.be");
      const isVim = url.includes("vimeo.com");
      const isDirect = url.match(/\.(mp4|webm|mov|avi|mkv)(\?|#|$)/i) || url.includes(".m3u8");
      videos.push({
        url, label: label || "Video",
        type: isYT ? "youtube" : isVim ? "vimeo" : isDirect ? "direct" : type || "embed",
        source,
      });
    }

    // ── Strategy 1: JSON-LD structured data ──
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of jsonLdMatches) {
      try {
        const data = JSON.parse(m[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item.contentUrl)     addVideo(item.contentUrl, item.name || "Video", "direct", "json-ld");
          if (item.embedUrl)       addVideo(item.embedUrl,   item.name || "Embed", "embed",  "json-ld");
          if (item.video?.contentUrl) addVideo(item.video.contentUrl, item.video.name || "Video", "direct", "json-ld");
          if (item["@type"] === "VideoObject") {
            addVideo(item.contentUrl || item.embedUrl, item.name || "Video", "direct", "json-ld");
          }
        }
      } catch {}
    }

    // ── Strategy 2: og:video and twitter:player meta tags ──
    const metaPatterns = [
      [/property=["']og:video["'][^>]+content=["']([^"']+)["']/gi, "og:video"],
      [/content=["']([^"']+)["'][^>]+property=["']og:video["']/gi, "og:video"],
      [/property=["']og:video:url["'][^>]+content=["']([^"']+)["']/gi, "og:video:url"],
      [/name=["']twitter:player["'][^>]+content=["']([^"']+)["']/gi, "twitter:player"],
      [/content=["']([^"']+)["'][^>]+name=["']twitter:player["']/gi, "twitter:player"],
    ];
    for (const [re, label] of metaPatterns) {
      for (const m of html.matchAll(re)) {
        addVideo(m[1], label, "embed", "meta-tag");
      }
    }

    // ── Strategy 3: HTML5 video tags ──
    for (const m of html.matchAll(/<video[^>]*>([\s\S]*?)<\/video>/gi)) {
      const block = m[0];
      // src on video tag
      const srcM = block.match(/src=["']([^"']+\.(?:mp4|webm|mov|m3u8)[^"']*)["']/i);
      if (srcM) addVideo(srcM[1], "Video", "direct", "html5-video");
      // source elements inside video
      for (const src of block.matchAll(/<source[^>]+src=["']([^"']+)["'][^>]*type=["']video[^"']*["']/gi)) {
        addVideo(src[1], "Video Source", "direct", "html5-source");
      }
      for (const src of block.matchAll(/<source[^>]+src=["']([^"'.]+\.(?:mp4|webm|m3u8)[^"']*)["']/gi)) {
        addVideo(src[1], "Video Source", "direct", "html5-source");
      }
    }

    // ── Strategy 4: Standalone source tags ──
    for (const m of html.matchAll(/<source[^>]+src=["']([^"']+)["'][^>]*type=["']video/gi)) {
      addVideo(m[1], "Source", "direct", "source-tag");
    }

    // ── Strategy 5: iframe embeds (YouTube, Vimeo, Brightcove, JW Player) ──
    for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
      const src = m[1];
      if (src.match(/youtube\.com\/embed|youtu\.be|vimeo\.com\/video|players\.brightcove|jwplatform|flowplayer/i)) {
        addVideo(src, "Embed", "embed", "iframe");
      }
    }

    // ── Strategy 6: JavaScript variables and data attributes ──
    const jsPatterns = [
      /["']?(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']?/gi,
      /["']?(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']?/gi,
      /["']?(https?:\/\/[^"'\s]+\.webm[^"'\s]*)["']?/gi,
      /videoUrl['":\s]+["'](https?:\/\/[^"']+)["']/gi,
      /fileUrl['":\s]+["'](https?:\/\/[^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi,
      /streamUrl['":\s]+["'](https?:\/\/[^"']+)["']/gi,
      /["']hlsSrc["']['":\s]+["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
      /source:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
      /data-src=["'](https?:\/\/[^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi,
      /data-video-src=["']([^"']+)["']/gi,
      /data-file=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
    ];
    for (const re of jsPatterns) {
      for (const m of html.matchAll(re)) {
        const u = (m[1] || "").trim();
        if (u.startsWith("http") && !u.match(/\.(jpg|png|gif|css|js)$/i)) {
          addVideo(u, "Stream", u.includes(".m3u8") ? "hls" : "direct", "js-var");
        }
      }
    }

    // ── Strategy 7: CDN patterns (Akamai, Cloudfront, Fastly, Akamaized) ──
    const cdnPatterns = [
      /https?:\/\/[^"'\s]*\.akamaized\.net\/[^"'\s]+\.(mp4|m3u8|webm)/gi,
      /https?:\/\/[^"'\s]*cloudfront\.net\/[^"'\s]+\.(mp4|m3u8)/gi,
      /https?:\/\/[^"'\s]*cdn[^"'\s]+\.(mp4|m3u8|webm)(?:\?[^"'\s]*)?/gi,
      /https?:\/\/[^"'\s]*media[^"'\s]+\.(mp4|m3u8|webm)(?:\?[^"'\s]*)?/gi,
      /https?:\/\/[^"'\s]*video[^"'\s]+\.(mp4|m3u8)(?:\?[^"'\s]*)?/gi,
    ];
    for (const re of cdnPatterns) {
      for (const m of html.matchAll(re)) {
        addVideo(m[0].replace(/['">\s]/g, ""), "CDN Video", m[1] === "m3u8" ? "hls" : "direct", "cdn");
      }
    }

    // ── Strategy 8: Known news outlet video patterns ──
    const outletPatterns = [
      // Al Jazeera
      /https?:\/\/[^"'\s]+ajmn[^"'\s]+\.(mp4|m3u8)/gi,
      // Reuters
      /https?:\/\/[^"'\s]+reuters[^"'\s]+\.(mp4|m3u8)/gi,
      // BBC
      /https?:\/\/[^"'\s]+bbci\.co\.uk[^"'\s]+\.(mp4|m3u8)/gi,
      // AP
      /https?:\/\/[^"'\s]+apnews[^"'\s]+\.(mp4|m3u8)/gi,
      // VOA
      /https?:\/\/[^"'\s]+voanews[^"'\s]+\.(mp4|m3u8)/gi,
      // DW
      /https?:\/\/[^"'\s]+dw\.com[^"'\s]+\.(mp4|m3u8)/gi,
    ];
    for (const re of outletPatterns) {
      for (const m of html.matchAll(re)) {
        addVideo(m[0].replace(/['">\s]/g, ""), "News Video", "direct", "outlet-cdn");
      }
    }

    // ── Extract images too (for fallback) ──
    const images = [];
    const imgSeen = new Set();
    const imgPatterns = [
      /property=["']og:image["'][^>]+content=["']([^"']+)["']/gi,
      /content=["']([^"']+)["'][^>]+property=["']og:image["']/gi,
      /name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    ];
    for (const re of imgPatterns) {
      for (const m of html.matchAll(re)) {
        if (!imgSeen.has(m[1])) { imgSeen.add(m[1]); images.push(m[1]); }
      }
    }

    console.log(`[extract-video] Found ${videos.length} videos, ${images.length} images`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        videos,
        images,
        totalVideos: videos.length,
        directVideos: videos.filter(v => v.type === "direct" || v.type === "hls").length,
      })
    };

  } catch (err) {
    console.error("[extract-video] Error:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ videos: [], images: [], error: err.message }) };
  }
};

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
