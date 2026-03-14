// fetch-esana.js — Helakuru Esana news
// Primary: esana-api.vercel.app/EsanaV3 (Damantha126's proxy — GET request)
// Fallbacks: multiple methods

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  function extractPosts(data) {
    if (!data) return [];
    if (Array.isArray(data.Posts) && data.Posts.length)        return data.Posts;
    if (data.news_data?.data?.length)                          return data.news_data.data;
    if (Array.isArray(data.data) && data.data.length)          return data.data;
    if (Array.isArray(data) && data.length && data[0]?.title)  return data;
    return [];
  }

  function normalise(posts) {
    return posts.map(p => {
      const siDesc = (p.content||[]).filter(c=>c.data&&typeof c.data==="string").map(c=>c.data).join(" ").slice(0,220).trim();
      const enDesc = (p.content||[]).filter(c=>c.data_en&&typeof c.data_en==="string").map(c=>c.data_en).join(" ").slice(0,220).trim();
      let publishedAt;
      try { publishedAt = new Date((p.published||p.date||"").replace(" ","T")+"+05:30").toISOString(); }
      catch { publishedAt = new Date().toISOString(); }
      return {
        title:       p.title || p.title_si || p.title_en || "Untitled",
        title_en:    p.title_en || p.title_e || "",
        description: siDesc || enDesc || p.description || "",
        url:         p.link || p.url || `https://www.helakuru.lk/esana/news/${p.id}`,
        urlToImage:  p.thumb || p.thumbnail || p.cover || p.image || null,
        publishedAt,
        source: { id: "helakuru-esana", name: "Helakuru Esana" },
        _esana: true,
      };
    }).filter(a => a.title && a.url);
  }

  // All GET requests
  const ATTEMPTS = [
    // 1. Damantha126 Vercel proxy — correct route is /EsanaV3 (GET)
    { label: "damantha-EsanaV3",
      url: "https://esana-api.vercel.app/EsanaV3" },

    // 2. Damantha126 without path (may redirect)
    { label: "damantha-root",
      url: "https://esana-api.vercel.app" },

    // 3. Direct helakuru with Android app headers
    { label: "direct-android",
      url: "https://www.helakuru.lk/EsanaV3",
      headers: {
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; Pixel 7 Build/TQ3A.230901.001)",
        "Accept": "application/json",
        "X-Requested-With": "lk.bhasha.helakuru",
      }},

    // 4. ThaminduDisnaZ GitHub raw cached file
    { label: "thamindu-github-raw",
      url: "https://raw.githubusercontent.com/ThaminduDisnaZ/Esena-News-Github-Bot/main/news.json" },

    // 5. allorigins wrapping direct
    { label: "allorigins",
      url: `https://api.allorigins.win/get?url=${encodeURIComponent("https://www.helakuru.lk/EsanaV3")}`,
      unwrap: true },

    // 6. corsproxy.io
    { label: "corsproxy",
      url: `https://corsproxy.io/?${encodeURIComponent("https://www.helakuru.lk/EsanaV3")}` },
  ];

  for (const ep of ATTEMPTS) {
    try {
      console.log(`[esana] Trying ${ep.label}: ${ep.url}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(ep.url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", ...(ep.headers||{}) },
      });
      clearTimeout(timer);

      if (!res.ok) { console.log(`[esana] ${ep.label} HTTP ${res.status}`); continue; }

      const text = await res.text();
      let json;
      try {
        const parsed = JSON.parse(text);
        json = ep.unwrap ? JSON.parse(parsed.contents) : parsed;
      } catch(e) { console.log(`[esana] ${ep.label} parse error: ${e.message}`); continue; }

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
    body: JSON.stringify({ status:"error", message:"Helakuru Esana API unavailable — all methods failed", articles:[] })
  };
};
