import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import { nowIso } from "./store.mjs";

const WIDTH = 1080;
const HEIGHT = 1440;
const SITE_URL = process.env.POSTER_SITE_URL || "https://yegidawir.xyz/";
const KORDYN_LOGO_DATA_URL = `data:image/png;base64,${readFileSync(new URL("../public/kordyn-logo.png", import.meta.url)).toString("base64")}`;
// 装了 fonts-noto-cjk + fonts-dejavu-core(见 Dockerfile),librsvg 才能渲染中英文字。
const FONT = "'Noto Sans CJK SC','DejaVu Sans','Inter',Arial,sans-serif";

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
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
function holdLabel(start, end) {
  const s = start ? new Date(start).getTime() : NaN;
  const e = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(s) || e <= s) return null;
  const mins = Math.floor((e - s) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
}

export function derivePositionShare(position = {}) {
  const side = normalizeSide(position);
  const entry = number(position.entry ?? position.entryPrice ?? position.avgPx ?? position.avgPrice);
  const mark = number(position.mark ?? position.markPrice ?? position.lastPrice);
  const rawSize = number(position.size ?? position.pos ?? position.positionAmt ?? position.quantity);
  const coins = number(position.coinSize) ?? rawSize; // 交易所仓 size 是合约张数,coinSize 才是币量
  const leverage = number(position.leverage ?? position.lever);
  const pnl = number(position.pnl ?? position.upl ?? position.unrealizedPnl);
  const sign = side === "SHORT" ? -1 : 1;
  const computedPnl = pnl ?? (entry !== null && mark !== null && coins !== null ? (mark - entry) * coins * sign : null);
  const notional = coins !== null && mark !== null ? Math.abs(coins * mark) : (entry !== null && coins !== null ? Math.abs(entry * coins) : number(position.notionalUsdt ?? position.notional));
  const margin = notional !== null && leverage ? notional / leverage : null;
  const roiPct = number(position.roiPct ?? position.pnlRatio ?? position.uplRatio);
  const computedRoiPct = roiPct !== null ? roiPct : (margin ? (computedPnl / margin) * 100 : null);

  return {
    id: position.id || `${position.exchange || "EX"}:${position.symbol || position.instId || "UNKNOWN"}:${side}`,
    exchange: String(position.exchange || position.sourceExchange || "AI").toUpperCase(),
    symbol: position.symbol || position.instId || "UNKNOWN",
    side,
    entry,
    mark,
    size: coins,
    leverage,
    pnl: computedPnl,
    roiPct: computedRoiPct,
    notional,
    stopLoss: number(position.stopLoss ?? position.stop_loss),
    takeProfit: number((position.takeProfits || position.take_profit || [])[0] ?? position.takeProfit),
    holdLabel: holdLabel(position.openedAt || position.createdAt, position.updatedAt || position.monitoredAt || nowIso()),
    createdAt: position.createdAt,
    updatedAt: position.updatedAt || position.monitoredAt || nowIso()
  };
}

async function qrImage(url, px) {
  try {
    return await QRCode.toDataURL(url, { margin: 1, width: px, errorCorrectionLevel: "M", color: { dark: "#0b1220", light: "#ffffff" } });
  } catch { return null; }
}

