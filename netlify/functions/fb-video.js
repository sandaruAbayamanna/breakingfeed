// fb-video.js — Download video and upload binary directly to Facebook
// No file_url, no App Review workaround — actual binary upload

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
    const { pageId, access_token, description, title, file_url } = JSON.parse(event.body || "{}");

    if (!pageId || !access_token || !file_url) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: { message: "Missing pageId, access_token, or file_url" } })
      };
    }

    console.log(`[fb-video] Downloading: ${file_url}`);

    // ── STEP 1: Download the video from the URL ──
    const videoRes = await fetchWithTimeout(file_url, 50000, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": new URL(file_url).origin,
      "Accept": "video/*,*/*",
    });

    if (!videoRes.ok) {
      throw new Error(`Failed to download video: HTTP ${videoRes.status} from ${file_url}`);
    }

    // Get content type and size
    const contentType = videoRes.headers.get("content-type") || "video/mp4";
    const contentLength = videoRes.headers.get("content-length");
    console.log(`[fb-video] Downloaded: ${contentType}, size: ${contentLength || "unknown"}`);

    // Read video as buffer
    const videoBuffer = await videoRes.arrayBuffer();
    const videoBytes = Buffer.from(videoBuffer);
    const fileSizeMB = (videoBytes.length / 1024 / 1024).toFixed(1);
    console.log(`[fb-video] Video size: ${fileSizeMB} MB`);

    // Reject if too large (Netlify function limit ~50MB, FB limit 10GB but we cap at 100MB)
    if (videoBytes.length > 100 * 1024 * 1024) {
      throw new Error(`Video too large: ${fileSizeMB}MB. Maximum supported size is 100MB.`);
    }

    // ── STEP 2: Upload binary to Facebook /videos ──
    console.log(`[fb-video] Uploading ${fileSizeMB}MB to Facebook page ${pageId}…`);

    // Determine file extension from content type or URL
    const ext = getExtension(contentType, file_url);
    const filename = `video_${Date.now()}${ext}`;

    // Build multipart form data
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
    const formParts = [];

    // access_token field
    formParts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${access_token}`
    );

    // description field
    if (description) {
      formParts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}`
      );
    }

    // title field
    if (title) {
      formParts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}`
      );
    }

    // Build form body with binary video
    const textPart = formParts.join("\r\n") + "\r\n";
    const videoFieldHeader = `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
    const closingBoundary = `\r\n--${boundary}--\r\n`;

    const textBuf   = Buffer.from(textPart, "utf8");
    const headerBuf = Buffer.from(videoFieldHeader, "utf8");
    const closeBuf  = Buffer.from(closingBoundary, "utf8");
    const formBody  = Buffer.concat([textBuf, headerBuf, videoBytes, closeBuf]);

    const fbUrl = `https://graph.facebook.com/v19.0/${pageId}/videos`;
    const fbRes = await fetchWithTimeout(fbUrl, 120000, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(formBody.length),
    }, "POST", formBody);

    const fbData = await fbRes.json();
    console.log("[fb-video] FB response:", JSON.stringify(fbData));

    if (fbData.error) {
      // Return the error so frontend can handle fallback
      return { statusCode: 200, headers, body: JSON.stringify({ error: fbData.error, fileSizeMB }) };
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ id: fbData.id, video_id: fbData.video_id, fileSizeMB, success: true })
    };

  } catch (err) {
    console.error("[fb-video] Error:", err.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: { message: err.message } })
    };
  }
};

// ── Helpers ──
async function fetchWithTimeout(url, timeoutMs, extraHeaders = {}, method = "GET", body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const opts = {
      method,
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders },
    };
    if (body) opts.body = body;
    return await fetch(url, opts);
  } finally {
    clearTimeout(timer);
  }
}

function getExtension(contentType, url) {
  const ctMap = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/ogg": ".ogv",
    "application/x-mpegURL": ".m3u8",
  };
  if (ctMap[contentType]) return ctMap[contentType];
  const urlMatch = url.match(/\.(mp4|webm|mov|avi|ogv|m3u8)(\?|$)/i);
  if (urlMatch) return "." + urlMatch[1].toLowerCase();
  return ".mp4";
}
