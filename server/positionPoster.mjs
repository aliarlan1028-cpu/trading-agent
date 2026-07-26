import { nowIso } from "./store.mjs";

const WIDTH = 1080;
const HEIGHT = 1440;

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, digits = 2) {
  const parsed = number(value);
  if (parsed === null) return "-";
  const abs = Math.abs(parsed);
  const fractionDigits = abs >= 1000 ? 2 : abs >= 1 ? digits : 5;
  return parsed.toLocaleString("en-US", { maximumFractionDigits: fractionDigits });
}

function money(value) {
  const parsed = number(value);
  if (parsed === null) return "-";
  const sign = parsed > 0 ? "+" : parsed < 0 ? "-" : "";
  return `${sign}${Math.abs(parsed).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT`;
}

function normalizeSide(position = {}) {
  const raw = String(position.direction || position.posSide || position.positionSide || position.side || "").toLowerCase();
  if (raw.includes("short") || raw.includes("空") || raw === "sell") return "SHORT";
  return "LONG";
}

export function derivePositionShare(position = {}) {
  const side = normalizeSide(position);
  const entry = number(position.entry ?? position.entryPrice ?? position.avgPx ?? position.avgPrice);
  const mark = number(position.mark ?? position.markPrice ?? position.lastPrice);
  const size = number(position.size ?? position.pos ?? position.positionAmt ?? position.quantity);
  const leverage = number(position.leverage ?? position.lever);
  const pnl = number(position.pnl ?? position.upl ?? position.unrealizedPnl);
  const sign = side === "SHORT" ? -1 : 1;
  const computedPnl = pnl ?? (entry !== null && mark !== null && size !== null ? (mark - entry) * size * sign : null);
  const margin = entry !== null && size !== null && leverage ? Math.abs(entry * size) / leverage : null;
  const roiPct = number(position.roiPct ?? position.pnlRatio ?? position.uplRatio);
  const computedRoiPct = roiPct !== null
    ? (Math.abs(roiPct) <= 3 ? roiPct * 100 : roiPct)
    : (margin ? (computedPnl / margin) * 100 : null);
  const notional = entry !== null && size !== null ? Math.abs(entry * size) : number(position.notionalUsdt ?? position.notionalUsd ?? position.notional);

  return {
    id: position.id || `${position.exchange || "EX"}:${position.symbol || position.instId || "UNKNOWN"}:${side}`,
    exchange: String(position.exchange || position.sourceExchange || "AI").toUpperCase(),
    symbol: position.symbol || position.instId || "UNKNOWN",
    side,
    entry,
    mark,
    size,
    leverage,
    pnl: computedPnl,
    roiPct: computedRoiPct,
    notional,
    createdAt: position.createdAt,
    updatedAt: position.updatedAt || position.monitoredAt || nowIso()
  };
}

