// ai-caption.js
// Translation: Free Google Translate (no API key needed)
// Caption generation: Template-based (no AI key needed)

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
    const { mode, caption, title, description, source, url } = body;

    // ══════════════════════════════════════
    // MODE: translate  — Free Google Translate
    // ══════════════════════════════════════
    if (mode === "translate") {
      if (!caption) throw new Error("Missing caption");

      // Split caption into chunks ≤ 4000 chars (Google limit)
      const chunks = splitIntoChunks(caption, 3500);
      const translatedChunks = [];

      for (const chunk of chunks) {
        const translated = await googleTranslate(chunk, "si"); // si = Sinhala
        translatedChunks.push(translated);
      }

      const fullTranslation = translatedChunks.join(" ");
      return { statusCode: 200, headers, body: JSON.stringify({ text: fullTranslation }) };
    }

    // ══════════════════════════════════════
    // MODE: caption  — Smart template generation
    // ══════════════════════════════════════
    if (mode === "caption") {
      const isBreaking = /war|attack|kill|strike|explosion|ceasefire|invasion|airstrike|missile|casualties/i.test(title + " " + description);
      const emoji = isBreaking ? "🚨" : "📰";
      const tag   = isBreaking ? "BREAKING: " : "";

      const caption = `${emoji} ${tag}${title}

${description || ""}

📍 Source: ${source}
🔗 Read more: ${url}

#BreakingNews #WorldNews #${source.replace(/\s+/g, "")} ${isBreaking ? "#Breaking #Urgent" : "#GlobalNews"}`;

      return { statusCode: 200, headers, body: JSON.stringify({ text: caption.trim() }) };
    }

    throw new Error("Invalid mode — use 'caption' or 'translate'");

  } catch (err) {
    console.error("[ai-caption]", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ══════════════════════════════════════
// FREE GOOGLE TRANSLATE (no API key)
// Uses the same endpoint the Google Translate website uses
// ══════════════════════════════════════
async function googleTranslate(text, targetLang, sourceLang = "en") {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) throw new Error(`Google Translate error: HTTP ${res.status}`);

  const data = await res.json();

  // Response format: [ [ ["translated","original",null,null,1], ... ], ... ]
  const translated = data[0]
    .filter(item => item && item[0])
    .map(item => item[0])
    .join("");

  if (!translated) throw new Error("Empty translation from Google");
  return translated;
}

// Split long text preserving sentence boundaries
function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let current = "";
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    if ((current + sentence).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}