async function buildPositionPosterSvg(position = {}) {
  const s = derivePositionShare(position);
  const isLong = s.side === "LONG";
  const isWin = Number(s.pnl || 0) >= 0;
  const dirColor = isLong ? "#3ad6c0" : "#ffb24c";       // 方向色:多=青 / 空=橙
  const pnlColor = isWin ? "#16d191" : "#ff6b6b";        // 盈亏色:盈=绿 / 亏=红(与方向色独立)
  const dirLabel = isLong ? "▲ 做多 LONG" : "▼ 做空 SHORT";
  const roiText = s.roiPct === null ? "—" : `${s.roiPct >= 0 ? "+" : "−"}${Math.abs(s.roiPct).toFixed(1)}%`;
  const updated = new Date(s.updatedAt || Date.now()).toLocaleString("zh-CN", { hour12: false });
  const metaBits = [s.leverage ? `${compact(s.leverage, 1)}×` : null, s.notional !== null ? `名义 ${compact(s.notional)} USDT` : null, s.holdLabel ? `持仓 ${s.holdLabel}` : null].filter(Boolean).join("  ·  ");
  const qr = await qrImage(SITE_URL, 380);

  // 数据格:开仓 / 现价 / 止损(红) / 止盈(绿),y 全部在页脚带之上,不再重合
  const cell = (x, y, k, v, vColor = "#f4f8ff") => `
    <rect x="${x}" y="${y}" width="440" height="150" rx="22" fill="rgba(255,255,255,0.035)"/>
    <text x="${x + 30}" y="${y + 52}" fill="#8d99ad" font-family="${FONT}" font-size="26">${escapeXml(k)}</text>
    <text x="${x + 30}" y="${y + 112}" fill="${vColor}" font-family="${FONT}" font-size="46" font-weight="800">${escapeXml(v)}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <radialGradient id="bg" cx="18%" cy="0%" r="130%">
      <stop offset="0" stop-color="${isLong ? "#16203a" : "#2a1620"}"/>
      <stop offset="0.55" stop-color="${isLong ? "#0d1424" : "#1a0e18"}"/>
      <stop offset="1" stop-color="${isLong ? "#070c16" : "#0b0709"}"/>
    </radialGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dirColor}"/><stop offset="1" stop-color="${isLong ? "#16d191" : "#ff8a4c"}"/></linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="14" fill="url(#accent)"/>

  <!-- 品牌行 -->
  <image x="80" y="65" width="92" height="98" preserveAspectRatio="xMidYMid meet" xlink:href="${KORDYN_LOGO_DATA_URL}"/>
  <text x="194" y="112" fill="#eaf0fb" font-family="${FONT}" font-size="38" font-weight="800" letter-spacing="3">KORDYN</text>
  <text x="194" y="150" fill="#7f8ca3" font-family="${FONT}" font-size="20" letter-spacing="3">AI TRADING AGENT</text>
  <text x="1000" y="128" text-anchor="end" fill="#7f8ca3" font-family="${FONT}" font-size="24">${escapeXml(s.exchange)} 永续</text>

  <!-- 方向徽章 + 币种 + meta -->
  <rect x="80" y="214" width="${isLong ? 210 : 224}" height="58" rx="14" fill="${dirColor}" opacity="0.16"/>
  <text x="${80 + (isLong ? 210 : 224) / 2}" y="253" text-anchor="middle" fill="${dirColor}" font-family="${FONT}" font-size="30" font-weight="800">${escapeXml(dirLabel)}</text>
  <text x="80" y="372" fill="#ffffff" font-family="${FONT}" font-size="84" font-weight="900">${escapeXml(s.symbol)}</text>
  <text x="80" y="424" fill="#9aa6bd" font-family="${FONT}" font-size="28">${escapeXml(metaBits || "—")}</text>

  <!-- Hero:ROI 大字 + 盈亏 -->
  <rect x="80" y="472" width="920" height="250" rx="28" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" stroke-width="2"/>
  <text x="120" y="546" fill="#8d99ad" font-family="${FONT}" font-size="28">未实现收益率 (ROI)</text>
  <text x="120" y="656" fill="${pnlColor}" font-family="${FONT}" font-size="120" font-weight="900">${escapeXml(roiText)}</text>
  <text x="120" y="700" fill="${pnlColor}" font-family="${FONT}" font-size="40" font-weight="800">${escapeXml(money(s.pnl))}</text>

  <!-- 数据格 -->
  ${cell(80, 772, "开仓均价", compact(s.entry))}
  ${cell(560, 772, "当前标记价", compact(s.mark))}
  ${cell(80, 942, "止损", s.stopLoss !== null ? compact(s.stopLoss) : "—", "#ff8a8a")}
  ${cell(560, 942, "止盈", s.takeProfit !== null ? compact(s.takeProfit) : "—", "#7fe3b8")}

  <!-- 页脚带:二维码(右) + 文案(左),与数据格之间留白,不重合 -->
  <rect x="80" y="1150" width="920" height="2" fill="rgba(255,255,255,0.08)"/>
  ${qr ? `<rect x="784" y="1176" width="216" height="216" rx="20" fill="#ffffff"/><image x="797" y="1189" width="190" height="190" xlink:href="${qr}"/>` : ""}
  <text x="80" y="1224" fill="#c7d2e6" font-family="${FONT}" font-size="30" font-weight="700">扫码体验 AI 自主交易</text>
  <text x="80" y="1272" fill="#7f8ca3" font-family="${FONT}" font-size="26">${escapeXml(SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</text>
  <text x="80" y="1344" fill="#6d7994" font-family="${FONT}" font-size="24">AI 自动生成 · 非投资建议</text>
  <text x="80" y="1384" fill="#55627c" font-family="${FONT}" font-size="22">${escapeXml(updated)}</text>
</svg>`;
}

