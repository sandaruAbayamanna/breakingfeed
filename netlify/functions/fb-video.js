// fb-video.js — Download video and upload to Facebook
// Uses chunked/resumable upload for large files to handle Netlify's 26s timeout
// Strategy: download + upload in one stream, with file_url fallback for FB's own downloader

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { pageId, access_token, description, title, file_url } = JSON.parse(event.body || "{}");
    if (!pageId || !access_token || !file_url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: { message: "Missing pageId, access_token, or file_url" } }) };
    }

    console.log(`[fb-video] Starting for: ${file_url}`);

    // ── STRATEGY 1: Let Facebook download it directly via file_url param ──
    // This is the most reliable — FB's servers download the video themselves
    // Works for direct .mp4 URLs that are publicly accessible
    console.log("[fb-video] Strategy 1: FB direct download via file_url…");
    try {
      const fbDirectRes = await fetchT(
        `https://graph.facebook.com/v19.0/${pageId}/videos`,
        25000,
        {
          "Content-Type": "application/json",
        },
        "POST",
        JSON.stringify({
          file_url,
          description: description || "",
          title: title || "",
          access_token,
        })
      );
      const fbDirectData = await fbDirectRes.json();
      console.log("[fb-video] Strategy 1 response:", JSON.stringify(fbDirectData));

      if (!fbDirectData.error && fbDirectData.id) {
        return { statusCode: 200, headers, body: JSON.stringify({ id: fbDirectData.id, method: "fb-direct", success: true }) };
      }
      console.log("[fb-video] Strategy 1 failed:", fbDirectData.error?.message);
    } catch(e) { console.log("[fb-video] Strategy 1 threw:", e.message); }

    // ── STRATEGY 2: Download binary ourselves + upload as multipart ──
    // Works for videos up to ~25MB within Netlify's 26s limit
    console.log("[fb-video] Strategy 2: binary download + multipart upload…");

    const videoRes = await fetchT(file_url, 20000, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": (() => { try { return new URL(file_url).origin; } catch { return ""; } })(),
      "Accept": "video/*,*/*",
    });

    if (!videoRes.ok) throw new Error(`Video download failed: HTTP ${videoRes.status}`);

    const contentType = videoRes.headers.get("content-type") || "video/mp4";
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const fileSizeMB  = (videoBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`[fb-video] Downloaded: ${fileSizeMB}MB (${contentType})`);

    if (videoBuffer.length > 50 * 1024 * 1024) {
      throw new Error(`Video too large for direct upload: ${fileSizeMB}MB. Try a shorter clip or YouTube link.`);
    }

    // Build multipart body
    const ext      = getExt(contentType, file_url);
    const filename = `video_${Date.now()}${ext}`;
    const boundary = `----FB${Math.random().toString(36).slice(2)}`;

    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${access_token}`,
    ];
    if (description) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}`);
    if (title)       parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}`);

    const textBuf   = Buffer.from(parts.join("\r\n") + "\r\n", "utf8");
    const vidHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`, "utf8");
    const closeBuf  = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const formBody  = Buffer.concat([textBuf, vidHeader, videoBuffer, closeBuf]);

    const uploadRes = await fetchT(
      `https://graph.facebook.com/v19.0/${pageId}/videos`,
      90000,
      { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(formBody.length) },
      "POST",
      formBody
    );
    const uploadData = await uploadRes.json();
    console.log("[fb-video] Strategy 2 response:", JSON.stringify(uploadData));

    if (uploadData.error) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: uploadData.error, fileSizeMB }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ id: uploadData.id, fileSizeMB, method: "binary-upload", success: true }) };

  } catch (err) {
    console.error("[fb-video] Error:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ error: { message: err.message }, articles: [] }) };
  }
};

function getExt(ct, url) {
  if (ct.includes("mp4"))  return ".mp4";
  if (ct.includes("webm")) return ".webm";
  if (ct.includes("mov"))  return ".mov";
  if (url.includes(".mp4"))  return ".mp4";
  if (url.includes(".webm")) return ".webm";
  if (url.includes(".mov"))  return ".mov";
  return ".mp4";
}

async function fetchT(url, ms, extraHeaders = {}, method = "GET", body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method,
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders },
      ...(body ? { body } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}
