import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  Eye,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  Hourglass,
  Info,
  KeyRound,
  Layers,
  LineChart,
  ListChecks,
  Lock,
  PlugZap,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Shield,
  Sparkles,
  SquareActivity,
  Target,
  Timer,
  TrendingUp,
  WalletCards,
  Zap
} from "lucide-react";

export const pageCopy = {
  agent: { title: "AI 交易员驾驶舱", sub: "配置真实数据源、授权与风控边界后，Agent 才会生成可执行计划", search: "搜索市场、交易对、知识或功能" },
  cockpit: { title: "驾驶舱", sub: "账户绩效、风险承压与复盘拆解合并一屏，直观掌握全局", search: "搜索绩效、账户、对账、复盘或风险" },
  marketAccount: { title: "仪表盘", sub: "聚合账户绩效、对账健康、收益质量与风险承压，不展示交易图表噪音", search: "搜索绩效、账户、对账或风险" },
  eventsTasks: { title: "事件与任务", sub: "接入真实事件源与任务规则后，追踪风险窗口和自动化运行记录", search: "搜索市场、交易对、知识或功能" },
  knowledgeSkills: { title: "知识与技能", sub: "沉淀专家知识，构建规则与技能，让 Agent 更懂市场、更会交易。", search: "搜索知识、规则、技能或文档" },
  review: { title: "复盘", sub: "复盘交易、Agent 行为、Skill 运行和可优化线索，形成下一轮改进闭环", search: "搜索交易、复盘、Skill 或优化项" },
  riskAuth: { title: "风控与授权", sub: "集中管理授权委托、风险规则与安全策略，确保交易策略在可控范围内执行。", search: "搜索市场、交易对、知识或功能" },
  auditSystem: { title: "审计与通知", sub: "审计 Agent 行为，监控系统健康，集中查看站内通知与告警", search: "搜索市场、交易对、知识或功能" },
  systemSettings: { title: "系统设置", sub: "集中维护模型、交易所、告警、运行参数与实盘灰度配置", search: "搜索配置、密钥、模型或交易所" },
  admin: { title: "Admin", sub: "管理用户、密码、订阅套餐、TRC20 支付和数据重置。", search: "搜索用户、套餐、支付或系统设置" }
};