export async function renderPositionPoster(position = {}) {
  const svg = await buildPositionPosterSvg(position);
  const symbol = derivePositionShare(position).symbol.replaceAll("/", "");
  try {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { buffer, filename: `${symbol}-position.png`, contentType: "image/png", type: "photo" };
  } catch (error) {
    return { buffer: Buffer.from(svg), filename: `${symbol}-position.svg`, contentType: "image/svg+xml", type: "document", renderError: error.message };
  }
}

// 已平仓交易必须使用“已实现”口径，不能再复用持仓海报并写成当前价/浮盈。
export function deriveClosedTradeShare(trade = {}) {
  const side = normalizeSide(trade);
  const entry = number(trade.filledPrice ?? trade.entryPrice ?? trade.entry);
  const exit = number(trade.exitPrice ?? trade.price ?? trade.mark);
  const pnl = number(trade.realizedPnl);
  const feeUsdt = Math.abs(number(trade.feeUsdt, 0)) + Math.abs(number(trade.entryFeeUsdt, 0)) + Math.abs(number(trade.closeFeeUsdt, 0));
  const fundingFeeUsdt = number(trade.fundingFeeUsdt, 0);
  const leverage = number(trade.leverage);
  const quantity = number(trade.quantity ?? trade.size);
  const notional = number(trade.notionalUsdt ?? trade.entryNotionalUsdt) ?? (entry !== null && quantity !== null ? Math.abs(entry * quantity) : null);
  const margin = number(trade.marginUsdt) ?? (notional !== null && leverage ? notional / leverage : null);
  const roiPct = number(trade.realizedRoiPct) ?? (pnl !== null && margin ? pnl / margin * 100 : null);
  return {
    symbol: trade.symbol || trade.instId || "UNKNOWN", side, entry, exit, pnl, feeUsdt, fundingFeeUsdt,
    leverage, notional, roiPct, quantity,
    holdLabel: trade.holdingMinutes != null ? `${Math.floor(Number(trade.holdingMinutes) / 60)}h${String(Number(trade.holdingMinutes) % 60).padStart(2, "0")}m` : holdLabel(trade.openedAt || trade.entryFilledAt || trade.createdAt, trade.closedAt),
    exchange: String(trade.exchange || "OKX").toUpperCase(), closedAt: trade.closedAt || trade.createdAt || nowIso(),
    exitReason: trade.exitReason || null
  };
}

