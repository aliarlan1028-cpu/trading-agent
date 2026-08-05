import React, { useEffect, useRef, useState } from "react";
import { t } from "./i18n.js";

export function formatMoney(value, digits = 2) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// 价格按量级自适应精度：BTC 用 2 位、SUI(0.7x) 用 4 位、meme 币(0.00001x) 用更多位。
function priceDigits(value) {
  const a = Math.abs(Number(value) || 0);
  if (a === 0) return 2;
  if (a >= 1000) return 2;
  if (a >= 1) return 3;
  if (a >= 0.1) return 4;
  if (a >= 0.01) return 5;
  if (a >= 0.001) return 6;
  return 8;
}
export function displayPrice(value, fallback = "—") {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: priceDigits(number) });
}

export function displayMoney(value, digits = 2, fallback = "未同步") {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function displayPct(value, fallback = "未同步") {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(/[,，\n/]/).map((item) => item.trim()).filter(Boolean);
}

export function safeList(value, fallback = "-") {
  const items = asArray(value);
  return items.length ? items.join("、") : fallback;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

export function formatDateTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
}

export function formatDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" });
}

// 北京时间 HH:mm(全站时间统一 UTC+8;ISO 直接 slice 是 UTC 会差 8 小时)。
export function hhmmCn(value, fallback = "?") {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
}

export function formatTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Shanghai" });
}

export function formatDuration(value, fallback = "未记录") {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number < 1000) return `${Math.round(number)}ms`;
  return `${(number / 1000).toFixed(1)}s`;
}

export function humanize(value, fallback = "-") {
  const key = String(value || "").trim();
  if (!key) return fallback;
  const normalized = key.toLowerCase();
  const labels = {
    running: "运行中",
    active: "已生效",
    paused: "已暂停",
    revoked: "已撤销",
    pending_confirmation: "待确认",
    setup_required: "待配置",
    missing_credentials: "未配置",
    missing: "未授权",
    not_synced: "未同步",
    data_unavailable: "缺少数据",
    configured: "已配置",
    connected: "已连接",
    registered: "待连接",
    available_without_key: "免密钥可用",
    imported: "已导入",
    parsed: "已解析",
    empty: "无可用文本",
    degraded: "降级运行",
    ok: "正常",
    blocked: "已阻断",
    block: "阻断",
    kill_switch: "熔断",
    error: "异常",
    warning: "告警",
    failed: "失败",
    stopped: "已停止",
    completed: "已完成",
    open: "挂单中",
    allowed: "允许",
    allowed_with_warnings: "允许但有警告",
    allow_small_position: "允许小仓位",
    risk_rejected: "风控拒绝",
    setup_rejected: "结构审核未过",
    protection_failed: "保护单失败",
    cancelled: "已取消",
    canceled: "已取消",
    dry_run: "干跑(未下单)",
    executing: "执行中",
    entry_pending: "入场挂单中",
    entry_filled: "入场已成交",
    protecting: "止盈止损中",
    awaiting_approval: "等待确认",
    approved: "已批准",
    expired: "已过期作废",
    draft: "草案",
    monitoring: "持仓监控",
    submitted: "已提交",
    skipped_locked: "并发锁跳过",
    scheduled_task: "定时任务",
    risk_check: "风控检查",
    mandate: "授权检查",
    "mandate checking": "授权检查",
    observing: "观察市场",
    analyzing: "生成分析",
    planning: "生成计划",
    "risk checking": "风控检查",
    reconciling: "结算对账",
    reviewing: "复盘审查",
    agent_orchestrator: "Agent 编排",
    exchange_private_read: "交易所只读同步",
    exchange_market: "公开行情",
    realtime_ws: "实时连接",
    trade_execution: "交易执行",
    system: "系统",
    trend_pullback: "趋势回调",
    trend_following: "趋势跟随",
    event_protection: "事件保护",
    manual_review: "自主研判",
    event_driven: "事件驱动",
    breakout: "突破策略",
    spot: "现货",
    perpetual_usdt: "U 本位永续",
    perpetual: "永续合约"
  };
  return labels[key] || labels[normalized] || key.replace(/_/g, " ");
}

export function humanizeList(value, fallback = "-") {
  const items = asArray(value).map((item) => humanize(item));
  return items.length ? items.join("、") : fallback;
}

export function humanizePhase(value, fallback = "-") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) return fallback;
  if (normalized.includes("mandate") && normalized.includes("check")) return "授权检查";
  if (normalized.includes("risk") && normalized.includes("check")) return "风控检查";
  if (normalized.includes("observ")) return "观察市场";
  if (normalized.includes("analy")) return "生成分析";
  if (normalized.includes("plan")) return "生成计划";
  if (normalized.includes("execut")) return "执行交易";
  if (normalized.includes("reconcil")) return "结算对账";
  if (normalized.includes("review")) return "复盘审查";
  return humanize(value, fallback);
}

