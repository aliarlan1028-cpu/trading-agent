// P1 链上/基本面:免费源(DefiLlama,无需 key)拉真实链上资金面——全网 DeFi TVL、主要公链 TVL、
// 稳定币总市值。语义:TVL 上升=资金进链上/风险偏好升;稳定币供应扩张=场内买力增强(常为中期利多背景)。
// 付费维度(巨鲸/交易所净流/代币解锁)需 Glassnode/Nansen 等数据源,未配置则如实标"未接",不编造。
import { nowIso, appendTrace } from "./store.mjs";

const LLAMA = "https://api.llama.fi";
const STABLE = "https://stablecoins.llama.fi";

async function getJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { signal: ctrl.signal }); return await r.json(); } finally { clearTimeout(t); }
}

export async function fetchOnchainFundamentals(db) {
  const out = { at: nowIso(), source: "defillama", available: false };
  try {
    const chains = await getJson(`${LLAMA}/v2/chains`);
    if (Array.isArray(chains) && chains.length) {
      out.totalTvlUsd = Math.round(chains.reduce((s, c) => s + (Number(c.tvl) || 0), 0));
      out.topChains = chains.filter((c) => Number(c.tvl) > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 6).map((c) => ({ name: c.name, tvl: Math.round(c.tvl), tokenSymbol: c.tokenSymbol }));
      out.available = true;
    }
  } catch (e) { out.tvlError = String(e.message || e).slice(0, 80); }
  try {
    const stable = await getJson(`${STABLE}/stablecoins?includePrices=false`);
    const mcap = (stable?.peggedAssets || []).reduce((s, a) => s + (Number(a.circulating?.peggedUSD) || 0), 0);
    if (mcap > 0) { out.stableMcapUsd = Math.round(mcap); out.available = true; }
  } catch (e) { out.stableError = String(e.message || e).slice(0, 80); }
  out.advanced = onchainAdvancedStatus();
  db.onchain = out;
  appendTrace(db, "onchain", `链上基本面 TVL ${out.totalTvlUsd ? "$" + (out.totalTvlUsd / 1e9).toFixed(1) + "B" : "—"}`, out.available ? "ok" : "warning");
  return out;
}

export function onchainBriefForPrompt(db) {
  const o = db.onchain;
  if (!o || !o.available) return null;
  const bits = [];
  if (o.totalTvlUsd) bits.push(`全网 DeFi TVL $${(o.totalTvlUsd / 1e9).toFixed(1)}B`);
  if (o.stableMcapUsd) bits.push(`稳定币总市值 $${(o.stableMcapUsd / 1e9).toFixed(1)}B（场内买力代理）`);
  if (o.topChains?.length) bits.push(`主要公链 TVL：${o.topChains.slice(0, 4).map((c) => `${c.name} $${(c.tvl / 1e9).toFixed(1)}B`).join("、")}`);
  const need = Object.entries(o.advanced || {}).filter(([, v]) => v === "needs_data_source").map(([k]) => k);
  if (need.length) bits.push(`（巨鲸/净流/解锁 未接数据源，勿臆断）`);
  return bits.length ? bits.join("；") : null;
}

// 付费/高级维度的接线状态:未配置 key 就是 needs_data_source,前端/提示词据此如实标注,不假装有。
export function onchainAdvancedStatus() {
  return {
    whaleFlows: process.env.NANSEN_API_KEY ? "configured" : "needs_data_source",
    exchangeNetflow: process.env.GLASSNODE_API_KEY ? "configured" : "needs_data_source",
    tokenUnlocks: "needs_data_source"
  };
}
