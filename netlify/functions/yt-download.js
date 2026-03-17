// yt-download.js — YouTube video direct URL extractor
// Zero dependencies — uses YouTube's internal API (innertube) directly
// No npm packages needed

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { url, pageId, access_token, caption, title: postTitle } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url" }) };

    // Extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error("Could not extract YouTube video ID from URL");

    console.log(`[yt-dl] Video ID: ${videoId}`);

    // ── METHOD 1: YouTube Innertube API (no key needed) ──
    let formats = [];
    let videoTitle = "";
    let duration = 0;

    try {
      const innertubeRes = await fetchT("https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", 10000, {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": "2.20231121.08.00",
      }, "POST", JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.09.37",
            androidSdkVersion: 30,
            userAgent: "com.google.android.youtube/19.09.37 (Linux; U; Android 11)",
            hl: "en",
            timeZone: "UTC",
            utcOffsetMinutes: 0
          }
        }
      }));

      const innertubeData = await innertubeRes.json();
      videoTitle = innertubeData?.videoDetails?.title || "";
      duration   = parseInt(innertubeData?.videoDetails?.lengthSeconds || 0);

      const streamingData = innertubeData?.streamingData;
      if (streamingData?.formats) formats.push(...streamingData.formats);
      if (streamingData?.adaptiveFormats) formats.push(...streamingData.adaptiveFormats);
      console.log(`[yt-dl] Innertube: "${videoTitle}", ${formats.length} formats`);
    } catch(e) {
      console.log("[yt-dl] Innertube failed:", e.message);
    }

    // ── METHOD 2: yt-dlp public API proxy (cobalt.tools) ──
    if (!formats.length) {
      try {
        const cobaltRes = await fetchT("https://api.cobalt.tools/api/json", 12000, {
          "Content-Type": "application/json",
          "Accept": "application/json",
        }, "POST", JSON.stringify({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          vQuality: "720",
          isNoTTWatermark: true,
        }));
        const cobaltData = await cobaltRes.json();
        console.log("[yt-dl] Cobalt response:", JSON.stringify(cobaltData).slice(0, 200));

        if (cobaltData.url || cobaltData.urls) {
          const directUrl = cobaltData.url || cobaltData.urls;
          return await postOrReturn({ directUrl, videoTitle: videoTitle || videoId, quality: "720p", pageId, access_token, caption, postTitle, headers });
        }
      } catch(e) {
        console.log("[yt-dl] Cobalt failed:", e.message);
      }
    }

    // ── Pick best format from innertube ──
    if (formats.length) {
      // Filter: mp4, has both audio+video (mimeType not adaptive), max 720p
      const combined = formats.filter(f =>
        f.mimeType?.includes("video/mp4") &&
        f.audioQuality && // has audio
        parseInt(f.height || 0) <= 720
      ).sort((a, b) => parseInt(b.height||0) - parseInt(a.height||0));

      const best = combined[0] || formats.find(f => f.mimeType?.includes("video/mp4")) || formats[0];

      if (best?.url) {
        const quality = best.qualityLabel || `${best.height}p` || "?";
        const sizeMB  = best.contentLength ? `${(parseInt(best.contentLength)/1024/1024).toFixed(1)}MB` : "?";
        console.log(`[yt-dl] Best format: ${quality}, ${sizeMB}`);
        return await postOrReturn({ directUrl: best.url, videoTitle, quality, approxSize: sizeMB, pageId, access_token, caption, postTitle, headers });
      }
    }

    throw new Error("Could not extract a downloadable URL from this video");

  } catch (err) {
    console.error("[yt-dl] Error:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ status: "error", error: err.message }) };
  }
};

// ── Post to FB or just return the URL ──
async function postOrReturn({ directUrl, videoTitle, quality, approxSize, pageId, access_token, caption, postTitle, headers }) {
  if (!pageId || !access_token) {
    // Just return the URL for device download
    return { statusCode: 200, headers, body: JSON.stringify({ status: "url_only", directUrl, videoTitle, quality, approxSize }) };
  }

  // Try FB file_url (FB downloads it themselves)
  try {
    const fbRes = await fetchT(`https://graph.facebook.com/v19.0/${pageId}/videos`, 20000, {
      "Content-Type": "application/json"
    }, "POST", JSON.stringify({
      file_url: directUrl,
      description: caption || `📺 ${videoTitle}`,
      title: (postTitle || videoTitle).slice(0, 80),
      access_token,
    }));
    const fbData = await fbRes.json();
    if (!fbData.error && fbData.id) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok", id: fbData.id, videoTitle, quality, directUrl }) };
    }
    // Return error + directUrl so frontend can try binary upload
    return { statusCode: 200, headers, body: JSON.stringify({ status: "fb_error", error: fbData.error, directUrl, videoTitle, quality }) };
  } catch(e) {
    return { statusCode: 200, headers, body: JSON.stringify({ status: "fb_error", error: { message: e.message }, directUrl, videoTitle, quality }) };
  }
}

function extractVideoId(url) {
  const patterns = [
    /youtu\.be\/([^?&/#]+)/,
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/shorts\/([^?&/#]+)/,
    /youtube\.com\/embed\/([^?&/#]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchT(url, ms, extraHeaders = {}, method = "GET", body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method, signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders },
      ...(body ? { body } : {}),
    });
  } finally { clearTimeout(timer); }
}