export function shortId(value, fallback = "未生成") {
  const text = String(value || "");
  if (!text) return fallback;
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

export function statusTone(status) {
  const value = String(status || "").toLowerCase();
  const raw = String(status || "");
  const dangerStates = ["blocked", "error", "failed", "rejected", "risk_rejected", "setup_rejected", "protection_failed", "已阻断", "异常", "失败", "已拒绝", "风控拒绝"];
  const warningStates = ["warning", "degraded", "skipped_locked", "allowed_with_warnings", "paused", "降级运行", "并发锁跳过", "允许但有警告", "已暂停", "告警", "人工暂停", "风控暂停"];
  const neutralStates = ["setup_required", "missing_credentials", "not_synced", "data_unavailable", "unconfigured", "cancelled", "canceled", "dry_run", "expired", "待配置", "未配置", "未同步", "缺少数据", "只读观察", "未启用", "未连接", "未生成", "未检查", "未授权", "未对账", "未记录", "未评估", "未测试", "未安装"];
  const infoStates = ["pending", "in_progress", "submitted", "queued", "awaiting_approval", "validating", "executing", "entry_pending", "entry_filled", "protecting", "验证中", "进行中", "待审批", "审批中", "同步中"];
  if (dangerStates.includes(value) || dangerStates.includes(raw)) return "danger";
  if (warningStates.includes(value) || warningStates.includes(raw)) return "warning";
  if (neutralStates.includes(value) || neutralStates.includes(raw)) return "neutral";
  if (infoStates.includes(value) || infoStates.includes(raw)) return "info";
  // 未识别状态默认中性，不再一律绿色 ok（"未*/未知"态曾被误染成绿色"正常"）。
  if (/^未|未知|unknown/.test(raw)) return "neutral";
  return "ok";
}

export function systemStatus(data) {
  if (data?.system?.killSwitch) return { label: "熔断中", tone: "danger" };
  if ((data?.exchangeAccounts || []).length && (data?.exchangeAccounts || []).every((account) => !account.readEnabled)) return { label: "待配置", tone: "warning" };
  if (!data?.system?.autonomyEnabled) return { label: "人工暂停", tone: "warning" };
  if (data?.agentStatus?.state === "risk_paused") return { label: "风控暂停", tone: "warning" };
  // tone 跟随文案：非"正常/运行"类状态（如种子值"等待配置"、"风控暂停"）不能带绿色 ok 渲染。
  const label = data?.system?.riskStatus || "正常";
  const tone = /正常|运行/.test(label) ? "ok" : /熔断|高/.test(label) ? "danger" : "warning";
  return { label, tone };
}

export function exchangeState(account = {}) {
  if (account.readEnabled && account.tradeEnabled) return { label: "交易可用", tone: "on" };
  if (account.readEnabled) return { label: "只读", tone: "warn" };
  return { label: "未配置", tone: "off" };
}

export function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

// 触觉反馈:只在原生 App 上震动(Web 无操作、失败静默)。动态引入避免影响 Web 包。
export async function haptic(style = "light") {
  try {
    if (!isNativeApp()) return;
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] || ImpactStyle.Light });
  } catch { /* 无 haptics 或不支持:忽略 */ }
}

function defaultApiBase() {
  const nativeFallback = nativeApiFallback();
  const stored = localStorage.getItem("agent_api_base") || "";
  if (isNativeApp()) {
    const invalidNativeBase = !stored || /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):|:5173\b/.test(stored);
    return normalizeApiBase(invalidNativeBase ? nativeFallback : stored);
  }
  const configured = stored || import.meta.env.VITE_API_BASE_URL || "";
  if (configured) return normalizeApiBase(configured);
  return "";
}

function nativeApiFallback() {
  return normalizeApiBase(import.meta.env.VITE_API_BASE_URL || "https://yegidawir.xyz");
}

