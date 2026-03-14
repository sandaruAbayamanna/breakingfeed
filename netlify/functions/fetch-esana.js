// fetch-esana.js — Helakuru Esana news
// The helakuru.lk/EsanaV3 endpoint is now Cloudflare-protected and blocks server requests.
// We use community-built proxies as the primary sources.

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  function extractPosts(data) {
    if (!data) return [];
    if (Array.isArray(data.Posts)          && data.Posts.length)           return data.Posts;
    if (data.news_data?.data?.length)                                       return data.news_data.data;
    if (Array.isArray(data.data)           && data.data.length)             return data.data;
    if (Array.isArray(data)                && data.length)                  return data;
    return [];
  }

  function normalise(posts) {
    return posts.map(p => {
      const siDesc = (p.content||[]).filter(c=>c.data&&typeof c.data==="string").map(c=>c.data).join(" ").slice(0,220).trim();
      const enDesc = (p.content||[]).filter(c=>c.data_en&&typeof c.data_en==="string").map(c=>c.data_en).join(" ").slice(0,220).trim();
      let publishedAt;
      try {
        const raw = p.published || p.date || "";
        publishedAt = raw ? new Date(raw.replace(" ","T")+"+05:30").toISOString() : new Date().toISOString();
      } catch { publishedAt = new Date().toISOString(); }
      return {
        title:       p.title || p.title_si || p.title_en || "Untitled",
        title_en:    p.title_en || p.title_e || "",
        description: siDesc || enDesc || p.description || "",
        url:         p.link || p.url || p.share_url || `https://www.helakuru.lk/esana/news/${p.id}`,
        urlToImage:  p.thumb || p.thumbnail || p.cover || p.image || null,
        publishedAt,
        source: { id: "helakuru-esana", name: "Helakuru Esana" },
        _esana: true,
      };
    }).filter(a => a.title && a.url);
  }

  const ATTEMPTS = [
    // 1. Damantha126 Vercel proxy (live, updated in real-time)
    { label: "damantha-vercel",
      url: "https://esana-api.vercel.app/api/news",
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } },

    // 2. Damantha126 Vercel root
    { label: "damantha-vercel-root",
      url: "https://esana-api.vercel.app/",
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } },

    // 3. ThaminduDisnaZ GitHub raw (cached hourly by GitHub Actions)
    { label: "thamindu-raw",
      url: "https://raw.githubusercontent.com/ThaminduDisnaZ/Esena-News-Github-Bot/main/news.json",
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Cache-Control": "no-cache" } },

    // 4. Direct API with Android app User-Agent (most likely to bypass Cloudflare)
    { label: "direct-android",
      url: "https://www.helakuru.lk/EsanaV3",
      headers: {
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; Pixel 7 Build/TQ3A.230901.001)",
        "Accept": "application/json",
        "Accept-Language": "si-LK,si;q=0.9",
        "X-Requested-With": "lk.bhasha.helakuru",
        "Connection": "keep-alive",
      }},

    // 5. Direct API with iOS app User-Agent
    { label: "direct-ios",
      url: "https://www.helakuru.lk/EsanaV3",
      headers: {
        "User-Agent": "Helakuru/12.2.5 CFNetwork/1498.700.2 Darwin/23.6.0",
        "Accept": "application/json",
        "Accept-Language": "si-LK",
      }},

    // 6. allorigins wrapping direct
    { label: "allorigins",
      url: `https://api.allorigins.win/get?url=${encodeURIComponent("https://www.helakuru.lk/EsanaV3")}`,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      unwrap: true },

    // 7. corsproxy.io
    { label: "corsproxy",
      url: `https://corsproxy.io/?${encodeURIComponent("https://www.helakuru.lk/EsanaV3")}`,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } },
  ];

  for (const ep of ATTEMPTS) {
    try {
      console.log(`[esana] Trying ${ep.label}…`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(ep.url, { signal: controller.signal, headers: ep.headers || {} });
      clearTimeout(timer);

      if (!res.ok) { console.log(`[esana] ${ep.label} HTTP ${res.status}`); continue; }

      const text = await res.text();
      let json;
      try {
        const parsed = JSON.parse(text);
        json = ep.unwrap ? JSON.parse(parsed.contents) : parsed;
      } catch(e) {
        console.log(`[esana] ${ep.label} JSON parse failed: ${e.message}`);
        continue;
      }

      const posts = extractPosts(json);
      if (!posts.length) { console.log(`[esana] ${ep.label} — 0 posts`); continue; }

      console.log(`[esana] ✓ ${ep.label} — ${posts.length} posts`);
      const articles = normalise(posts);
      articles.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ status:"ok", totalResults:articles.length, articles, method:ep.label })
      };
    } catch(e) {
      console.log(`[esana] ${ep.label} error: ${e.message}`);
    }
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ status:"error", message:"All Esana methods failed — Helakuru API is fully blocked", articles:[] })
  };
};