export function formatMoney(value, digits = 2) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// 价格按量级自适应精度：BTC 用 2 位、SUI(0.7x) 用 4 位、meme 币(0.00001x) 用更多位。
export function priceDigits(value) {
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

export function pct(value) {
  const number = Number(value || 0);
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
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDuration(value, fallback = "未记录") {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number < 1000) return `${Math.round(number)}ms`;
  return `${(number / 1000).toFixed(1)}s`;
}

export function orderStatus(status) {
  return {
    open: "挂单中",
    new: "新订单",
    submitted: "已提交",
    cancel_requested: "撤单中",
    filled: "已成交",
    rejected: "已拒绝"
  }[String(status || "").toLowerCase()] || status || "-";
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
    awaiting_approval: "等待确认",
    approved: "已批准",
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
    executing: "执行交易",
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
    manual_review: "人工复核",
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
  const dangerStates = ["blocked", "error", "failed", "rejected", "risk_rejected", "已阻断", "异常", "失败", "已拒绝", "风控拒绝"];
  const warningStates = ["warning", "degraded", "skipped_locked", "allowed_with_warnings", "paused", "降级运行", "并发锁跳过", "允许但有警告", "已暂停", "告警", "人工暂停", "风控暂停"];
  const neutralStates = ["setup_required", "missing_credentials", "not_synced", "data_unavailable", "unconfigured", "待配置", "未配置", "未同步", "缺少数据", "只读观察", "未启用", "未连接"];
  const infoStates = ["pending", "in_progress", "submitted", "queued", "awaiting_approval", "validating", "验证中", "进行中", "待审批", "审批中", "同步中"];
  if (dangerStates.includes(value) || dangerStates.includes(raw)) return "danger";
  if (warningStates.includes(value) || warningStates.includes(raw)) return "warning";
  if (neutralStates.includes(value) || neutralStates.includes(raw)) return "neutral";
  if (infoStates.includes(value) || infoStates.includes(raw)) return "info";
  return "ok";
}

export function compactAction(text) {
  const value = String(text || "");
  if (!value) return "继续观察";
  if (value.includes("CPI") || value.includes("FOMC") || value.includes("事件")) return "跟踪事件";
  if (value.includes("资金费率")) return "刷新风险信号";
  if (value.includes("重新生成")) return "重建计划";
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

export function systemStatus(data) {
  if (data?.system?.killSwitch) return { label: "熔断中", tone: "danger" };
  if ((data?.exchangeAccounts || []).length && (data?.exchangeAccounts || []).every((account) => !account.readEnabled)) return { label: "待配置", tone: "warning" };
  if (!data?.system?.autonomyEnabled) return { label: "人工暂停", tone: "warning" };
  if (data?.agentStatus?.state === "risk_paused") return { label: "风控暂停", tone: "warning" };
  return { label: data?.system?.riskStatus || "正常", tone: "ok" };
}

export function exchangeState(account = {}) {
  if (account.readEnabled && account.tradeEnabled) return { label: "交易可用", tone: "on" };
  if (account.readEnabled) return { label: "只读", tone: "warn" };
  return { label: "未配置", tone: "off" };
}

export function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

export function defaultApiBase() {
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

export function nativeApiFallback() {
  return normalizeApiBase(import.meta.env.VITE_API_BASE_URL || "https://yegidawir.xyz");
}

export function normalizeApiBase(value = "") {
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
export function onLivePrice(fn) { livePriceListeners.add(fn); return () => livePriceListeners.delete(fn); }
function emitLivePrice(symbol, price) { for (const fn of livePriceListeners) { try { fn(symbol, price); } catch { /* noop */ } } }

// 共享 OKX tickers 直连管理：一条 WS 按 symbol 多路复用，标题/快照直接吃 OKX ~100ms 最新价，
// 和 K 线同源同速（不再经我们后端中转）。多个订阅者共用同一条连接。
const okxTickerSubs = new Map(); // symbol -> Set(cb)
let okxTickerWs = null;
let okxTickerPing = null;
let okxTickerReconnect = null;
let lastOkxTickerAt = 0; // 最近一次直连 OKX 收到 tick 的时间；用于判断是否还需 REST 轮询兜底
export function okxTickerFresh(withinMs = 2500) { return Date.now() - lastOkxTickerAt < withinMs; }
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
export function subscribeOkxTicker(symbol, cb) {
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

  function expireSession(message = "登录已过期，请重新登录") {
    localStorage.removeItem("agent_token");
    setToken("");
    setData(null);
    setAuthRequired(true);
    setConnectionError("");
    notify(message, 4200);
  }

  async function readOverview(base) {
    const response = await fetchWithTimeout(apiUrl("/api/overview", base), { headers: headers() }, isNativeApp() ? 5000 : 8000);
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
        setConnectionError("请先填写 Trading Agent 后端地址。");
        setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
      let json = await readOverview(activeBase);
      if (!json) return;
      setData(json);
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
          setAuthRequired(false);
          setConnectionError("");
          setToast("已自动切换到默认后端");
          window.setTimeout(() => setToast(""), 2200);
          return;
        } catch (fallbackError) {
          const message = connectionErrorMessage(fallbackError);
          setConnectionError(message);
          setToast(`连接后端失败：${message}`);
          window.setTimeout(() => setToast(""), 3200);
          return;
        }
      }
      const message = connectionErrorMessage(error);
      setConnectionError(message);
      setToast(`连接后端失败：${message}`);
      window.setTimeout(() => setToast(""), 3200);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function action(url, body = {}, method = "POST") {
    setBusyCount((count) => count + 1);
    try {
      setToast(method.toUpperCase() === "GET" ? "正在同步数据..." : "操作处理中...");
      const request = {
        method,
        headers: headers({ "Content-Type": "application/json" })
      };
      if (method.toUpperCase() !== "GET") request.body = JSON.stringify(body);
      const response = await fetchWithTimeout(apiUrl(url, apiBase), request, isNativeApp() ? 8000 : 12000);
      if (response.status === 401) {
        expireSession();
        return {};
      }
      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(json.error || `请求失败 ${response.status}`);
      if (json.logoutRequired) {
        expireSession(json.message || "请重新登录");
        return json;
      }
      setToast(json.message || json.summary || json.output || json.error || "操作已完成");
      await refresh(false);
      window.setTimeout(() => setToast(""), 4200);
      return json;
    } catch (error) {
      setToast(error.message || "操作失败");
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
      if (!response.ok) throw new Error(`导出失败 ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      notify(`已导出 ${filename}`);
    } catch (error) {
      notify(error.message || "导出失败", 3200);
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
      setToast(json.error || "登录失败");
      return false;
    }
    localStorage.setItem("agent_token", json.token);
    setToken(json.token);
    setAuthRequired(false);
    setToast("登录成功");
    window.setTimeout(() => setToast(""), 1800);
    return true;
  }

  async function registerAccount(payload) {
    try {
      setToast("正在开通账号...");
      const response = await fetchWithTimeout(apiUrl("/api/auth/register", apiBase), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      }, isNativeApp() ? 8000 : 12000);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "注册失败");
      localStorage.setItem("agent_token", json.token);
      setToken(json.token);
      setAuthRequired(false);
      setToast(json.payment ? "账号已创建，请按支付信息完成订阅" : "账号已创建");
      window.setTimeout(() => setToast(""), 3200);
      return json;
    } catch (error) {
      setToast(error.message || "注册失败");
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
  useEffect(() => {
    let source;
    let pending = {};
    let timer = null;
    try {
      source = new EventSource(apiUrl("/api/stream", apiBase));
    } catch {
      return undefined;
    }
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
    return () => { if (source) source.close(); if (timer) clearTimeout(timer); };
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

export function PageHeader({ active }) {
  const copy = pageCopy[active] || pageCopy.agent;
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="pageHeader">
      <div className="pageHeaderTop">
        <h1>{copy.title}</h1>
        {copy.sub && (
          <button className={`pageHelp ${showHelp ? "active" : ""}`} title="页面说明" aria-label="页面说明" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>?</button>
        )}
      </div>
      {showHelp && copy.sub && <p className="pageHelpText">{copy.sub}</p>}
    </div>
  );
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

export function CandleChart({ candles = [] }) {
  const series = candles.length ? candles.slice(-72) : [];
  if (!series.length) return <div className="chartEmpty">同步公开行情后显示真实 K 线</div>;
  const min = Math.min(...series.map((item) => Number(item.low || item.close || 0)));
  const max = Math.max(...series.map((item) => Number(item.high || item.close || 0)));
  const width = 100 / Math.max(1, series.length);
  const range = Math.max(1e-9, max - min);
  const maxVolume = Math.max(1e-9, ...series.map((item) => Number(item.volume || 0)));
  return (
    <svg className="proChart" viewBox="0 0 100 54" preserveAspectRatio="none">
      {series.map((item, index) => {
        const x = index * width + width / 2;
        const yHigh = 42 - ((item.high - min) / range) * 34;
        const yLow = 42 - ((item.low - min) / range) * 34;
        const yOpen = 42 - ((item.open - min) / range) * 34;
        const yClose = 42 - ((item.close - min) / range) * 34;
        const up = item.close >= item.open;
        const volume = 53 - (Number(item.volume || 0) / maxVolume) * 8;
        return (
          <g key={`${item.time || "c"}-${index}`} className={up ? "up" : "down"}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} />
            <rect x={x - width * 0.24} y={Math.min(yOpen, yClose)} width={width * 0.48} height={Math.max(0.45, Math.abs(yClose - yOpen))} rx="0.08" />
            <rect className="volume" x={x - width * 0.25} y={volume} width={width * 0.5} height={53 - volume} />
          </g>
        );
      })}
    </svg>
  );
}

// K 线图：TradingView 官方开源库 lightweight-charts + 真实 OKX K 线数据。
// 自托管、无外部 iframe/来源校验，在浏览器与 Capacitor WKWebView 里都可靠渲染（嵌入式 widget 在原生 app 的
// capacitor:// 源下会被 TradingView 拒绝，故改用其开源库）。导出名保持 TradingViewChart，调用方不变。
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

export function LinePriceChart({ candles = [] }) {
  const series = candles.length ? candles.slice(-72) : [];
  if (!series.length) return <div className="chartEmpty">同步公开行情后显示真实价格线</div>;
  const min = Math.min(...series.map((item) => Number(item.close || 0)));
  const max = Math.max(...series.map((item) => Number(item.close || 0)));
  const path = series.map((item, index) => {
    const x = (index / Math.max(1, series.length - 1)) * 100;
    const y = 46 - ((Number(item.close || 0) - min) / Math.max(1, max - min)) * 38;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg className="proChart lineModeChart" viewBox="0 0 100 54" preserveAspectRatio="none">
      <path d={path} />
    </svg>
  );
}

export function SemiGauge({ value = 0, max = 100, unit = "", color = "#3f8f5b", size = 128 }) {
  const has = Number.isFinite(Number(value));
  const pct = Math.max(0, Math.min(1, (Number(value) || 0) / max));
  const cx = 60, cy = 60, r = 48;
  const rad = (deg) => (deg * Math.PI) / 180;
  const pt = (deg) => [(cx + r * Math.cos(rad(deg))).toFixed(2), (cy - r * Math.sin(rad(deg))).toFixed(2)];
  const [ex, ey] = pt(180 - pct * 180);
  return (
    <div className="semiGauge" style={{ width: size }}>
      <svg viewBox="0 0 120 74" preserveAspectRatio="xMidYMid meet">
        <path className="semiTrack" d={`M 12 60 A ${r} ${r} 0 0 1 108 60`} />
        {has && <path className="semiValue" style={{ stroke: color }} d={`M 12 60 A ${r} ${r} 0 0 1 ${ex} ${ey}`} />}
        <text x="60" y="52" className="semiText" style={{ fill: has ? color : "#b7ab98" }}>{has ? value : "—"}</text>
        {unit && <text x="60" y="68" className="semiUnit">{has ? unit : ""}</text>}
      </svg>
    </div>
  );
}

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