function normalizeApiBase(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function apiUrl(path, baseOverride) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  let base = normalizeApiBase(baseOverride || localStorage.getItem("agent_api_base") || import.meta.env.VITE_API_BASE_URL || "");
  if (isNativeApp() && !base) base = nativeApiFallback();
  if (!base) return value;
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function connectionErrorMessage(error) {
  if (error?.name === "AbortError") return "连接超时，请确认后端地址可访问，推荐使用 https://yegidawir.xyz";
  return error?.message || "连接失败";
}

// 实时价 pub/sub：SSE 每个价格 tick 直接分发给订阅者（如 K 线图），不经 React 状态节流，
// 让图表能跟上 OKX 的逐 tick 更新；React 状态仍轻度节流避免整页高频重渲染。
const livePriceListeners = new Set();
function onLivePrice(fn) { livePriceListeners.add(fn); return () => livePriceListeners.delete(fn); }

// 大户持仓多空比 → 全端统一的偏向判定（阈值一处定义：≥1.05 偏多 / ≤0.95 偏空 / 之间平衡）。
// 注意语义：这是"持仓结构偏向"，不是趋势预测——展示词统一用"偏多/偏空"，不用"趋势"。
// 鉴权头（全站唯一实现；chat/assistant 曾各有一份副本）。
export function authHeaders(extra = {}) {
  const token = localStorage.getItem("agent_token") || "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// 在途执行单状态（与后端 executionEngine OPEN_EXECUTION_STATES 对齐；曾有 3 份复制、1 份写错）。
export const OPEN_EXECUTION_STATES = ["submitted", "entry_pending", "entry_partial", "entry_filled", "protecting"];
export function countOpenExecutions(orders = []) {
  return orders.filter((o) => OPEN_EXECUTION_STATES.includes(String(o.status || "").toLowerCase())).length;
}

// 知识技能生命周期 → 展示态映射（全站唯一来源；曾桌面/移动两副本且已漂移——
// tone 词表不同、移动缺 stage 与 degraded.next、文案不一致）。
// tone 用 statusTone 的标准词表（ok/warning/danger/info/neutral）：
// 移动 StatusBadge 直接消费；桌面 evBadge 用 EV_TONE 映射。
export const SKILL_STATE = {
  compile_failed: { label: "编译失败", tone: "danger", stage: null },
  compiled: { label: "待历史验证", tone: "warning", stage: "compiled", next: { action: "validate", label: "历史验证" } },
  historical_rejected: { label: "历史未通过", tone: "danger", stage: "compiled", next: { action: "validate", label: "重跑历史验证" } },
  historical_validated: { label: "待模拟", tone: "warning", stage: "validated", next: { action: "paper", label: "开始纯前向模拟" } },
  paper_validating: { label: "模拟中", tone: "info", stage: "papering" },
  paper_rejected: { label: "模拟未通过", tone: "danger", stage: "papering" },
  paper_validated: { label: "待批准", tone: "warning", stage: "approving", next: { action: "approve", label: "批准启用" } },
  live_probation: { label: "小额试用中", tone: "info", stage: "active" },
  active: { label: "已上岗", tone: "ok", stage: "active" },
  degraded: { label: "已降级", tone: "danger", stage: "active", next: { action: "validate", label: "重新验证" } },
  superseded: { label: "已被替代", tone: "neutral", stage: null },
  retired: { label: "已退役", tone: "neutral", stage: null }
};
// 桌面 evBadge 类名映射（evBadge 只有 ok/neg/warn 三个变体）。
export const EV_TONE = { ok: "ok", danger: "neg", warning: "warn", info: "warn", neutral: "" };
// 状态图例（桌面/移动共用一份释义）。
export const SKILL_STATE_HELP = [
  ["待历史验证", "warning", "已编译成可执行的入场/止损/止盈规则，等你点「历史验证」跑 40/30/30 三窗回测。"],
  ["历史未通过", "danger", "历史回测没达到门槛（盈亏因子 / 样本外表现），不能上岗；可修方法后重跑。"],
  ["待模拟 / 模拟中", "warning", "历史通过后进入「纯前向模拟盘」，用之后的真实行情逐笔积累样本，不回看历史。"],
  ["待批准", "warning", "模拟盘也达标了，等你人工批准——只有你亲自批准的技能才会进入实盘决策。"],
  ["小额试用中", "info", "已完成历史样本外验证、纯前向模拟与人工批准；当前仅在小额度内参与决策，用真实成绩复盘，达标转正、不达标退役。"],
  ["已上岗", "ok", "已用真实成绩转正（或人工批准），正在参与实盘计划生成。"],
  ["已降级", "danger", "上岗后实盘表现持续变差，被自动降级停用，需重新验证才能回归。"],
  ["编译失败", "danger", "方法无法安全映射到白名单策略模板（缺明确入场/止损/止盈，或周期、方向不受支持）；补全方法草案后可重编译。"],
  ["已被替代", "neutral", "同一来源方法有了更新版本，此旧版本被取代（保留供追溯）。"],
  ["已退役", "neutral", "已手动或自动退役，不再参与决策。"]
];

// 保证金占用统一口径（全站唯一实现，桌面/移动/对话页共用）：
// 已用 = 净值 − 可用 − 冻结；率 = 已用/净值。缺数据一律 null（显示"未同步"），
// 绝不回退 0 或净值——那会伪造出 100%/0% 的假数字（历史教训见 pages 旧注释）。
export function marginUsage(portfolio = {}) {
  const equity = Number(portfolio.totalEquityUsdt);
  const avail = portfolio.availableMarginUsdt ?? portfolio.availableMargin ?? null;
  if (avail == null || !Number.isFinite(equity) || equity <= 0) return { usedMarginUsdt: null, marginRatePct: null };
  const used = Math.max(0, equity - Number(avail) - Number(portfolio.frozenMarginUsdt ?? 0));
  return { usedMarginUsdt: used, marginRatePct: Math.min(100, Math.max(0, (used / equity) * 100)) };
}

export function smartMoneyBias(ratio) {
  const r = ratio == null ? null : Number(ratio);
  if (r == null || !Number.isFinite(r)) return { label: "待同步", tone: "neutral" };
  if (r >= 1.05) return { label: "大户偏多", tone: "pos" };
  if (r <= 0.95) return { label: "大户偏空", tone: "neg" };
  return { label: "多空平衡", tone: "neutral" };
}
function emitLivePrice(symbol, price) { for (const fn of livePriceListeners) { try { fn(symbol, price); } catch { /* noop */ } } }

// 共享 OKX tickers 直连管理：一条 WS 按 symbol 多路复用，标题/快照直接吃 OKX ~100ms 最新价，
// 和 K 线同源同速（不再经我们后端中转）。多个订阅者共用同一条连接。
const okxTickerSubs = new Map(); // symbol -> Set(cb)
let okxTickerWs = null;
let okxTickerPing = null;
let okxTickerReconnect = null;
let lastOkxTickerAt = 0; // 最近一次直连 OKX 收到 tick 的时间；用于判断是否还需 REST 轮询兜底
function okxTickerFresh(withinMs = 2500) { return Date.now() - lastOkxTickerAt < withinMs; }
function okxInstId(symbol) { return `${String(symbol).replace("/", "-").toUpperCase()}-SWAP`; }
function okxSendSub(symbols) {
  if (!okxTickerWs || okxTickerWs.readyState !== 1 || !symbols.length) return;
  try { okxTickerWs.send(JSON.stringify({ op: "subscribe", args: symbols.map((s) => ({ channel: "tickers", instId: okxInstId(s) })) })); } catch { /* noop */ }
}
function connectOkxTicker() {
  try { okxTickerWs = new WebSocket("wss://ws.okx.com:8443/ws/v5/public"); } catch { scheduleOkxTickerReconnect(); return; }
  okxTickerWs.onopen = () => {
    okxSendSub([...okxTickerSubs.keys()]);
    okxTickerPing = setInterval(() => { try { okxTickerWs.send("ping"); } catch { /* noop */ } }, 25000);
  };
  okxTickerWs.onmessage = (event) => {
    const text = typeof event.data === "string" ? event.data : "";
    if (text === "pong" || !text) return;
    let msg; try { msg = JSON.parse(text); } catch { return; }
    if (msg.event || msg.arg?.channel !== "tickers") return;
    const d = msg.data?.[0]; if (!d) return;
    lastOkxTickerAt = Date.now(); // 直连 OKX 确实在推价（含 App 端 WKWebView 能连上的情况）
    const symbol = String(msg.arg.instId).replace("-SWAP", "").replace("-", "/");
    const cbs = okxTickerSubs.get(symbol); if (!cbs) return;
    const last = Number(d.last); const open = Number(d.open24h);
    const payload = { price: last, changePct: open > 0 && Number.isFinite(last) ? Number((((last - open) / open) * 100).toFixed(3)) : null, high24h: Number(d.high24h), low24h: Number(d.low24h) };
    for (const cb of cbs) { try { cb(payload); } catch { /* noop */ } }
  };
  okxTickerWs.onclose = () => { if (okxTickerPing) clearInterval(okxTickerPing); okxTickerPing = null; scheduleOkxTickerReconnect(); };
  okxTickerWs.onerror = () => { try { okxTickerWs.close(); } catch { /* noop */ } };
}
function scheduleOkxTickerReconnect() {
  if (okxTickerReconnect) return;
  okxTickerReconnect = setTimeout(() => { okxTickerReconnect = null; if (okxTickerSubs.size) connectOkxTicker(); }, 3000);
}
function subscribeOkxTicker(symbol, cb) {
  if (!symbol || typeof WebSocket === "undefined") return () => {};
  let set = okxTickerSubs.get(symbol);
  if (!set) { set = new Set(); okxTickerSubs.set(symbol, set); }
  set.add(cb);
  if (!okxTickerWs || okxTickerWs.readyState > 1) connectOkxTicker();
  else if (okxTickerWs.readyState === 1) okxSendSub([symbol]);
  return () => {
    const s = okxTickerSubs.get(symbol);
    if (s) { s.delete(cb); if (!s.size) okxTickerSubs.delete(symbol); }
  };
}

// 实时价渲染（render-prop）：订阅 OKX tickers，只重渲染自己这一小块，不拖累整页。
export function LivePrice({ symbol, fallbackPrice = null, fallbackChange = null, children }) {
  const [v, setV] = useState({ price: null, change: null });
  useEffect(() => {
    setV({ price: null, change: null });
    let latest = { price: null, change: null }; let raf = null;
    const flush = () => { raf = null; setV({ ...latest }); };
    const schedule = () => { if (raf) return; if (typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(flush); else flush(); };
    // 直连 OKX tickers（最快、含涨跌幅）。App 端也尝试直连——WKWebView 能连上就和 Web 一样逐 tick；
    // 连不上时下面的 onLivePrice（后端 SSE / REST 轮询兜底）仍会驱动价格。
    const offOkx = subscribeOkxTicker(symbol, (t) => { latest = { price: t.price, change: t.changePct }; schedule(); });
    // App 端 WKWebView 常拦截直连 OKX，这里再订阅后端 SSE 转发的逐 tick 价，保证移动端也实时。
    const offSse = onLivePrice((s, price) => {
      if (s !== symbol) return;
      const p = Number(price);
      if (!Number.isFinite(p)) return;
      latest = { price: p, change: latest.change };
      schedule();
    });
    return () => { if (raf) cancelAnimationFrame(raf); offOkx(); offSse(); };
  }, [symbol]);
  const price = v.price ?? fallbackPrice;
  const change = v.change ?? fallbackChange;
  return children(price, change);
}

export function useApi() {
  const [token, setToken] = useState(() => localStorage.getItem("agent_token") || "");
  const [apiBase, setApiBaseState] = useState(defaultApiBase);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [busyCount, setBusyCount] = useState(0);
  const [publicInfo, setPublicInfo] = useState({ registrationEnabled: false, trc20Configured: false, subscriptionPlans: [] });
  // 轮询闭包里读不到最新 data,用 ref 记录"是否已有数据"来区分首连失败与掉线重连。
  const hasDataRef = useRef(false);

  function setApiBase(value) {
    const normalized = normalizeApiBase(value);
    if (normalized) localStorage.setItem("agent_api_base", normalized);
    else localStorage.removeItem("agent_api_base");
    setApiBaseState(normalized);
    setConnectionError("");
    return normalized;
  }

  function headers(extra = {}) {
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  function notify(message, timeout = 2400) {
    setToast(message);
    window.setTimeout(() => setToast(""), timeout);
  }

  function expireSession(message = t("登录已过期，请重新登录", "Session expired — please sign in again")) {
    localStorage.removeItem("agent_token");
    setToken("");
    setData(null);
    hasDataRef.current = false;
    setAuthRequired(true);
    setConnectionError("");
    notify(message, 4200);
  }

  // 已有数据时轮询失败只静默标记(顶部显示"重连中"),避免 App 弱网下每 15 秒弹一次"连接后端失败"。
  function reportConnectionFailure(message) {
    setConnectionError(message);
    if (hasDataRef.current) return;
    setToast(`${t("连接后端失败", "Backend connection failed")}：${message}`);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function readOverview(base) {
    const response = await fetchWithTimeout(apiUrl("/api/overview", base), { headers: headers() }, 12000);
    if (response.status === 401) {
      expireSession();
      return null;
    }
    if (!response.ok) throw new Error(`API ${response.status}`);
    return response.json();
  }

  async function refresh(showLoading = true, baseOverride) {
    const activeBase = normalizeApiBase(baseOverride || apiBase);
    try {
      if (isNativeApp() && !activeBase) {
        setConnectionError(t("请先填写 Trading Agent 后端地址。", "Please enter the Trading Agent backend URL first."));
        setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
      let json = await readOverview(activeBase);
      if (!json) return;
      setData(json);
      hasDataRef.current = true;
      setAuthRequired(false);
      setConnectionError("");
    } catch (error) {
      const fallback = nativeApiFallback();
      if (isNativeApp() && activeBase !== fallback) {
        try {
          localStorage.setItem("agent_api_base", fallback);
          setApiBaseState(fallback);
          const json = await readOverview(fallback);
          if (!json) return;
          setData(json);
          hasDataRef.current = true;
          setAuthRequired(false);
          setConnectionError("");
          setToast(t("已自动切换到默认后端", "Switched to the default backend automatically"));
          window.setTimeout(() => setToast(""), 2200);
          return;
        } catch (fallbackError) {
          reportConnectionFailure(connectionErrorMessage(fallbackError));
          return;
        }
      }
      reportConnectionFailure(connectionErrorMessage(error));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function action(url, body = {}, method = "POST") {
    setBusyCount((count) => count + 1);
    try {
      setToast(method.toUpperCase() === "GET" ? t("正在同步数据...", "Syncing data…") : t("操作处理中...", "Processing…"));
      const request = {
        method,
        headers: headers({ "Content-Type": "application/json" })
      };
      if (method.toUpperCase() !== "GET") request.body = JSON.stringify(body);
      const response = await fetchWithTimeout(apiUrl(url, apiBase), request, isNativeApp() ? 8000 : 12000);
      if (response.status === 401) {
        // 业务型 401(如原密码不正确)不是会话过期,不得把用户整体登出(审计 H5)。
        if (url.includes("/api/auth/change-password")) {
          const j = await response.json().catch(() => ({}));
          setToast(j.error || t("校验失败", "Verification failed"));
          window.setTimeout(() => setToast(""), 4200);
          return { ok: false, error: j.error || "unauthorized" };
        }
        expireSession();
        return {};
      }
      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(json.error || `${t("请求失败", "Request failed")} ${response.status}`);
      if (json.logoutRequired) {
        expireSession(json.message || t("请重新登录", "Please sign in again"));
        return json;
      }
      setToast(json.message || json.summary || json.output || json.error || t("操作已完成", "Done"));
      await refresh(false);
      window.setTimeout(() => setToast(""), 4200);
      return json;
    } catch (error) {
      setToast(error.message || t("操作失败", "Action failed"));
      window.setTimeout(() => setToast(""), 4200);
      return {};
    } finally {
      setBusyCount((count) => count - 1);
    }
  }

  async function download(url, filename) {
    try {
      const response = await fetchWithTimeout(apiUrl(url, apiBase), { headers: headers() }, isNativeApp() ? 8000 : 12000);
      if (response.status === 401) {
        expireSession();
        return;
      }
      if (!response.ok) throw new Error(`${t("导出失败", "Export failed")} ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      notify(`${t("已导出", "Exported")} ${filename}`);
    } catch (error) {
      notify(error.message || t("导出失败", "Export failed"), 3200);
    }
  }

  async function login(password) {
    const response = await fetchWithTimeout(apiUrl("/api/auth/login", apiBase), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(typeof password === "object" ? password : { password })
    }, isNativeApp() ? 8000 : 12000);
    const json = await response.json();
    if (!response.ok) {
      setToast(json.error || t("登录失败", "Sign-in failed"));
      return false;
    }
    localStorage.setItem("agent_token", json.token);
    setToken(json.token);
    setAuthRequired(false);
    setToast(t("登录成功", "Signed in"));
    window.setTimeout(() => setToast(""), 1800);
    return true;
  }

  async function registerAccount(payload) {
    try {
      setToast(t("正在开通账号...", "Creating your account…"));
      const response = await fetchWithTimeout(apiUrl("/api/auth/register", apiBase), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      }, isNativeApp() ? 8000 : 12000);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || t("注册失败", "Registration failed"));
      localStorage.setItem("agent_token", json.token);
      setToken(json.token);
      setAuthRequired(false);
      setToast(json.payment ? t("账号已创建，请按支付信息完成订阅", "Account created — complete the payment to activate") : t("账号已创建", "Account created"));
      window.setTimeout(() => setToast(""), 3200);
      return json;
    } catch (error) {
      setToast(error.message || t("注册失败", "Registration failed"));
      window.setTimeout(() => setToast(""), 4200);
      return {};
    }
  }

  async function refreshPublicInfo(baseOverride) {
    try {
      const response = await fetchWithTimeout(apiUrl("/api/public/bootstrap", normalizeApiBase(baseOverride || apiBase)), {}, isNativeApp() ? 5000 : 8000);
      if (!response.ok) return;
      setPublicInfo(await response.json());
    } catch (_error) {
      setPublicInfo((current) => current);
    }
  }

  useEffect(() => {
    refreshPublicInfo();
    refresh();
    // 定时静默轮询，让资产/持仓/风控近实时更新。
    // 后台时浏览器/WKWebView 会自动降频或暂停 setInterval，无需手动判可见性。
    const interval = setInterval(() => refresh(false), 15000);
    return () => clearInterval(interval);
  }, [token, apiBase]);

  // 真·实时行情：SSE 逐笔推送，合并进 data.markets/activeMarket（节流 1s，避免过度重渲染）。
  // 已登录时先领 stream ticket（EventSource 带不了 Authorization 头），鉴权连接才会收到
  // portfolio 实时浮盈亏推送；领票失败退回匿名流（只有公开行情）。
  useEffect(() => {
    let source;
    let pending = {};
    let timer = null;
    let disposed = false;
    const openStream = (url) => {
      if (disposed) return;
      try { source = new EventSource(url); } catch { source = null; return; }
      wireStream();
    };
    (async () => {
      let url = apiUrl("/api/stream", apiBase);
      if (token) {
        try {
          const res = await fetch(apiUrl("/api/stream/ticket", apiBase), { method: "POST", headers: headers({ "Content-Type": "application/json" }) });
          if (res.ok) {
            const json = await res.json();
            if (json.ticket) url = `${url}?ticket=${encodeURIComponent(json.ticket)}`;
          }
        } catch { /* 领票失败退回匿名流 */ }
      }
      openStream(url);
    })();
    const patch = (market, ups) => {
      const u = ups[market.symbol];
      if (!u) return market;
      const next = { ...market };
      if (u.price !== undefined) next.price = u.price;
      if (u.changePct !== undefined) next.changePct = u.changePct;
      if (u.fundingRate !== undefined) next.fundingRate = u.fundingRate;
      if (u.openInterest !== undefined) next.openInterest = u.openInterest;
      if (u.high24h !== undefined) next.high24h = u.high24h;
      if (u.low24h !== undefined) next.low24h = u.low24h;
      if (u.volume24h !== undefined) next.volume24h = u.volume24h;
      next.lastRealtimeAt = new Date().toISOString();
      return next;
    };
    let pendingPortfolio = null;
    const flush = () => {
      timer = null;
      const ups = pending;
      pending = {};
      const pf = pendingPortfolio;
      pendingPortfolio = null;
      setData((prev) => {
        if (!prev) return prev;
        const markets = (prev.markets || []).map((m) => patch(m, ups));
        const activeMarket = prev.activeMarket && ups[prev.activeMarket.symbol] ? patch(prev.activeMarket, ups) : prev.activeMarket;
        const next = { ...prev, markets, activeMarket };
        if (pf) {
          // 实时组合浮盈亏 + 逐仓 PnL 合并（不等 15s 轮询）。
          next.portfolio = { ...prev.portfolio, ...pf.portfolio };
          if (pf.positions?.length && prev.positions?.length) {
            const byId = Object.fromEntries(pf.positions.map((p) => [p.id, p]));
            next.positions = prev.positions.map((p) => (byId[p.id] ? { ...p, ...byId[p.id] } : p));
          }
        }
        return next;
      });
    };
    function wireStream() {
      if (!source) return;
      source.onmessage = (event) => {
        try {
          const u = JSON.parse(event.data);
          if (u && u.type === "portfolio") { pendingPortfolio = u; if (!timer) timer = setTimeout(flush, 300); return; }
          if (!u || !u.symbol) return;
          // 逐 tick 直推图表（不节流），让 K 线跟上 OKX 每秒多次的变化。
          if (u.price !== undefined) emitLivePrice(u.symbol, u.price);
          pending[u.symbol] = { ...pending[u.symbol], ...u };
          // React 状态（标题/快照）轻度节流到 250ms（约 4 次/秒），避免整页高频重渲染。
          if (!timer) timer = setTimeout(flush, 250);
        } catch { /* 忽略解析失败 */ }
      };
    }
    return () => { disposed = true; if (source) source.close(); if (timer) clearTimeout(timer); };
  }, [token, apiBase]);

  // App 端兜底：Capacitor WKWebView 对 SSE(EventSource) 支持不稳定（常缓冲、onmessage 不实时），
  // 直连 OKX WS 也被拦截，价格会“完全不动”。这里用 REST 轮询后端 db.markets（后端已逐 OKX tick 更新），
  // 逐次 emitLivePrice 直推标题/K线，并合并进 markets 刷新快照字段。仅原生 App 生效，网页端不受影响。
  useEffect(() => {
    if (!isNativeApp() || !token) return undefined;
    let stop = false;
    let t = null;
    const poll = async () => {
      if (stop) return;
      // 直连 OKX 正常推价时（含 App 端 WKWebView 能连上的情况）退避到 4s，仅刷新资金费/OI 等慢字段；
      // 直连静默时才 ~0.5s 快轮询兜底价格，尽量贴近 Web 的实时。
      const okxLive = okxTickerFresh(2500);
      if (!okxLive) {
        try {
          const res = await fetch(apiUrl("/api/markets", apiBase), { headers: headers() });
          if (res.ok) {
            const markets = await res.json();
            if (Array.isArray(markets)) {
              for (const m of markets) if (m && m.symbol && m.price != null) emitLivePrice(m.symbol, m.price);
              const byId = Object.fromEntries(markets.map((m) => [m.symbol, m]));
              const merge = (mk) => {
                const u = byId[mk.symbol];
                if (!u) return mk;
                return { ...mk, price: u.price, changePct: u.changePct, high24h: u.high24h, low24h: u.low24h, fundingRate: u.fundingRate ?? mk.fundingRate, openInterest: u.openInterest ?? mk.openInterest, volume24h: u.volume24h ?? mk.volume24h, lastRealtimeAt: new Date().toISOString() };
              };
              setData((prev) => prev ? { ...prev, markets: (prev.markets || []).map(merge), activeMarket: prev.activeMarket ? merge(prev.activeMarket) : prev.activeMarket } : prev);
            }
          }
        } catch { /* 网络抖动，下次再拉 */ }
      }
      if (!stop) t = setTimeout(poll, okxLive ? 4000 : 500);
    };
    t = setTimeout(poll, 800);
    return () => { stop = true; if (t) clearTimeout(t); };
  }, [token, apiBase]);

  return { data, loading, action, toast, authRequired, login, registerAccount, notify, download, refresh, apiBase, setApiBase, connectionError, busy: busyCount > 0, isNativeApp: isNativeApp(), publicInfo };
}

export function Card({ className = "", children, ...props }) {
  return <section className={`dashCard ${className}`} {...props}>{children}</section>;
}

export function SectionTitle({ icon: Icon, title, action }) {
  return (
    <div className="sectionTitle">
      <div>{Icon && <span className="sectionIcon"><Icon size={18} /></span>}<h2>{title}</h2></div>
      {action}
    </div>
  );
}

// 提示解读卡已按需求全站移除；保留空组件以兼容现有调用点。
export function InsightNote() {
  return null;
}

export function MetricCard({ icon: Icon, label, value, sub, tone = "", candles }) {
  return (
    <Card className={`metricCard ${Icon ? "" : "noIcon"}`}>
      {Icon && <div className={`metricIcon ${tone}`}><Icon size={22} /></div>}
      <div>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
      {candles && candles.length > 1 && <div className={`metricSpark ${tone}`}><MiniSparkline candles={candles} /></div>}
    </Card>
  );
}

export function MiniSparkline({ candles = [] }) {
  if (!candles.length) return null;
  const points = candles.slice(-24);
  const min = Math.min(...points.map((item) => Number(item.close || 0)));
  const max = Math.max(...points.map((item) => Number(item.close || 0)));
  const path = points.map((item, index) => {
    const x = (index / Math.max(1, points.length - 1)) * 100;
    const y = 36 - ((Number(item.close || 0) - min) / Math.max(1, max - min)) * 28;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none"><path d={path} /></svg>;
}

const KLINE_TF = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d", "1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", D: "1d" };
const KLINE_SECONDS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const OKX_BAR = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };
// K 线图：lightweight-charts + 【直连 OKX 公有 WebSocket 的 candle 频道】。
// 图表价格不再经我们后端中转（少一跳、少延迟），而是客户端直接订阅 OKX candle{bar}，
// 拿到的就是 OKX 正在形成的这根蜡烛的实时 OHLC——与 OKX 自家图表同源同速。
// 若客户端直连 OKX 被网络限制，退回后端 SSE 实时价（onLivePrice）驱动。导出名保持 TradingViewChart。
export function TradingViewChart({ symbol = "BTC/USDT", interval = "60", livePrice = null }) {
  const holder = useRef(null);
  const seriesRef = useRef(null);
  const lastBarRef = useRef(null);
  const lastOkxRef = useRef(0);
  const [status, setStatus] = useState("loading");
  const tf = KLINE_TF[interval] || "1h";
  const barSeconds = KLINE_SECONDS[tf] || 3600;

  useEffect(() => {
    let disposed = false;
    let chart = null;
    let ws = null;
    let pingTimer = null;
    let reconnectTimer = null;
    let refetchTimer = null;
    setStatus("loading");
    seriesRef.current = null;
    lastBarRef.current = null;
    const okxBar = OKX_BAR[tf] || "1H";
    const instId = `${String(symbol).replace("/", "-").toUpperCase()}-SWAP`;

    const fetchRows = async () => {
      try {
        const res = await fetch(apiUrl(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=200`));
        const json = await res.json();
        const candles = Array.isArray(json.candles) ? json.candles : [];
        return candles
          .map((c) => ({ time: Math.floor(Number(c.time) / 1000), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }))
          .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
          .sort((a, b) => a.time - b.time);
      } catch { return []; }
    };
    const applyOkxCandle = (arr) => {
      const series = seriesRef.current;
      if (!series || !arr) return;
      const time = Math.floor(Number(arr[0]) / 1000);
      const bar = { time, open: Number(arr[1]), high: Number(arr[2]), low: Number(arr[3]), close: Number(arr[4]) };
      if (!Number.isFinite(time) || !Number.isFinite(bar.close)) return;
      const last = lastBarRef.current;
      if (last && time < last.time) return; // 防回退
      lastOkxRef.current = Date.now();
      try { series.update(bar); lastBarRef.current = bar; } catch { /* noop */ }
    };
    // tickers 频道 ~100ms 推一次最新价（OKX 自家价格显示同源），驱动当前蜡烛收/高/低逐 tick 动。
    const applyTickerPrice = (lastPx) => {
      const series = seriesRef.current;
      const bar = lastBarRef.current;
      const p = Number(lastPx);
      if (!series || !bar || !Number.isFinite(p) || p <= 0) return;
      lastOkxRef.current = Date.now();
      const next = { time: bar.time, open: bar.open, high: Math.max(bar.high, p), low: Math.min(bar.low, p), close: p };
      try { series.update(next); lastBarRef.current = next; } catch { /* noop */ }
    };
    const scheduleReconnect = () => {
      if (reconnectTimer || disposed) return;
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connectOkx(); }, 3000);
    };
    function connectOkx() {
      if (disposed) return;
      try { ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public"); } catch { scheduleReconnect(); return; }
      ws.onopen = () => {
        try { ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: `candle${okxBar}`, instId }, { channel: "tickers", instId }] })); } catch { /* noop */ }
        pingTimer = setInterval(() => { try { ws.send("ping"); } catch { /* noop */ } }, 25000);
      };
      ws.onmessage = (event) => {
        const text = typeof event.data === "string" ? event.data : "";
        if (text === "pong" || !text) return;
        let msg; try { msg = JSON.parse(text); } catch { return; }
        if (msg.event) return; // 订阅确认/错误回执
        const ch = msg.arg && msg.arg.channel;
        const d = msg.data && msg.data[0];
        if (!d) return;
        if (ch === "tickers") applyTickerPrice(d.last);           // ~100ms 高频，逐 tick 动
        else if (ch && ch.startsWith("candle")) applyOkxCandle(d); // 权威 OHLC + 周期滚动
      };
      ws.onclose = () => { if (pingTimer) clearInterval(pingTimer); pingTimer = null; if (!disposed) scheduleReconnect(); };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    }

    (async () => {
      const rows = await fetchRows();
      if (disposed || !holder.current) return;
      if (!rows.length) { setStatus("empty"); return; }
      const lc = await import("lightweight-charts");
      if (disposed || !holder.current) return;
      setStatus("ok");
      holder.current.innerHTML = "";
      chart = lc.createChart(holder.current, {
        autoSize: true,
        layout: { background: { color: "#FBF9F5" }, textColor: "#8a8172", fontFamily: "IBM Plex Mono, monospace" },
        grid: { vertLines: { color: "#EDE7DB" }, horzLines: { color: "#EDE7DB" } },
        rightPriceScale: { borderColor: "#E3DCCE" },
        timeScale: { borderColor: "#E3DCCE", timeVisible: true },
        crosshair: { mode: 0 }
      });
      const series = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#1F7A50", downColor: "#C43F28", borderUpColor: "#1F7A50", borderDownColor: "#C43F28", wickUpColor: "#1F7A50", wickDownColor: "#C43F28"
      });
      series.setData(rows);
      chart.timeScale().fitContent();
      seriesRef.current = series;
      lastBarRef.current = rows[rows.length - 1];
      connectOkx(); // 直连 OKX 实时 candle（App 端也试；连不上时由 onLivePrice 兜底驱动）
      // 兜底：每 30s 拉一次真实 K 线纠正历史（直连挂了也不至于冻结）。
      refetchTimer = setInterval(async () => {
        const fresh = await fetchRows();
        if (disposed || !seriesRef.current || !fresh.length) return;
        const live = lastBarRef.current;
        if (live && fresh[fresh.length - 1].time <= live.time) {
          seriesRef.current.setData(fresh.filter((b) => b.time < live.time).concat([live]));
        } else {
          seriesRef.current.setData(fresh);
          lastBarRef.current = fresh[fresh.length - 1];
        }
      }, 30000);
    })();
    return () => {
      disposed = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refetchTimer) clearInterval(refetchTimer);
      if (ws) { try { ws.close(); } catch { /* noop */ } }
      if (chart) { try { chart.remove(); } catch { /* noop */ } }
      seriesRef.current = null;
    };
  }, [symbol, interval]);

  // 兜底：直连 OKX 静默(>3s)时，用后端 SSE 实时价驱动当前蜡烛（网络限制客户端直连 OKX 的情况）。
  useEffect(() => {
    const applyPrice = (sym, price) => {
      // 直连 OKX 正常推价时以它为主；静默 >3s（含 App 端连不上 OKX）才用后端 SSE / REST 轮询兜底驱动。
      if (sym !== symbol || Date.now() - lastOkxRef.current < 3000) return;
      const series = seriesRef.current;
      const last = lastBarRef.current;
      const p = Number(price);
      if (!series || !last || !Number.isFinite(p) || p <= 0) return;
      const bucket = Math.floor(Math.floor(Date.now() / 1000) / barSeconds) * barSeconds;
      const bar = bucket > last.time
        ? { time: bucket, open: p, high: p, low: p, close: p }
        : { time: last.time, open: last.open, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p };
      try { series.update(bar); lastBarRef.current = bar; } catch { /* noop */ }
    };
    if (livePrice != null) applyPrice(symbol, livePrice);
    return onLivePrice(applyPrice);
  }, [symbol, barSeconds]);

  return (
    <div className="tvChart" style={{ position: "relative" }}>
      <div ref={holder} style={{ width: "100%", height: "100%" }} />
      {status !== "ok" && <div className="chartEmpty tvOverlay">{status === "empty" ? "同步交易所后显示真实 K 线" : "加载 K 线…"}</div>}
    </div>
  );
}

