// yt-download.js — YouTube video URL extractor
// Zero npm dependencies — uses multiple methods with fallbacks

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { url, pageId, access_token, caption, title: postTitle } = JSON.parse(event.body || "{}");
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url" }) };

    const videoId = extractVideoId(url);
    if (!videoId) throw new Error("Could not extract YouTube video ID from: " + url);

    console.log(`[yt-dl] Video ID: ${videoId}`);

    // ── METHOD 1: cobalt.tools public API — free, no key needed ──
    try {
      console.log("[yt-dl] Trying cobalt.tools…");
      const cobaltRes = await fetchT("https://api.cobalt.tools/", 12000, {
        "Content-Type": "application/json",
        "Accept": "application/json",
      }, "POST", JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        downloadMode: "auto",
        videoQuality: "720",
      }));

      const cobaltText = await cobaltRes.text();
      console.log(`[yt-dl] Cobalt status: ${cobaltRes.status}, body: ${cobaltText.slice(0,100)}`);

      if (cobaltRes.ok) {
        const cobaltData = JSON.parse(cobaltText);
        // Cobalt returns: { status: "tunnel"|"redirect"|"picker", url, ... }
        if ((cobaltData.status === "tunnel" || cobaltData.status === "redirect") && cobaltData.url) {
          console.log(`[yt-dl] Cobalt success: ${cobaltData.url.slice(0,60)}`);
          return await postOrReturn({
            directUrl: cobaltData.url, videoTitle: cobaltData.filename || videoId,
            quality: "720p", pageId, access_token, caption, postTitle, headers
          });
        }
      }
    } catch(e) { console.log("[yt-dl] Cobalt failed:", e.message); }

    // ── METHOD 2: yt-dlp via loader.to API ──
    try {
      console.log("[yt-dl] Trying loader.to…");
      const loaderRes = await fetchT(
        `https://loader.to/api/button/?url=https://www.youtube.com/watch?v=${videoId}&f=mp4&color=ff0000`,
        10000, { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
      );
      const loaderText = await loaderRes.text();
      console.log(`[yt-dl] loader.to: ${loaderText.slice(0,100)}`);
      if (loaderRes.ok) {
        const loaderData = JSON.parse(loaderText);
        if (loaderData.id) {
          // Poll for download URL
          for (let i = 0; i < 8; i++) {
            await sleep(2000);
            const pollRes = await fetchT(
              `https://loader.to/api/info/?id=${loaderData.id}`,
              8000, { "Accept": "application/json" }
            );
            const pollData = await pollRes.json();
            console.log(`[yt-dl] loader.to poll ${i}: ${JSON.stringify(pollData).slice(0,100)}`);
            if (pollData.download_url || pollData.success) {
              const dlUrl = pollData.download_url;
              if (dlUrl) {
                return await postOrReturn({
                  directUrl: dlUrl, videoTitle: videoId, quality: "mp4",
                  pageId, access_token, caption, postTitle, headers
                });
              }
            }
          }
        }
      }
    } catch(e) { console.log("[yt-dl] loader.to failed:", e.message); }

    // ── METHOD 3: y2mate-style API ──
    try {
      console.log("[yt-dl] Trying y2api…");
      const y2Res = await fetchT("https://yt6s.com/api/ajaxSearch", 10000, {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://yt6s.com/",
      }, "POST", `q=https://www.youtube.com/watch?v=${videoId}&vt=home`);

      const y2Text = await y2Res.text();
      console.log(`[yt-dl] y2api: ${y2Text.slice(0,150)}`);
      if (y2Res.ok) {
        const y2Data = JSON.parse(y2Text);
        // Look for mp4 download link in the response
        const links = y2Data?.links?.mp4 || {};
        const link360 = links["360p"] || links["480p"] || links["720p"] || Object.values(links)[0];
        if (link360?.k) {
          // Need to convert key to URL
          const convertRes = await fetchT("https://yt6s.com/api/ajaxConvert", 10000, {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://yt6s.com/",
          }, "POST", `vid=${videoId}&k=${encodeURIComponent(link360.k)}`);
          const convertData = await convertRes.json();
          if (convertData?.dlink) {
            return await postOrReturn({
              directUrl: convertData.dlink, videoTitle: y2Data.title || videoId,
              quality: "360p", pageId, access_token, caption, postTitle, headers
            });
          }
        }
      }
    } catch(e) { console.log("[yt-dl] y2api failed:", e.message); }

    // ── All methods failed ──
    throw new Error("All download methods failed. YouTube may be blocking automated downloads. Try a direct .mp4 URL instead.");

  } catch (err) {
    console.error("[yt-dl] Final error:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ status: "error", error: err.message }) };
  }
};

async function postOrReturn({ directUrl, videoTitle, quality, approxSize, pageId, access_token, caption, postTitle, headers }) {
  if (!pageId || !access_token) {
    return { statusCode: 200, headers, body: JSON.stringify({ status: "url_only", directUrl, videoTitle, quality, approxSize }) };
  }
  try {
    const fbRes = await fetchT(`https://graph.facebook.com/v19.0/${pageId}/videos`, 20000, {
      "Content-Type": "application/json"
    }, "POST", JSON.stringify({
      file_url: directUrl,
      description: caption || `📺 ${videoTitle}`,
      title: (postTitle || videoTitle || "").slice(0, 80),
      access_token,
    }));
    const fbData = await fbRes.json();
    if (!fbData.error && fbData.id) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok", id: fbData.id, videoTitle, quality, directUrl }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ status: "fb_error", error: fbData.error, directUrl, videoTitle, quality }) };
  } catch(e) {
    return { statusCode: 200, headers, body: JSON.stringify({ status: "fb_error", error: { message: e.message }, directUrl, videoTitle, quality }) };
  }
}

function extractVideoId(url) {
  const patterns = [
    /youtu\.be\/([^?&#/]+)/,
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/shorts\/([^?&#/]+)/,
    /youtube\.com\/embed\/([^?&#/]+)/,
    /youtube\.com\/live\/([^?&#/]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchT(url, ms, extraHeaders = {}, method = "GET", body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method, signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", ...extraHeaders },
      ...(body ? { body } : {}),
    });
  } finally { clearTimeout(timer); }
}
