// proxy-download.js — Proxy video download to force browser save
// Fetches the video server-side and streams it back with Content-Disposition: attachment
// This forces "Save File" on mobile/desktop regardless of CORS or origin

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }

  try {
    const { url, filename } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, body: JSON.stringify({ error: "Missing url" }) };

    console.log(`[proxy-dl] Fetching: ${url}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "video/*,*/*",
        "Referer": (() => { try { return new URL(url).origin; } catch { return ""; } })(),
      }
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status} from source`);

    const contentType = res.headers.get("content-type") || "video/mp4";
    const buffer = Buffer.from(await res.arrayBuffer());
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);

    console.log(`[proxy-dl] Got ${sizeMB}MB, type: ${contentType}`);

    // Cap at 45MB (Netlify response limit)
    if (buffer.length > 45 * 1024 * 1024) {
      throw new Error(`File too large to proxy: ${sizeMB}MB (max 45MB). Try right-clicking the video to save.`);
    }

    const safeFilename = (filename || "video.mp4").replace(/[^a-z0-9._-]/gi, "_");

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-cache",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };

  } catch (err) {
    console.error("[proxy-dl] Error:", err.message);
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
