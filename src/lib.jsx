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
      next.lastRealtimeAt = new Date().toISOString();
      return next;
    };
    const flush = () => {
      timer = null;
      const ups = pending;
      pending = {};
      setData((prev) => {
        if (!prev) return prev;
        const markets = (prev.markets || []).map((m) => patch(m, ups));
        const activeMarket = prev.activeMarket && ups[prev.activeMarket.symbol] ? patch(prev.activeMarket, ups) : prev.activeMarket;
        return { ...prev, markets, activeMarket };
      });
    };
    source.onmessage = (event) => {
      try {
        const u = JSON.parse(event.data);
        if (!u || !u.symbol) return;
        pending[u.symbol] = { ...pending[u.symbol], ...u };
        if (!timer) timer = setTimeout(flush, 1000);
      } catch { /* 忽略解析失败 */ }
    };
    return () => { if (source) source.close(); if (timer) clearTimeout(timer); };
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

// TradingView 嵌入式图表（官方 widget，走 TradingView 自己的行情）。
let tvScriptPromise = null;
function loadTradingView() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.TradingView && window.TradingView.widget) return Promise.resolve();
  if (tvScriptPromise) return tvScriptPromise;
  tvScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { tvScriptPromise = null; reject(new Error("tv.js load failed")); };
    document.head.appendChild(script);
  });
  return tvScriptPromise;
}

export function TradingViewChart({ symbol = "BTC/USDT", interval = "60", theme = "light" }) {
  const holder = useRef(null);
  const containerId = useRef(`tv_${Math.random().toString(36).slice(2, 9)}`);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    loadTradingView()
      .then(() => {
        if (cancelled || !holder.current || !window.TradingView) return;
        holder.current.innerHTML = "";
        const inner = document.createElement("div");
        inner.id = containerId.current;
        inner.style.height = "100%";
        inner.style.width = "100%";
        holder.current.appendChild(inner);
        const base = String(symbol || "BTC/USDT").replace("/", "").toUpperCase();
        // eslint-disable-next-line no-new
        new window.TradingView.widget({
          autosize: true,
          symbol: `OKX:${base}.P`,
          interval,
          timezone: "Asia/Shanghai",
          theme,
          style: "1",
          locale: "zh_CN",
          hide_side_toolbar: true,
          allow_symbol_change: false,
          save_image: false,
          container_id: containerId.current
        });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [symbol, interval, theme]);
  if (failed) return <div className="chartEmpty">TradingView 图表加载失败，请检查网络后重试</div>;
  return <div className="tvChart" ref={holder} />;
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

export function MiniChart({ title, value, sub, bars = false }) {
  return (
    <div className="miniChart">
      <h3>{title}</h3>
      <strong>{value}</strong>
      <small>{sub}</small>
      {bars ? <div className="barChart">{[18, 25, 16, 21, 13, 8].map((h, index) => <span style={{ height: `${h * 2}px` }} key={index} />)}</div> : <MiniSparkline />}
    </div>
  );
}
