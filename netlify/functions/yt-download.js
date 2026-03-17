// yt-download.js — Get YouTube direct download URL then upload to Facebook
// Strategy: use @distube/ytdl-core to extract the signed direct .mp4 URL,
// then pass it to Facebook's file_url param so FB downloads it themselves
// (avoids Netlify's 26s timeout entirely for large videos)

const ytdl = require("@distube/ytdl-core");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { url, pageId, access_token, caption, title } = JSON.parse(event.body || "{}");

    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url" }) };

    console.log(`[yt-dl] Processing: ${url}`);

    // ── STEP 1: Get video info + find best combined mp4 format ──
    const info = await ytdl.getInfo(url);
    const videoTitle = info.videoDetails.title;
    const duration   = parseInt(info.videoDetails.lengthSeconds);

    console.log(`[yt-dl] Video: "${videoTitle}" (${duration}s)`);

    if (duration > 1200) { // 20 min max
      throw new Error(`Video too long: ${Math.round(duration/60)} min. Maximum is 20 minutes.`);
    }

    // Choose best format: prefer mp4 with audio+video combined, max 720p
    const formats = ytdl.filterFormats(info.formats, "audioandvideo");
    const mp4Formats = formats.filter(f => f.container === "mp4").sort((a, b) => {
      const qa = parseInt(a.qualityLabel) || 0;
      const qb = parseInt(b.qualityLabel) || 0;
      return qb - qa; // highest quality first
    });

    // Pick 720p or lower (Facebook supports up to 1080p but smaller = faster)
    const chosenFormat = mp4Formats.find(f => parseInt(f.qualityLabel) <= 720)
                      || mp4Formats[0]
                      || formats[0];

    if (!chosenFormat) throw new Error("No downloadable format found for this video");

    const directUrl  = chosenFormat.url;
    const quality    = chosenFormat.qualityLabel || "unknown";
    const approxSize = chosenFormat.contentLength
      ? `${(parseInt(chosenFormat.contentLength)/1024/1024).toFixed(1)}MB`
      : "unknown size";

    console.log(`[yt-dl] Chosen format: ${quality} mp4, ${approxSize}`);
    console.log(`[yt-dl] Direct URL prefix: ${directUrl.slice(0, 80)}…`);

    // If no FB credentials — just return the direct URL for info
    if (!pageId || !access_token) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: "url_only",
          directUrl,
          videoTitle,
          quality,
          approxSize,
          duration,
        })
      };
    }

    // ── STEP 2: Pass direct URL to Facebook file_url (FB downloads it) ──
    console.log(`[yt-dl] Posting to Facebook page ${pageId} via file_url…`);

    const fbBody = {
      file_url:    directUrl,
      description: caption || `📺 ${videoTitle}`,
      title:       title   || videoTitle.slice(0, 80),
      access_token,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const fbRes = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/videos`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fbBody),
      }
    );
    clearTimeout(timer);

    const fbData = await fbRes.json();
    console.log("[yt-dl] FB response:", JSON.stringify(fbData));

    if (fbData.error) {
      // FB rejected file_url — return direct URL so frontend can try binary upload
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: "fb_error",
          error: fbData.error,
          directUrl, // frontend can use this for binary upload fallback
          videoTitle,
          quality,
        })
      };
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        status: "ok",
        id: fbData.id,
        videoTitle,
        quality,
        approxSize,
      })
    };

  } catch (err) {
    console.error("[yt-dl] Error:", err.message);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ status: "error", error: err.message })
    };
  }
};
