// fetch-news.js — Universal news proxy supporting multiple APIs
// Supports: NewsAPI.org, GNews.io, NewsData.io, The Guardian (all free tiers)
// All return a normalised { articles: [...] } response so the frontend doesn't change

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const body = JSON.parse(event.body || "{}");
    const { provider, apiKey, query, language, sortBy, pageSize, type } = body;
    // type = "search" | "headlines"

    let articles = [];

    // ════════════════════════════════
    // 1. NEWSAPI.ORG
    // ════════════════════════════════
    if (provider === "newsapi") {
      const endpoint = type === "headlines"
        ? `https://newsapi.org/v2/top-headlines?category=general&language=${language||"en"}&pageSize=${pageSize||20}&apiKey=${apiKey}`
        : `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=${language||"en"}&sortBy=${sortBy||"publishedAt"}&pageSize=${pageSize||30}&apiKey=${apiKey}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.status !== "ok") throw new Error(data.message || "NewsAPI error");
      articles = (data.articles || []).map(a => normalise_newsapi(a));
    }

    // ════════════════════════════════
    // 2. GNEWS.IO  (real-time, no delay)
    // ════════════════════════════════
    else if (provider === "gnews") {
      const lang = language || "en";
      const endpoint = type === "headlines"
        ? `https://gnews.io/api/v4/top-headlines?category=general&lang=${lang}&max=${pageSize||20}&apikey=${apiKey}`
        : `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=${lang}&sortby=${sortBy==="publishedAt"?"publishedAt":"relevance"}&max=${pageSize||20}&apikey=${apiKey}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.errors) throw new Error(data.errors.join(", "));
      articles = (data.articles || []).map(a => normalise_gnews(a));
    }

    // ════════════════════════════════
    // 3. NEWSDATA.IO  (real-time, commercial free tier)
    // ════════════════════════════════
    else if (provider === "newsdata") {
      const lang = language || "en";
      const endpoint = type === "headlines"
        ? `https://newsdata.io/api/1/latest?language=${lang}&apikey=${apiKey}`
        : `https://newsdata.io/api/1/latest?q=${encodeURIComponent(query)}&language=${lang}&apikey=${apiKey}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.status !== "success") throw new Error(data.message || "NewsData error");
      articles = (data.results || []).map(a => normalise_newsdata(a));
    }

    // ════════════════════════════════
    // 4. THE GUARDIAN  (free, real-time, no delay)
    // ════════════════════════════════
    else if (provider === "guardian") {
      const endpoint = `https://content.guardianapis.com/search?q=${encodeURIComponent(query||"war conflict")}&show-fields=thumbnail,trailText,headline&order-by=newest&page-size=${pageSize||30}&api-key=${apiKey}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.response?.status !== "ok") throw new Error("Guardian API error");
      articles = (data.response?.results || []).map(a => normalise_guardian(a));
    }

    else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ status: "ok", totalResults: articles.length, articles }),
    };

  } catch (err) {
    console.error("[fetch-news]", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ status: "error", message: err.message, articles: [] }) };
  }
};

// ════════════════════════════════
// NORMALIZERS — all return same shape
// ════════════════════════════════
function normalise_newsapi(a) {
  return {
    title: a.title || "",
    description: a.description || "",
    url: a.url || "",
    urlToImage: a.urlToImage || null,
    publishedAt: a.publishedAt || new Date().toISOString(),
    source: { name: a.source?.name || "NewsAPI" },
    content: a.content || "",
    _provider: "newsapi",
  };
}

function normalise_gnews(a) {
  return {
    title: a.title || "",
    description: a.description || "",
    url: a.url || "",
    urlToImage: a.image || null,
    publishedAt: a.publishedAt || new Date().toISOString(),
    source: { name: a.source?.name || "GNews" },
    content: a.content || "",
    _provider: "gnews",
  };
}

function normalise_newsdata(a) {
  return {
    title: a.title || "",
    description: a.description || a.content || "",
    url: a.link || "",
    urlToImage: a.image_url || null,
    publishedAt: a.pubDate || new Date().toISOString(),
    source: { name: a.source_name || a.source_id || "NewsData" },
    content: a.content || "",
    _provider: "newsdata",
    _videoUrl: a.video_url || null,   // NewsData sometimes includes video!
  };
}

function normalise_guardian(a) {
  return {
    title: a.fields?.headline || a.webTitle || "",
    description: a.fields?.trailText || "",
    url: a.webUrl || "",
    urlToImage: a.fields?.thumbnail || null,
    publishedAt: a.webPublicationDate || new Date().toISOString(),
    source: { name: "The Guardian" },
    content: "",
    _provider: "guardian",
  };
}
