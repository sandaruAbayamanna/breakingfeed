// fb-video.js — Post video to Facebook Page
// Supports:
//   1. file_url   → Facebook fetches video from a public URL (easiest)
//   2. upload_phase: start → initializes a resumable upload session for large files

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

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = JSON.parse(event.body || "{}");
    const { pageId, access_token, description, title, file_url, upload_phase, file_size } = body;

    if (!pageId || !access_token) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: { message: "Missing pageId or access_token" } }) };
    }

    const fbUrl = `https://graph.facebook.com/v19.0/${pageId}/videos`;

    // Mode 1: Post by public URL (Facebook fetches the video)
    if (file_url) {
      console.log(`[FB Video] Posting via URL for page ${pageId}`);
      const payload = { access_token, description: description || "", title: title || "", file_url };
      const res = await fetch(fbUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // Mode 2: Initialize resumable upload session
    if (upload_phase === "start" && file_size) {
      console.log(`[FB Video] Starting resumable upload, size: ${file_size} bytes`);
      const params = new URLSearchParams({
        upload_phase: "start",
        file_size: String(file_size),
        access_token,
        title: title || "",
        description: description || "",
      });
      const res = await fetch(`${fbUrl}?${params}`, { method: "POST" });
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: { message: "Provide file_url or upload_phase=start with file_size" } }),
    };

  } catch (err) {
    console.error("[FB Video Error]", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: { message: err.message } }) };
  }
};
