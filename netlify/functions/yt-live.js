// yt-live.js — Find a YouTube channel's current live stream video ID
// Uses YouTube's unofficial search to find the active live video

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { channelId } = JSON.parse(event.body || "{}");
    if (!channelId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing channelId" }) };

    console.log(`[yt-live] Finding live stream for channel: ${channelId}`);

    // Method 1: Scrape channel/live page to find active live video ID
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      }
    });

    const html = await res.text();

    // Extract video ID from page — look for canonical URL or og:video
    let videoId = null;

    // Try: "videoId":"XXXXXXXXXXX"
    const m1 = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (m1) videoId = m1[1];

    // Try: canonical link
    if (!videoId) {
      const m2 = html.match(/canonical.*?watch\?v=([a-zA-Z0-9_-]{11})/);
      if (m2) videoId = m2[1];
    }

    // Try: og:url
    if (!videoId) {
      const m3 = html.match(/og:url.*?watch\?v=([a-zA-Z0-9_-]{11})/);
      if (m3) videoId = m3[1];
    }

    if (!videoId) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: "no_live", message: "No active live stream found on this channel" }) };
    }

    console.log(`[yt-live] Found live video: ${videoId}`);
    return { statusCode: 200, headers, body: JSON.stringify({ status: "ok", videoId }) };

  } catch (err) {
    console.error("[yt-live] Error:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ status: "error", error: err.message }) };
  }
};
