// fetch-esana.js — Helakuru Esana news
// Primary API: https://esena-news-api-v3.vercel.app/ (GET /)
// by Thamindu Disna — response: { news_data: { data: [...] } }
// Fields: titleSi, titleEn, contentSi, thumb, cover, published, share_url, reactions, comments

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  // ── Normalise to BreakingFeed article format ──
  function normalise(posts) {
    return posts.map(p => {
      // contentSi is an array of objects — extract text blocks
      const siDesc = (p.contentSi || [])
        .filter(c => c.type === "text" && c.data)
        .map(c => c.data).join(" ").slice(0, 220).trim();

      let publishedAt;
      try {
        publishedAt = new Date(p.published.replace(" ", "T") + "+05:30").toISOString();
      } catch { publishedAt = new Date().toISOString(); }

      return {
        title:       p.titleSi || p.titleEn || "Untitled",
        title_en:    p.titleEn || "",
        description: siDesc || "",
        url:         p.share_url || `https://www.helakuru.lk/esana/news/${p.id}`,
        urlToImage:  p.thumb || p.cover || null,
        publishedAt,
        source: { id: "helakuru-esana", name: "Helakuru Esana" },
        _esana: true,
        _likes:    p.reactions?.like || 0,
        _comments: p.comments || 0,
      };
    }).filter(a => a.title && a.url);
  }

  const ATTEMPTS = [
    // 1. ThaminduDisna Vercel API v3 — primary, confirmed working
    {
      label: "esena-v3-vercel",
      url: "https://esena-news-api-v3.vercel.app/",
    },
    // 2. Same via allorigins proxy (if Vercel blocks Netlify IPs)
    {
      label: "esena-v3-allorigins",
      url: `https://api.allorigins.win/get?url=${encodeURIComponent("https://esena-news-api-v3.vercel.app/")}`,
      unwrap: true,
    },
    // 3. Damantha126 Vercel (older API, different field names — title/title_en/content/link)
    {
      label: "damantha-vercel",
      url: "https://esana-api.vercel.app/EsanaV3",
      legacy: true, // uses old field names
    },
    // 4. Direct helakuru with Android UA
    {
      label: "direct-android",
      url: "https://www.helakuru.lk/EsanaV3",
      headers: {
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; Pixel 7 Build/TQ3A.230901.001)",
        "X-Requested-With": "lk.bhasha.helakuru",
      },
      legacy: true,
    },
  ];

  // Legacy normaliser for old API shape (title/title_en/content[]/link)
  function normaliseLegacy(posts) {
    return posts.map(p => {
      const siDesc = (p.content||[]).filter(c=>c.data&&typeof c.data==="string").map(c=>c.data).join(" ").slice(0,220).trim();
      const enDesc = (p.content||[]).filter(c=>c.data_en&&typeof c.data_en==="string").map(c=>c.data_en).join(" ").slice(0,220).trim();
      let publishedAt;
      try { publishedAt = new Date(p.published.replace(" ","T")+"+05:30").toISOString(); }
      catch { publishedAt = new Date().toISOString(); }
      return {
        title:       p.title || "Untitled",
        title_en:    p.title_en || "",
        description: siDesc || enDesc || "",
        url:         p.link || `https://www.helakuru.lk/esana/news/${p.id}`,
        urlToImage:  p.thumb || null,
        publishedAt,
        source: { id: "helakuru-esana", name: "Helakuru Esana" },
        _esana: true,
      };
    }).filter(a => a.title && a.url);
  }

  for (const ep of ATTEMPTS) {
    try {
      console.log(`[esana] Trying ${ep.label}…`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(ep.url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", ...(ep.headers||{}) },
      });
      clearTimeout(timer);

      console.log(`[esana] ${ep.label} → HTTP ${res.status}`);
      if (!res.ok) continue;

      const text = await res.text();
      console.log(`[esana] ${ep.label} body[:120]: ${text.slice(0,120)}`);

      let json;
      try {
        const parsed = JSON.parse(text);
        json = ep.unwrap ? JSON.parse(parsed.contents) : parsed;
      } catch(e) { console.log(`[esana] parse error: ${e.message}`); continue; }

      // Try new shape first: { news_data: { data: [...] } }
      let posts = json.news_data?.data || [];

      // Fallback to legacy shape: { Posts: [...] }
      if (!posts.length) posts = json.Posts || [];

      console.log(`[esana] ${ep.label} posts: ${posts.length}`);
      if (!posts.length) continue;

      const articles = ep.legacy
        ? normaliseLegacy(posts)
        : normalise(posts);

      articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      console.log(`[esana] ✓ ${ep.label} — ${articles.length} articles normalised`);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ status: "ok", totalResults: articles.length, articles, method: ep.label })
      };

    } catch(e) {
      console.log(`[esana] ${ep.label} threw: ${e.message}`);
    }
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ status: "error", message: "Helakuru Esana unavailable", articles: [] })
  };
};