function buildPositionPosterSvg(position = {}) {
  const share = derivePositionShare(position);
  const isWin = Number(share.pnl || 0) >= 0;
  const sideFill = share.side === "SHORT" ? "#ff7a59" : "#19c37d";
  const roiText = share.roiPct === null ? "+" : `${share.roiPct >= 0 ? "+" : ""}${share.roiPct.toFixed(2)}%`;
  const title = `${share.symbol} ${share.side}`;
  const updated = new Date(share.updatedAt || Date.now()).toLocaleString("zh-CN", { hour12: false });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c111d"/>
      <stop offset="0.55" stop-color="#111827"/>
      <stop offset="1" stop-color="#08130f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${isWin ? "#19c37d" : "#ff6b6b"}"/>
      <stop offset="1" stop-color="#f4c430"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000000" flood-opacity="0.38"/>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="0" fill="url(#bg)"/>
  <path d="M0 0H1080V360C915 305 758 295 610 330C438 371 289 479 0 440Z" fill="#172033" opacity="0.82"/>
  <path d="M1080 1440H0V1058C184 1118 344 1134 504 1097C701 1051 852 934 1080 942Z" fill="#10261d" opacity="0.76"/>
  <rect x="74" y="78" width="932" height="1190" rx="44" fill="#111827" opacity="0.94" filter="url(#softShadow)"/>
  <rect x="74" y="78" width="932" height="1190" rx="44" fill="none" stroke="#2b3548" stroke-width="2"/>

  <text x="126" y="168" fill="#dbe7ff" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="800">AI Trading Agent</text>
  <text x="126" y="214" fill="#7f8ca3" font-family="Inter, Arial, sans-serif" font-size="24">Position Share Poster</text>
  <rect x="805" y="130" width="150" height="56" rx="28" fill="${sideFill}" opacity="0.16"/>
  <text x="880" y="168" text-anchor="middle" fill="${sideFill}" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800">${escapeXml(share.side)}</text>

  <text x="126" y="322" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="70" font-weight="900">${escapeXml(title)}</text>
  <text x="126" y="382" fill="#8d99ad" font-family="Inter, Arial, sans-serif" font-size="28">${escapeXml(share.exchange)} 永续合约 · ${escapeXml(updated)}</text>

  <rect x="126" y="455" width="828" height="280" rx="32" fill="#0b1220" stroke="#253047" stroke-width="2"/>
  <text x="166" y="524" fill="#8d99ad" font-family="Inter, Arial, sans-serif" font-size="28">未实现收益率</text>
  <text x="166" y="646" fill="url(#accent)" font-family="Inter, Arial, sans-serif" font-size="118" font-weight="900">${escapeXml(roiText)}</text>
  <text x="166" y="700" fill="${isWin ? "#19c37d" : "#ff6b6b"}" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800">${escapeXml(money(share.pnl))}</text>

  <g font-family="Inter, Arial, sans-serif">
    <rect x="126" y="790" width="390" height="138" rx="24" fill="#151f31"/>
    <text x="162" y="842" fill="#8d99ad" font-size="24">开仓均价</text>
    <text x="162" y="894" fill="#f6f8fb" font-size="38" font-weight="800">${escapeXml(compact(share.entry))}</text>

    <rect x="564" y="790" width="390" height="138" rx="24" fill="#151f31"/>
    <text x="600" y="842" fill="#8d99ad" font-size="24">标记价格</text>
    <text x="600" y="894" fill="#f6f8fb" font-size="38" font-weight="800">${escapeXml(compact(share.mark))}</text>

    <rect x="126" y="962" width="390" height="138" rx="24" fill="#151f31"/>
    <text x="162" y="1014" fill="#8d99ad" font-size="24">仓位数量</text>
    <text x="162" y="1066" fill="#f6f8fb" font-size="38" font-weight="800">${escapeXml(compact(share.size, 4))}</text>

    <rect x="564" y="962" width="390" height="138" rx="24" fill="#151f31"/>
    <text x="600" y="1014" fill="#8d99ad" font-size="24">杠杆 / 名义价值</text>
    <text x="600" y="1066" fill="#f6f8fb" font-size="38" font-weight="800">${escapeXml(share.leverage ? `${compact(share.leverage, 1)}x` : "-")} · ${escapeXml(compact(share.notional))}</text>
  </g>

  <rect x="126" y="1168" width="828" height="2" fill="#253047"/>
  <text x="126" y="1228" fill="#8d99ad" font-family="Inter, Arial, sans-serif" font-size="24">自动生成自本地 AI 交易系统。非投资建议。</text>
  <text x="126" y="1328" fill="#536075" font-family="Inter, Arial, sans-serif" font-size="22">Powered by Binance / OKX account data</text>
</svg>`;
}

export async function renderPositionPoster(position = {}) {
  const svg = buildPositionPosterSvg(position);
  try {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { buffer, filename: `${derivePositionShare(position).symbol.replaceAll("/", "")}-position.png`, contentType: "image/png", type: "photo" };
  } catch (error) {
    return {
      buffer: Buffer.from(svg),
      filename: `${derivePositionShare(position).symbol.replaceAll("/", "")}-position.svg`,
      contentType: "image/svg+xml",
      type: "document",
      renderError: error.message
    };
  }
}
