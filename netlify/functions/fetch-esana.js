// fetch-esana.js — Helakuru Esana news (unofficial API)
// Endpoint: https://www.helakuru.lk/EsanaV3
// Returns Posts[] with: id, title (Sinhala), title_en, thumb, published, link, content[]

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

  try {
    console.log("[esana] Fetching Helakuru Esana…");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch("https://www.helakuru.lk/EsanaV3", {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, */*",
        "Referer": "https://www.helakuru.lk/esana",
        "Origin": "https://www.helakuru.lk",
      },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`Helakuru API returned HTTP ${res.status}`);

    const data = await res.json();
    const posts = data.Posts || data.posts || [];

    if (!posts.length) throw new Error("No posts returned from Helakuru API");

    console.log(`[esana] Got ${posts.length} posts`);

    // Normalise into standard article format used by BreakingFeed
    const articles = posts.map(p => {
      // Build description from content array (first Sinhala text block)
      const siDesc = (p.content || [])
        .filter(c => c.data && typeof c.data === "string")
        .map(c => c.data)
        .join(" ")
        .slice(0, 200)
        .trim();

      const enDesc = (p.content || [])
        .filter(c => c.data_en && typeof c.data_en === "string")
        .map(c => c.data_en)
        .join(" ")
        .slice(0, 200)
        .trim();

      return {
        title: p.title || p.title_en || "Untitled",
        title_en: p.title_en || "",
        description: siDesc || enDesc || "",
        description_en: enDesc || "",
        url: p.link || `https://www.helakuru.lk/esana/news/${p.id}`,
        urlToImage: p.thumb || null,
        publishedAt: p.published
          ? new Date(p.published.replace(" ", "T") + "+05:30").toISOString()
          : new Date().toISOString(),
        source: { id: "helakuru-esana", name: "Helakuru Esana" },
        likes: p.likes || 0,
        comments: p.comments || 0,
        _esana: true,
      };
    });

    // Sort newest first
    articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "ok",
        totalResults: articles.length,
        articles,
        source: "helakuru-esana",
      }),
    };

  } catch (err) {
    console.error("[esana] Error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: "error", message: err.message, articles: [] }),
    };
  }
};
