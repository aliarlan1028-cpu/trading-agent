export const RECOMMENDED_PROVIDER_MODELS = Object.freeze({
  gemini: "google/gemini-3.1-pro-preview",
  deepseek: "deepseek-v4-pro"
});

const FALLBACK_PROVIDER_MODELS = Object.freeze({
  gemini: Object.freeze([
    { id: "google/gemini-3.1-pro-preview", name: "Google: Gemini 3.1 Pro Preview" },
    { id: "google/gemini-3.7-flash", name: "Google: Gemini 3.7 Flash" },
    { id: "google/gemini-3.6-flash", name: "Google: Gemini 3.6 Flash" }
  ]),
  deepseek: Object.freeze([
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner" }
  ])
});

function normalizeCatalogRow(row) {
  if (typeof row === "string") return { id: row, name: row };
  const id = String(row?.id || "").trim();
  return id ? { ...row, id, name: String(row.name || id) } : null;
}

export function buildProviderModelOptions(provider, remoteCatalog = [], selectedModel = "") {
  const byId = new Map();
  const add = (row) => {
    const normalized = normalizeCatalogRow(row);
    if (!normalized) return;
    byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...normalized });
  };

  // Keep the recommended production choices visible even when a provider's live
  // catalog is temporarily incomplete, then merge every compatible live model.
  (FALLBACK_PROVIDER_MODELS[provider] || []).forEach(add);
  (Array.isArray(remoteCatalog) ? remoteCatalog : []).forEach(add);
  if (selectedModel && !byId.has(selectedModel)) add({ id: selectedModel, name: selectedModel });

  const recommended = RECOMMENDED_PROVIDER_MODELS[provider];
  return [...byId.values()]
    .map((model) => ({ ...model, recommended: model.id === recommended }))
    .sort((left, right) => Number(right.recommended) - Number(left.recommended));
}
