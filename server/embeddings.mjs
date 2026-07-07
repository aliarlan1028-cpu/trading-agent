// ---------------------------------------------------------------------------
// 语义向量 embedding：把知识片段与查询映射到稠密向量空间，
// 让"意思相近但用词不同"也能被检索到（远强于词频匹配）。
// 自动探测可用的 embedding 服务；都没有时返回 null，由调用方回退到词频检索。
// 网络请求走全局 undici 代理（netProxy 已装），无需额外处理。
// ---------------------------------------------------------------------------

const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";

export function embeddingProvider() {
  const override = String(process.env.EMBEDDING_PROVIDER || "").toLowerCase();
  if ((!override || override === "openai") && process.env.OPENAI_API_KEY) {
    return { name: "openai", model: process.env.EMBEDDING_MODEL || "text-embedding-3-small" };
  }
  if ((!override || override === "gemini") && process.env.GEMINI_API_KEY) {
    // text-embedding-004 已被 Google 弃用，改用当前 GA 的 gemini-embedding-001
    return { name: "gemini", model: process.env.EMBEDDING_MODEL || "gemini-embedding-001" };
  }
  return null;
}

async function openaiEmbed(model, inputs) {
  const response = await fetch(OPENAI_EMBED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, input: inputs, encoding_format: "float" })
  });
  if (!response.ok) throw new Error(`OpenAI embeddings ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = await response.json();
  return (json.data || []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

async function geminiEmbed(model, inputs) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: inputs.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] } })) })
  });
  if (!response.ok) throw new Error(`Gemini embeddings ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = await response.json();
  return (json.embeddings || []).map((item) => item.values);
}

// 批量嵌入；无 provider 返回 null。文本超长做截断，避免超 token。
export async function embedBatch(texts) {
  const provider = embeddingProvider();
  if (!provider) return null;
  const cleaned = texts.map((text) => String(text || "").slice(0, 8000) || " ");
  const batchSize = provider.name === "openai" ? 96 : 32;
  const out = [];
  for (let i = 0; i < cleaned.length; i += batchSize) {
    const slice = cleaned.slice(i, i + batchSize);
    const vectors = provider.name === "openai"
      ? await openaiEmbed(provider.model, slice)
      : await geminiEmbed(provider.model, slice);
    out.push(...vectors);
  }
  return out;
}

export async function embedOne(text) {
  const vectors = await embedBatch([text]);
  return vectors?.[0] || null;
}

export function denseCosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
