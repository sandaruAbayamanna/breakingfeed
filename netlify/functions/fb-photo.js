// fb-photo.js — Download image and upload directly to Facebook /photos
// This attaches the actual image to the post (not just a link preview)

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
    const { pageId, access_token, caption, image_url } = JSON.parse(event.body || "{}");

    if (!pageId || !access_token || !image_url) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: { message: "Missing pageId, access_token, or image_url" } })
      };
    }

    console.log(`[fb-photo] Downloading image: ${image_url}`);

    // ── Download the image ──
    const imgRes = await fetchWithTimeout(image_url, 20000, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": new URL(image_url).origin,
      "Accept": "image/*,*/*",
    });

    if (!imgRes.ok) throw new Error(`Failed to download image: HTTP ${imgRes.status}`);

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const sizeMB = (imgBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`[fb-photo] Downloaded ${sizeMB}MB, type: ${contentType}`);

    if (imgBuffer.length > 10 * 1024 * 1024) {
      throw new Error(`Image too large: ${sizeMB}MB (max 10MB)`);
    }

    // ── Upload to Facebook /photos ──
    const ext = contentType.includes("png") ? ".png"
              : contentType.includes("gif") ? ".gif"
              : contentType.includes("webp") ? ".webp"
              : ".jpg";

    const filename = `photo_${Date.now()}${ext}`;
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;

    // Build multipart body
    const parts = [];
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${access_token}`);
    if (caption) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`);
    }

    const textBuf   = Buffer.from(parts.join("\r\n") + "\r\n", "utf8");
    const imgHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`, "utf8");
    const closeBuf  = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const formBody  = Buffer.concat([textBuf, imgHeader, imgBuffer, closeBuf]);

    const fbUrl = `https://graph.facebook.com/v19.0/${pageId}/photos`;
    console.log(`[fb-photo] Uploading to ${fbUrl}, size: ${formBody.length} bytes`);

    const fbRes = await fetchWithTimeout(fbUrl, 30000, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(formBody.length),
    }, "POST", formBody);

    const fbData = await fbRes.json();
    console.log("[fb-photo] FB response:", JSON.stringify(fbData));

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ...fbData, sizeMB })
    };

  } catch (err) {
    console.error("[fb-photo] Error:", err.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: { message: err.message } })
    };
  }
};

async function fetchWithTimeout(url, ms, extraHeaders = {}, method = "GET", body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method, signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders },
      ...(body ? { body } : {})
    });
  } finally {
    clearTimeout(timer);
  }
}
