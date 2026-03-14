// fetch-esana.js — Helakuru Esana news
// Tries multiple endpoints/approaches with fallbacks

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

  // ── Attempt 1: Direct API v3 ──
  async function tryEsanaV3() {
    const res = await fetchT("https://www.helakuru.lk/EsanaV3", 10000, {
      "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "si-LK,si;q=0.9,en-US;q=0.8",
      "Referer": "https://www.helakuru.lk/esana",
      "Origin": "https://www.helakuru.lk",
      "X-Requested-With": "XMLHttpRequest",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const posts = data.Posts || data.posts || data.data || [];
    if (!posts.length) throw new Error("Empty Posts array");
    return posts;
  }

  // ── Attempt 2: Via allorigins proxy ──
  async function tryViaProxy() {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent("https://www.helakuru.lk/EsanaV3")}`;
    const res = await fetchT(proxyUrl, 12000, {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    });
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents);
    const posts = data.Posts || data.posts || data.data || [];
    if (!posts.length) throw new Error("Empty posts via proxy");
    return posts;
  }

  // ── Attempt 3: Third-party public proxy (ThaminduDisnaZ) ──
  async function tryPublicProxy() {
    const res = await fetchT("https://thamindudisnaz.github.io/Esena-News-Github-Bot/news.json", 10000, {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    });
    if (!res.ok) throw new Error(`Public proxy HTTP ${res.status}`);
    const data = await res.json();
    // This proxy may have different structure
    const posts = data.Posts || data.posts || data.news_data?.data || data.data || [];
    if (!posts.length) throw new Error("Empty posts from public proxy");
    return posts;
  }

  // ── Normalise posts to BreakingFeed article format ──
  function normalisePosts(posts) {
    return posts.map(p => {
      const siDesc = (p.content || [])
        .filter(c => c.data && typeof c.data === "string")
        .map(c => c.data).join(" ").slice(0, 220).trim();

      const enDesc = (p.content || [])
        .filter(c => c.data_en && typeof c.data_en === "string")
        .map(c => c.data_en).join(" ").slice(0, 220).trim();

      // Handle timestamp with Sri Lanka timezone offset
      let publishedAt;
      try {
        const raw = p.published || p.date || "";
        publishedAt = raw
          ? new Date(raw.replace(" ", "T") + "+05:30").toISOString()
          : new Date().toISOString();
      } catch {
        publishedAt = new Date().toISOString();
      }

      return {
        title: p.title || p.title_si || p.title_en || "Untitled",
        title_en: p.title_en || p.title_e || "",
        description: siDesc || enDesc || p.description || "",
        description_en: enDesc || "",
        url: p.link || p.url || `https://www.helakuru.lk/esana/news/${p.id}`,
        urlToImage: p.thumb || p.thumbnail || p.cover || null,
        publishedAt,
        source: { id: "helakuru-esana", name: "Helakuru Esana" },
        _esana: true,
        _likes: p.likes || 0,
      };
    }).filter(a => a.title && a.url);
  }

  try {
    let posts = null;
    let method = "";

    // Try each method in order
    try { posts = await tryEsanaV3();     method = "direct";       } catch(e) { console.log("[esana] Direct failed:", e.message); }
    if (!posts) {
      try { posts = await tryViaProxy();  method = "allorigins";   } catch(e) { console.log("[esana] Proxy failed:", e.message); }
    }
    if (!posts) {
      try { posts = await tryPublicProxy(); method = "public-proxy"; } catch(e) { console.log("[esana] Public proxy failed:", e.message); }
    }

    if (!posts || !posts.length) {
      throw new Error("All Esana fetch methods failed");
    }

    console.log(`[esana] Got ${posts.length} posts via ${method}`);

    const articles = normalisePosts(posts);
    articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        status: "ok",
        totalResults: articles.length,
        articles,
        source: "helakuru-esana",
        method,
      }),
    };

  } catch (err) {
    console.error("[esana] All methods failed:", err.message);
    return {
      statusCode: 200, // return 200 so frontend can handle gracefully
      headers,
      body: JSON.stringify({
        status: "error",
        message: "Helakuru Esana temporarily unavailable: " + err.message,
        articles: [],
      }),
    };
  }
};

async function fetchT(url, ms, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders },
    });
  } finally {
    clearTimeout(timer);
  }
}
