// fb-post.js — Facebook feed post proxy with full debug logging

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
    const payload = JSON.parse(event.body || "{}");
    const { pageId, message, link, access_token } = payload;

    if (!pageId || !access_token) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: { message: "Missing pageId or access_token" } }),
      };
    }

    // Log what we are sending (mask token)
    console.log("[fb-post] pageId:", pageId);
    console.log("[fb-post] link:", link || "(none)");
    console.log("[fb-post] message length:", (message || "").length);
    console.log("[fb-post] token tail:", access_token.slice(-6));

    // Build request body — only include link if provided
    const fbBody = { message, access_token };
    if (link && link.trim()) fbBody.link = link.trim();

    const url = `https://graph.facebook.com/v19.0/${pageId}/feed`;
    console.log("[fb-post] POST →", url);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fbBody),
    });

    const rawText = await response.text();
    console.log("[fb-post] HTTP status:", response.status);
    console.log("[fb-post] Raw response:", rawText);

    let data;
    try { data = JSON.parse(rawText); }
    catch { data = { error: { message: "Non-JSON response: " + rawText } }; }

    // Always return 200 so frontend receives the data including errors
    return {
      statusCode: 200, headers,
      body: JSON.stringify(data),
    };

  } catch (err) {
    console.error("[fb-post] Exception:", err.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
};