async function buildClosedTradePosterSvg(trade = {}) {
  const s = deriveClosedTradeShare(trade), win = Number(s.pnl || 0) >= 0, long = s.side === "LONG";
  const accent = long ? "#3ad6c0" : "#ffb24c", pnlColor = win ? "#16d191" : "#ff6b6b";
  const qr = await qrImage(SITE_URL, 300);
  const roi = s.roiPct === null ? "—" : `${s.roiPct >= 0 ? "+" : "−"}${Math.abs(s.roiPct).toFixed(2)}%`;
  const meta = [s.leverage ? `${compact(s.leverage, 1)}×` : null, s.holdLabel ? `持仓 ${s.holdLabel}` : null, s.exitReason ? `退出 ${s.exitReason}` : null].filter(Boolean).join("  ·  ");
  const cell = (x, y, label, value, color = "#f4f8ff") => `<rect x="${x}" y="${y}" width="440" height="142" rx="22" fill="rgba(255,255,255,.04)"/><text x="${x+28}" y="${y+48}" fill="#8d99ad" font-family="${FONT}" font-size="25">${escapeXml(label)}</text><text x="${x+28}" y="${y+104}" fill="${color}" font-family="${FONT}" font-size="42" font-weight="800">${escapeXml(value)}</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?><svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><radialGradient id="closedBg" cx="15%" cy="0" r="130%"><stop offset="0" stop-color="${long ? "#18243a" : "#2d1920"}"/><stop offset="1" stop-color="#080c14"/></radialGradient></defs><rect width="1080" height="1440" fill="url(#closedBg)"/><rect width="1080" height="14" fill="${accent}"/><image x="80" y="63" width="92" height="98" preserveAspectRatio="xMidYMid meet" xlink:href="${KORDYN_LOGO_DATA_URL}"/><text x="194" y="109" fill="#f4f8ff" font-family="${FONT}" font-size="38" font-weight="800" letter-spacing="3">KORDYN</text><text x="194" y="148" fill="#8896ac" font-family="${FONT}" font-size="20" letter-spacing="3">REALIZED TRADE RESULT</text><rect x="80" y="212" width="250" height="58" rx="14" fill="${accent}" opacity=".16"/><text x="205" y="251" text-anchor="middle" fill="${accent}" font-family="${FONT}" font-size="28" font-weight="800">✓ 已平仓 ${escapeXml(s.side)}</text><text x="80" y="370" fill="#fff" font-family="${FONT}" font-size="82" font-weight="900">${escapeXml(s.symbol)}</text><text x="80" y="422" fill="#9aa6bd" font-family="${FONT}" font-size="27">${escapeXml(meta || "真实成交结果")}</text><rect x="80" y="470" width="920" height="265" rx="28" fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.08)"/><text x="120" y="542" fill="#8d99ad" font-family="${FONT}" font-size="28">已实现盈亏（交易系统记录）</text><text x="120" y="648" fill="${pnlColor}" font-family="${FONT}" font-size="102" font-weight="900">${escapeXml(money(s.pnl))}</text><text x="120" y="700" fill="${pnlColor}" font-family="${FONT}" font-size="38" font-weight="800">收益率 ${escapeXml(roi)}</text>${cell(80,775,"开仓均价",compact(s.entry))}${cell(560,775,"平仓均价",compact(s.exit))}${cell(80,937,"成交数量",compact(s.quantity))}${cell(560,937,"手续费（单列）",`${s.feeUsdt ? "−" : ""}${compact(s.feeUsdt,4)} USDT`,"#ffcf80")}<text x="80" y="1138" fill="#75839a" font-family="${FONT}" font-size="23">资金费：${escapeXml(money(s.fundingFeeUsdt))} · 数据来源：${escapeXml(s.exchange)} 成交与 OMS 对账</text><rect x="80" y="1178" width="920" height="2" fill="rgba(255,255,255,.08)"/>${qr?`<rect x="800" y="1204" width="200" height="200" rx="18" fill="#fff"/><image x="812" y="1216" width="176" height="176" xlink:href="${qr}"/>`:""}<text x="80" y="1250" fill="#d3dceb" font-family="${FONT}" font-size="30" font-weight="700">KORDYN · 数字货币永续合约专属 Agent</text><text x="80" y="1300" fill="#7f8ca3" font-family="${FONT}" font-size="25">${escapeXml(SITE_URL.replace(/^https?:\/\//,"").replace(/\/$/,""))}</text><text x="80" y="1370" fill="#617088" font-family="${FONT}" font-size="22">真实成交结果 · 非投资建议 · ${escapeXml(new Date(s.closedAt).toLocaleString("zh-CN",{hour12:false}))}</text></svg>`;
}

export async function renderClosedTradePoster(trade = {}) {
  const svg = await buildClosedTradePosterSvg(trade);
  const symbol = deriveClosedTradeShare(trade).symbol.replaceAll("/", "");
  try {
    const sharp = (await import("sharp")).default;
    return { buffer: await sharp(Buffer.from(svg)).png().toBuffer(), filename: `${symbol}-realized.png`, contentType: "image/png", type: "photo" };
  } catch (error) {
    return { buffer: Buffer.from(svg), filename: `${symbol}-realized.svg`, contentType: "image/svg+xml", type: "document", renderError: error.message };
  }
}
