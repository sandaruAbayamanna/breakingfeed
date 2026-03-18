// fb-live.js — Create a Facebook Live Video and get RTMP stream key
// Then we can push any RTMP source (including YouTube Live) to it

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { action, pageId, access_token, title, description, liveVideoId } = JSON.parse(event.body || "{}");

    // ── CREATE: Start a new Facebook Live session ──
    if (action === "create") {
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/live_videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token,
          title: title || "Live Stream",
          description: description || "",
          status: "LIVE_NOW",
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      // Returns: { id, stream_url (RTMP), secure_stream_url, embed_html, dash_preview_url }
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok", ...data }) };
    }

    // ── END: Stop the live video ──
    if (action === "end") {
      const res = await fetch(`https://graph.facebook.com/v19.0/${liveVideoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token, end_live_video: true })
      });
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok", ...data }) };
    }

    // ── STATUS: Check if live video is still active ──
    if (action === "status") {
      const res = await fetch(`https://graph.facebook.com/v19.0/${liveVideoId}?fields=status,title,live_views&access_token=${access_token}`);
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok", ...data }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ status: "error", error: err.message }) };
  }
};