// 轻量自绘 K 线（纯 SVG，不加载 lightweight-charts）：给 App 端用——拉真实 OKX 历史 K 线，
// 最后一根蜡烛吃直连 OKX / SSE / 轮询的实时价逐 tick 动。比嵌 lightweight-charts 轻、启动快。
export function StatusBadge({ children, tone = "ok" }) {
  return <span className={`statusBadge ${tone}`}>{children}</span>;
}

export function ProgressBar({ value = 50, tone = "green" }) {
  return <div className={`progressBar ${tone}`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function DataTable({ columns, rows }) {
  const gridTemplateColumns = columns.map((col) => col.width || "1fr").join(" ");
  return (
    <div className="dataTable">
      <div className="dataHead" style={{ gridTemplateColumns }}>
        {columns.map((col) => <span key={col.key}>{col.label}</span>)}
      </div>
      {!rows.length && <div className="emptyTable">暂无真实记录</div>}
      {rows.map((row, index) => (
        <div className="dataRow" key={row.id || index} style={{ gridTemplateColumns }}>
          {columns.map((col) => <span key={col.key} data-label={col.label}>{row[col.key] ?? "-"}</span>)}
        </div>
      ))}
    </div>
  );
}

// 异常/高风险标记：给标题加虚线下划标记（不直接把原因铺成文案），鼠标悬停/聚焦显示具体问题。
export function FlagTip({ reason, tone = "warn", children }) {
  if (!reason) return <>{children}</>;
  return <span className={`flagTip ${tone}`} data-tip={String(reason)} tabIndex={0} role="note" aria-label={String(reason)}>{children}</span>;
}

// 交易对/币种白名单：渲染成可换行、可滚动的胶囊标签，币多也不难看。
export function SymbolChips({ symbols, empty = "未授权" }) {
  const list = (Array.isArray(symbols) ? symbols : []).filter(Boolean);
  if (!list.length) return <span className="symChipsEmpty">{empty}</span>;
  return <span className="symChips">{list.map((s) => <span className="symChip" key={s}>{s}</span>)}</span>;
}

export function RiskLine({ label, value, progress }) {
  return (
    <div className="riskLine">
      <span>{label}</span>
      <b>{value}</b>
      {progress !== undefined && <ProgressBar value={progress} />}
    </div>
  );
}

export function MiniChart({ title, value, sub }) {
  // 只展示真实指标（标题/值/说明），不画任何装饰性/占位图形，避免出现与数据无关的假图。
  return (
    <div className="miniChart">
      <h3>{title}</h3>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
