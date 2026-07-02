import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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
import "./styles.css";

const navItems = [
  { id: "agent", label: "AI 交易员", icon: BrainCircuit },
  { id: "marketAccount", label: "市场与账户", icon: WalletCards },
  { id: "eventsTasks", label: "事件与任务", icon: CalendarClock },
  { id: "knowledgeSkills", label: "知识与技能", icon: BookOpen },
  { id: "riskAuth", label: "风控与授权", icon: Shield },
  { id: "auditSystem", label: "审计与系统", icon: Settings }
];

const pageCopy = {
  agent: { title: "AI 交易员驾驶舱", sub: "配置真实数据源、授权与风控边界后，Agent 才会生成可执行计划", search: "搜索市场、交易对、知识或功能" },
  marketAccount: { title: "市场与账户", sub: "同步公开行情、私有账户、持仓与委托，区分真实数据和待配置状态", search: "搜索市场、交易对、知识或功能" },
  eventsTasks: { title: "事件与任务", sub: "接入真实事件源与任务规则后，追踪风险窗口和自动化运行记录", search: "搜索市场、交易对、知识或功能" },
  knowledgeSkills: { title: "知识与技能", sub: "沉淀专家知识，构建规则与技能，让 Agent 更懂市场、更会交易。", search: "搜索知识、规则、技能或文档" },
  riskAuth: { title: "风控与授权", sub: "集中管理授权委托、风险规则与安全策略，确保交易策略在可控范围内执行。", search: "搜索市场、交易对、知识或功能" },
  auditSystem: { title: "审计与系统", sub: "审计 Agent 行为，监控系统健康，保障交易安全与合规", search: "搜索市场、交易对、知识或功能" }
};

function formatMoney(value, digits = 2) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function displayMoney(value, digits = 2, fallback = "未同步") {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function displayPct(value, fallback = "未同步") {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function pct(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(/[,，\n/]/).map((item) => item.trim()).filter(Boolean);
}

function safeList(value, fallback = "-") {
  const items = asArray(value);
  return items.length ? items.join("、") : fallback;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatDateTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(value, fallback = "未记录") {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number < 1000) return `${Math.round(number)}ms`;
  return `${(number / 1000).toFixed(1)}s`;
}

function orderStatus(status) {
  return {
    open: "挂单中",
    new: "新订单",
    submitted: "已提交",
    cancel_requested: "撤单中",
    filled: "已成交",
    rejected: "已拒绝"
  }[String(status || "").toLowerCase()] || status || "-";
}

function humanize(value, fallback = "-") {
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

function humanizeList(value, fallback = "-") {
  const items = asArray(value).map((item) => humanize(item));
  return items.length ? items.join("、") : fallback;
}

function humanizePhase(value, fallback = "-") {
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

function shortId(value, fallback = "未生成") {
  const text = String(value || "");
  if (!text) return fallback;
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  const dangerStates = ["blocked", "error", "failed", "rejected", "risk_rejected", "已阻断", "异常", "失败", "已拒绝", "风控拒绝"];
  const warningStates = ["warning", "degraded", "skipped_locked", "allowed_with_warnings", "paused", "setup_required", "missing_credentials", "not_synced", "data_unavailable", "降级运行", "并发锁跳过", "允许但有警告", "已暂停", "告警", "只读观察", "人工暂停", "风控暂停", "待配置", "未配置", "未同步", "缺少数据"];
  if (dangerStates.includes(value) || dangerStates.includes(String(status || ""))) return "danger";
  if (warningStates.includes(value) || warningStates.includes(String(status || ""))) return "warning";
  return "ok";
}

function compactAction(text) {
  const value = String(text || "");
  if (!value) return "继续观察";
  if (value.includes("CPI") || value.includes("FOMC") || value.includes("事件")) return "跟踪事件";
  if (value.includes("资金费率")) return "刷新风险信号";
  if (value.includes("重新生成")) return "重建计划";
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function systemStatus(data) {
  if (data?.system?.killSwitch) return { label: "熔断中", tone: "danger" };
  if ((data?.exchangeAccounts || []).length && (data?.exchangeAccounts || []).every((account) => !account.readEnabled)) return { label: "待配置", tone: "warning" };
  if (!data?.system?.autonomyEnabled) return { label: "人工暂停", tone: "warning" };
  if (data?.agentStatus?.state === "risk_paused") return { label: "风控暂停", tone: "warning" };
  return { label: data?.system?.riskStatus || "正常", tone: "ok" };
}

function exchangeState(account = {}) {
  if (account.readEnabled && account.tradeEnabled) return { label: "交易可用", tone: "on" };
  if (account.readEnabled) return { label: "只读", tone: "warn" };
  return { label: "未配置", tone: "off" };
}

function useApi() {
  const [token, setToken] = useState(() => localStorage.getItem("agent_token") || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [authRequired, setAuthRequired] = useState(false);

  function headers(extra = {}) {
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  function notify(message, timeout = 2400) {
    setToast(message);
    window.setTimeout(() => setToast(""), timeout);
  }

  async function refresh(showLoading = true) {
    try {
      if (showLoading) setLoading(true);
      const response = await fetch("/api/overview", { headers: headers() });
      if (response.status === 401) {
        setAuthRequired(true);
        return;
      }
      if (!response.ok) throw new Error(`API ${response.status}`);
      const json = await response.json();
      setData(json);
      setAuthRequired(false);
    } catch (error) {
      setToast(`连接后端失败：${error.message}`);
      window.setTimeout(() => setToast(""), 3200);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function action(url, body = {}, method = "POST") {
    try {
      setToast(method.toUpperCase() === "GET" ? "正在同步数据..." : "操作处理中...");
      const request = {
        method,
        headers: headers({ "Content-Type": "application/json" })
      };
      if (method.toUpperCase() !== "GET") request.body = JSON.stringify(body);
      const response = await fetch(url, request);
      if (response.status === 401) {
        setAuthRequired(true);
        setToast("请先登录");
        return {};
      }
      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(json.error || `请求失败 ${response.status}`);
      setToast(json.message || json.summary || json.output || json.error || "操作已完成");
      await refresh(false);
      window.setTimeout(() => setToast(""), 4200);
      return json;
    } catch (error) {
      setToast(error.message || "操作失败");
      window.setTimeout(() => setToast(""), 4200);
      return {};
    }
  }

  async function download(url, filename) {
    try {
      const response = await fetch(url, { headers: headers() });
      if (response.status === 401) {
        setAuthRequired(true);
        notify("请先登录");
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
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
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

  useEffect(() => {
    refresh();
  }, [token]);

  return { data, loading, action, toast, authRequired, login, notify, download, refresh };
}

function Sidebar({ active, setActive, data }) {
  const currentStatus = systemStatus(data);
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark"><Layers size={24} /></div>
        <strong>AI 数字货币交易 Agent</strong>
      </div>
      <nav className="nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button className={`navItem ${active === item.id ? "active" : ""}`} key={item.id} title={item.label} aria-label={item.label} onClick={() => setActive(item.id)}>
              <Icon size={22} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="sideStatus" title="查看系统状态" onClick={() => setActive("auditSystem")}>
        <div className="sideStatusIcon"><Shield size={18} /></div>
        <div>
          <span>系统状态</span>
          <strong className={currentStatus.tone}>{currentStatus.label}</strong>
          <small>查看运行日志 <ChevronRight size={12} /></small>
        </div>
      </button>
    </aside>
  );
}

function AppTopbar({ active, data, setActive, notify }) {
  const copy = pageCopy[active] || pageCopy.agent;
  const [query, setQuery] = useState("");
  const accounts = data.exchangeAccounts || [];
  const binance = accounts.find((item) => item.exchange === "BINANCE") || {};
  const okx = accounts.find((item) => item.exchange === "OKX") || {};
  const unread = (data.notifications || []).filter((item) => !item.read).length;
  const currentStatus = systemStatus(data);
  const searchTargets = [
    { id: "agent", label: "AI 交易员", terms: ["agent", "目标", "计划", "交易员"] },
    { id: "marketAccount", label: "市场与账户", terms: ["市场", "账户", "btc", "eth", "sol", "持仓", "委托", "交易对"] },
    { id: "eventsTasks", label: "事件与任务", terms: ["事件", "任务", "cpi", "fomc", "cron", "日志"] },
    { id: "knowledgeSkills", label: "知识与技能", terms: ["知识", "技能", "规则", "skill", "mcp"] },
    { id: "riskAuth", label: "风控与授权", terms: ["风控", "授权", "风险", "密钥", "ip", "安全"] },
    { id: "auditSystem", label: "审计与系统", terms: ["审计", "系统", "链路", "trace", "日志", "健康"] }
  ];

  function runSearch(event) {
    if (event.key !== "Enter") return;
    const text = query.trim().toLowerCase();
    if (!text) {
      notify("请输入关键词后按 Enter 搜索");
      return;
    }
    const hit = searchTargets.find((item) => item.label.toLowerCase().includes(text) || item.terms.some((term) => text.includes(term) || term.includes(text)));
    if (hit) {
      setActive(hit.id);
      notify(`已打开：${hit.label}`);
      return;
    }
    notify(`未找到独立页面：${query}`);
  }

  return (
    <header className="appTopbar">
      <label className="globalSearch">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={runSearch} placeholder={copy.search} />
      </label>
      <div className="topbarActions">
        <ExchangePill name="Binance" tone="binance" account={binance} onClick={() => { setActive("riskAuth"); notify(`Binance：${exchangeState(binance).label}`); }} />
        <ExchangePill name="OKX" tone="okx" account={okx} onClick={() => { setActive("riskAuth"); notify(`OKX：${exchangeState(okx).label}`); }} />
        <button className={`autonomyPill ${currentStatus.tone === "danger" || !data.system.autonomyEnabled ? "off" : "on"}`} title={currentStatus.label} onClick={() => setActive("riskAuth")}>
          <span />
          {currentStatus.label}
        </button>
        <button className="bellButton" title="通知" onClick={() => { setActive("auditSystem"); notify(unread ? `有 ${unread} 条未读通知` : "暂无未读通知"); }}>
          <Bell size={20} />
          {unread > 0 && <b>{unread}</b>}
        </button>
        <button className="avatarButton" onClick={() => { setActive("auditSystem"); notify("已打开系统审计"); }}>
          <div className="photoAvatar" />
          <ChevronDown size={16} />
        </button>
      </div>
    </header>
  );
}

function ExchangePill({ name, tone, account = {}, onClick }) {
  const state = exchangeState(account);
  return (
    <button className={`exchangePill ${state.tone}`} title={`${name}：${state.label}`} onClick={onClick}>
      <span className={`exchangeLogo ${tone}`}>{name === "OKX" ? "✣" : "◆"}</span>
      <b>{name}</b>
      <small>{state.label}</small>
      <i />
    </button>
  );
}

function PageHeader({ active }) {
  const copy = pageCopy[active] || pageCopy.agent;
  return (
    <div className="pageHeader">
      <h1>{copy.title}</h1>
      <p>{copy.sub}</p>
    </div>
  );
}

function Card({ className = "", children, ...props }) {
  return <section className={`dashCard ${className}`} {...props}>{children}</section>;
}

function SectionTitle({ icon: Icon, title, action }) {
  return (
    <div className="sectionTitle">
      <div>{Icon && <span className="sectionIcon"><Icon size={18} /></span>}<h2>{title}</h2></div>
      {action}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, tone = "", candles }) {
  return (
    <Card className="metricCard">
      <div className={`metricIcon ${tone}`}>{Icon && <Icon size={22} />}</div>
      <div>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
      {candles && <MiniSparkline candles={candles} />}
    </Card>
  );
}

function MiniSparkline({ candles = [] }) {
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

function CandleChart({ candles = [] }) {
  const series = candles.length ? candles.slice(-72) : [];
  if (!series.length) return <div className="chartEmpty">同步公开行情后显示真实 K 线</div>;
  const min = Math.min(...series.map((item) => Number(item.low || item.close || 0)));
  const max = Math.max(...series.map((item) => Number(item.high || item.close || 0)));
  const width = 100 / Math.max(1, series.length);
  return (
    <svg className="proChart" viewBox="0 0 100 54" preserveAspectRatio="none">
      {series.map((item, index) => {
        const x = index * width + width / 2;
        const yHigh = 42 - ((item.high - min) / Math.max(1, max - min)) * 34;
        const yLow = 42 - ((item.low - min) / Math.max(1, max - min)) * 34;
        const yOpen = 42 - ((item.open - min) / Math.max(1, max - min)) * 34;
        const yClose = 42 - ((item.close - min) / Math.max(1, max - min)) * 34;
        const up = item.close >= item.open;
        const volume = 47 + (index % 7) * 0.4;
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

function LinePriceChart({ candles = [] }) {
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

function StatusBadge({ children, tone = "ok" }) {
  return <span className={`statusBadge ${tone}`}>{children}</span>;
}

function ProgressBar({ value = 50, tone = "green" }) {
  return <div className={`progressBar ${tone}`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function DataTable({ columns, rows }) {
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

function AgentPage({ data, action, ui }) {
  const status = data.agentStatus || {};
  const plan = status.currentPlan || data.tradePlans?.[0] || {};
  const riskWall = status.riskWall || {};
  const latestRun = data.agentRuns?.[0] || {};
  const latestAnalysis = status.latestAnalysis || data.analysisBundles?.[0] || {};
  const currentStatus = systemStatus(data);
  const planRisk = plan.lastRiskCheck || data.riskChecks?.find((item) => item.tradePlanId === plan.id) || {};
  const planConfidence = latestAnalysis.expertViews?.[0]?.confidence ? Math.round(latestAnalysis.expertViews[0].confidence * 100) : null;
  const nextAction = status.nextActions?.[0] || "先完成配置";
  const readOnlyMode = (data.exchangeAccounts || []).every((account) => !account.readEnabled);
  const modeHint = readOnlyMode
    ? "交易所未配置，Agent 当前只能分析与风控预检。"
    : status.reasonNotTrading || "等待条件满足。";
  const commandPlaceholder = "例如：稳健观察 BTC/ETH，单笔风险不超过 0.3%，重大事件前暂停新开仓。";
  const [command, setCommand] = useState("");
  const timeline = status.timeline?.length ? status.timeline : [
    { id: "setup", phase: "待配置", title: "等待 API 与授权配置", summary: "配置完成后开始记录真实轨迹" }
  ];
  const hasPlan = Boolean(plan.id);
  function submitCommand() {
    const trimmed = command.trim();
    if (!trimmed) {
      ui.notify("请先写下交易目标、交易对和风险边界");
      return;
    }
    action("/api/agent/command", { command: trimmed });
  }

  return (
    <div className="pageStack">
      <PageHeader active="agent" />
      <div className="agentGrid">
        <Card className="agentMandateCard">
          <SectionTitle icon={BrainCircuit} title="1 授权我的 AI 交易员" />
          <p className="muted">用自然语言告诉你的目标与偏好</p>
          <div className="chatBubble userBubble">
            <strong>你</strong>
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder={commandPlaceholder} />
            <small>{formatTime(latestRun.createdAt, "待提交")}</small>
          </div>
          <div className="chatBubble agentBubble">
            <div className="botAvatar"><BrainCircuit size={18} /></div>
            <div>
              <strong>AI 交易员 <StatusBadge tone={currentStatus.tone}>{currentStatus.label}</StatusBadge></strong>
              <p>{modeHint}</p>
              <small>{formatDateTime(status.updatedAt)}</small>
            </div>
          </div>
          <div className="chipRow">
            <span>{hasPlan ? humanize(plan.strategy) : "暂无策略"}</span><span>{data.portfolio.riskLabel || "未同步"}</span><span>最大回撤 {displayPct(data.portfolio.maxDrawdownPct, "未同步")}</span><span>{humanize(riskWall.mandateStatus, "未授权")}</span>
          </div>
          <button className="launchButton" onClick={submitCommand}><Rocket size={18} /> {readOnlyMode ? "生成观察计划" : "启动自主交易"}</button>
          <small className="centerMuted">{readOnlyMode ? "当前只生成计划和风控预检，不会向交易所下单" : "启动后，Agent 将根据授权持续自主决策与执行"}</small>
        </Card>

        <Card className="agentStateCard">
          <SectionTitle icon={Target} title="2 当前 Agent 状态" />
          <div className="agentStateMiniGrid">
            <div><Target size={18} /><span>当前目标</span><strong>{latestRun.goal ? "已设定" : "待配置"}</strong><small>{status.currentGoal}</small></div>
            <div><Activity size={18} /><span>系统状态</span><strong className={currentStatus.tone === "ok" ? "positive" : "warning"}>{currentStatus.label}</strong><small>{modeHint}</small></div>
            <div><BarChart3 size={18} /><span>市场判断</span><strong className="positive">{humanize(latestAnalysis.tradingImplication, "未生成")}</strong><small>证据包 {shortId(latestAnalysis.id, "未生成")}</small></div>
            <div><ChevronRight size={18} /><span>下一步动作</span><strong>{compactAction(nextAction)}</strong><small>{nextAction}</small></div>
          </div>
          <div className="planCard">
            <div className="planHead">
              <div><span className="coinBadge">₿</span><strong>{plan.symbol || "暂无计划"}</strong><StatusBadge>{hasPlan ? humanize(plan.strategy) : "待生成"}</StatusBadge></div>
              <small>更新时间 {formatDateTime(plan.createdAt || plan.updatedAt || status.updatedAt)} <RefreshCw size={13} /></small>
            </div>
            <div className="planMatrix">
              <span>入场区间<b>{plan.entry?.range || "未生成"}</b></span>
              <span>止损价<b>{plan.stopLoss || plan.stop_loss ? `${formatMoney(plan.stopLoss || plan.stop_loss)} USDT` : "未生成"}</b></span>
              <span>止盈目标<b>{safeList(plan.takeProfit || plan.take_profit, "未生成")}</b></span>
              <span>仓位大小<b>{hasPlan ? `${plan.position_size_pct || 0}%` : "未生成"}</b><small>{hasPlan ? plan.requires_human_approval ? "需人工确认" : "授权内计划" : "等待授权"}</small></span>
              <span>杠杆<b>{plan.leverage ? `${plan.leverage}x` : "未生成"}</b><small>合约</small></span>
              <span>风控结论<b>{planRisk.summary || humanize(plan.status, "未检查")}</b></span>
              <span>知识置信度<b>{planConfidence === null ? "未生成" : `${planConfidence}%`}</b>{planConfidence !== null && <ProgressBar value={planConfidence} />}</span>
            </div>
            <footer>{hasPlan ? "计划由 AI 生成，满足授权、行情与风控条件后才会进入执行链路。" : "配置 API、授权委托并写明目标后，系统才会生成交易计划。"}<button onClick={() => hasPlan ? ui.openPanel("auditChain") : ui.openPanel("mandate")}>{hasPlan ? "查看完整计划" : "配置授权"} <ChevronRight size={14} /></button></footer>
          </div>
        </Card>

        <Card className="riskWallCard">
          <SectionTitle icon={Shield} title="授权与风控墙" />
          <div className="riskRows">
            <RiskLine label="授权状态" value={humanize(riskWall.mandateStatus, "未授权")} />
            <RiskLine label="允许交易所" value={safeList(riskWall.exchanges, "未授权")} />
            <RiskLine label="允许交易对" value={safeList(riskWall.symbols, "未授权")} />
            <RiskLine label="最大杠杆" value={riskWall.maxLeverage ? `${riskWall.maxLeverage}x` : "未授权"} />
            <RiskLine label="单笔风险上限" value={`${riskWall.singleRiskPct || "-"}%`} />
            <RiskLine label="今日亏损预算" value={riskWall.remainingDailyLossUsdt === null || riskWall.remainingDailyLossUsdt === undefined ? "未授权" : `${displayMoney(riskWall.remainingDailyLossUsdt, 2, "0.00")} USDT 剩余`} progress={0} />
            <RiskLine label="禁止交易原因" value={status.reasonNotTrading || "无"} />
          </div>
          <div className="riskButtons">
            <button onClick={() => action("/api/system/autonomy", { enabled: false })}>暂停</button>
            <button className="danger" onClick={() => action("/api/risk/kill-switch", { enabled: true })}><Zap size={16} /> 一键熔断</button>
          </div>
          <small className="centerMuted">触发后会写入审计日志，并限制后续执行动作。</small>
        </Card>
      </div>

      <Card className="agentTraceCard">
        <SectionTitle icon={Eye} title="4. Agent 运行轨迹（最新循环）" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看完整轨迹 <ChevronRight size={14} /></button>} />
        <div className="traceFlow">
          {timeline.slice(0, 5).map((item) => (
            <div className="traceStep" key={item.id}>
              <div className="traceIcon"><CheckCircle2 size={20} /></div>
              <strong>{humanizePhase(item.phase)}</strong>
              <span>{formatTime(item.createdAt)}</span>
              <small>{item.title}</small>
              <em>{item.summary}</em>
            </div>
          ))}
        </div>
      </Card>

      <div className="bottomMetrics">
        <MetricCard label="账户总资产（USDT）" value={displayMoney(data.portfolio.totalEquityUsdt)} sub="私有账户同步后显示" candles={data.activeMarket?.candles} />
        <MetricCard label="今日盈亏" value={displayMoney(data.portfolio.todayPnl)} sub={displayPct(data.portfolio.todayPnlPct)} tone="positive" candles={data.activeMarket?.candles} />
        <MetricCard label="当前持仓风险" value={data.positions?.length ? `${data.positions.length} 个持仓` : "暂无持仓"} sub="只读同步后显示真实风险" tone="warning" />
        <MetricCard label="本月盈亏（USDT）" value={displayMoney(data.portfolio.weekPnl)} sub={displayPct(data.portfolio.weekPnlPct)} tone="positive" candles={data.activeMarket?.candles} />
        <MetricCard label="公开行情" value={displayMoney(data.activeMarket?.price)} sub={data.activeMarket?.lastSyncedAt ? `同步于 ${formatDateTime(data.activeMarket.lastSyncedAt)}` : "点击市场页刷新"} tone="positive" candles={data.activeMarket?.candles} />
      </div>
    </div>
  );
}

function RiskLine({ label, value, progress }) {
  return (
    <div className="riskLine">
      <span>{label}</span>
      <b>{value}</b>
      {progress !== undefined && <ProgressBar value={progress} />}
    </div>
  );
}

function MarketAccountPage({ data, action, ui }) {
  const initialMarket = data.activeMarket || data.markets?.[0] || { symbol: "BTC/USDT", candles: [] };
  const pairOptions = data.markets?.length ? data.markets.map((item) => item.symbol) : ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
  const timeframeOptions = ["1分", "5分", "15分", "1小时", "4小时", "1日"];
  const [selectedPair, setSelectedPair] = useState(initialMarket.symbol || "BTC/USDT");
  const [selectedTimeframe, setSelectedTimeframe] = useState("1小时");
  const [chartMode, setChartMode] = useState("candles");
  const market = data.markets?.find((item) => item.symbol === selectedPair) || initialMarket;
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const hasAccountData = latestSnapshot || data.portfolio.totalEquityUsdt !== null && data.portfolio.totalEquityUsdt !== undefined;
  const availableMargin = hasAccountData ? (data.portfolio.availableMarginUsdt ?? data.portfolio.availableMargin ?? 0) : null;
  const usedMargin = hasAccountData ? Math.max(0, Number(data.portfolio.totalEquityUsdt || 0) - Number(availableMargin || 0)) : null;
  const positionRows = (data.positions || []).slice(0, 3).map((item) => ({
    id: item.id,
    symbol: <b>{item.symbol}</b>,
    direction: <span className={item.direction === "空" ? "negative" : "positive"}>{item.direction}</span>,
    size: item.size,
    entry: formatMoney(item.entry),
    mark: formatMoney(item.mark),
    pnl: <span className="positive">+{formatMoney(item.pnl)}</span>,
    action: <button className="linkCell" onClick={() => ui.openPanel("positions")}>详情</button>
  }));
  const orderRows = (data.orders || []).slice(0, 4).map((item) => ({
    id: item.id,
    time: formatTime(item.createdAt, "-"),
    symbol: item.symbol || "-",
    side: <span className={String(item.side || "").toLowerCase() === "sell" ? "negative" : "positive"}>{item.side || "-"}</span>,
    type: item.type || "-",
    price: item.price ? formatMoney(item.price) : "-",
    qty: item.size || item.quantity || "-",
    status: orderStatus(item.status),
    action: <button className="linkCell" onClick={() => action("/api/trade-actions/cancel_order", {
      exchange: item.exchange || "BINANCE",
      marketType: item.marketType || item.market_type || "perpetual_usdt",
      symbol: item.symbol,
      orderId: item.orderId,
      clientOrderId: item.clientOrderId || item.client_order_id || item.id,
      manualApproval: true
    })}>撤单</button>
  }));

  return (
    <div className="pageStack">
      <PageHeader active="marketAccount" />
      <div className="metricGrid five">
        <MetricCard label="总资产（USDT）" value={displayMoney(data.portfolio.totalEquityUsdt)} sub="私有账户同步后显示" candles={market.candles} />
        <MetricCard label="可用保证金（USDT）" value={displayMoney(availableMargin)} sub={data.portfolio.totalEquityUsdt ? `可用率 ${displayPct((availableMargin / Math.max(1, data.portfolio.totalEquityUsdt)) * 100).replace("+", "")}` : "私有账户同步后显示"} candles={market.candles} />
        <MetricCard label="今日盈亏（USDT）" value={displayMoney(data.portfolio.todayPnl)} sub={displayPct(data.portfolio.todayPnlPct)} tone="positive" candles={market.candles} />
        <MetricCard label="未实现盈亏（USDT）" value={displayMoney(data.portfolio.weekPnl)} sub={displayPct(data.portfolio.weekPnlPct)} tone="positive" candles={market.candles} />
        <Card className="metricCard reconcileCard actionCard" onClick={() => configuredAccounts ? action("/api/reconciler/run", { mode: "manual_ui" }) : ui.openPanel("keys")} role="button" tabIndex={0}><div><span>对账状态</span><strong className={latestReconcile?.status === "ok" ? "positive" : "warning"}>{configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置"}</strong><small>{configuredAccounts ? `最后对账：${formatDateTime(latestReconcile?.createdAt || latestSnapshot?.createdAt, "暂无记录")}` : "先配置只读 API 后再对账"}</small></div><ChevronRight size={18} /></Card>
      </div>

      <div className="marketGrid">
        <Card className="chartCard">
          <div className="chartHeader">
            <div><h2>市场行情</h2><div className="pairTabs">{pairOptions.map((pair) => <button className={selectedPair === pair ? "active" : ""} key={pair} onClick={() => { setSelectedPair(pair); ui.notify(`已切换交易对：${pair}`); }}>{pair}</button>)}</div></div>
            <div className="toolButtons"><button title="切换图表模式" aria-label="切换图表模式" onClick={() => setChartMode((current) => current === "candles" ? "line" : "candles")}><LineChart size={15} /> {chartMode === "candles" ? "K线" : "折线"}</button><button className="syncTickerButton" title="同步公开行情" onClick={() => action(`/api/exchange/BINANCE/ticker?symbol=${encodeURIComponent(selectedPair)}`, {}, "GET")}><RefreshCw size={15} /> 同步公开行情</button><button onClick={() => ui.openPanel("marketIndicators")}>指标 <ChevronDown size={14} /></button></div>
          </div>
          <div className="timeTabs">{timeframeOptions.map((timeframe) => <button className={selectedTimeframe === timeframe ? "active" : ""} key={timeframe} onClick={() => { setSelectedTimeframe(timeframe); ui.notify(`已切换周期：${timeframe}`); }}>{timeframe}</button>)}</div>
          <div className="chartLegend">开 {displayMoney(market.candles?.at(-1)?.open)}　高 {displayMoney(market.high24h)}　低 {displayMoney(market.low24h)}　收 {displayMoney(market.price)}　涨幅 <b>{displayPct(market.changePct)}</b></div>
          {chartMode === "candles" ? <CandleChart candles={market.candles} /> : <LinePriceChart candles={market.candles} />}
        </Card>
        <Card className="snapshotCard">
          <SectionTitle title={`市场快照（${selectedPair}）`} />
          <RiskLine label="最新价格" value={market.price ? `${displayMoney(market.price)} USDT` : "未同步"} />
          <RiskLine label="24h 涨跌幅" value={displayPct(market.changePct)} />
          <RiskLine label="24h 最高 / 最低" value={market.high24h || market.low24h ? `${displayMoney(market.high24h)} / ${displayMoney(market.low24h)}` : "未同步"} />
          <RiskLine label="资金费率（8h）" value={market.fundingRate || "未同步"} />
          <RiskLine label="持仓量（OI）" value={market.openInterest ? `${market.openInterest} USDT` : "未同步"} />
          <RiskLine label="24h 成交量" value={market.volume24h ? `${market.volume24h} USDT` : "未同步"} />
          <RiskLine label="波动率（24h）" value="未计算" />
          <footer><StatusBadge>{market.status === "synced" ? "已同步" : "未同步"}</StatusBadge></footer>
        </Card>
      </div>

      <div className="marketTables">
        <Card>
          <SectionTitle title={`持仓（${data.positions?.length || 0}）`} />
          <DataTable columns={[
            { key: "symbol", label: "交易对" }, { key: "direction", label: "方向", width: ".7fr" }, { key: "size", label: "数量" }, { key: "entry", label: "开仓均价" }, { key: "mark", label: "标记价格" }, { key: "pnl", label: "未实现盈亏" }, { key: "action", label: "操作", width: ".6fr" }
          ]} rows={positionRows} />
        </Card>
        <Card>
          <SectionTitle title={`当前委托（${data.orders?.length || 0}）`} />
          <DataTable columns={[
            { key: "time", label: "时间" }, { key: "symbol", label: "交易对" }, { key: "side", label: "方向" }, { key: "type", label: "类型" }, { key: "price", label: "价格" }, { key: "qty", label: "数量" }, { key: "status", label: "状态" }, { key: "action", label: "操作" }
          ]} rows={orderRows} />
        </Card>
      </div>

      <div className="metricGrid four">
        <Card className="accountBox"><h2>账户余额（USDT）</h2><div className="accountNumbers"><span>总资产<b>{displayMoney(data.portfolio.totalEquityUsdt)}</b></span><span>可用保证金<b>{displayMoney(availableMargin)}</b></span><span>估算占用<b>{displayMoney(usedMargin)}</b></span><span>冻结资金<b>{displayMoney(data.portfolio.frozenUsdt)}</b></span></div></Card>
        <Card className="donutCard"><h2>保证金率</h2><div className="donut">{data.portfolio.totalEquityUsdt ? `${formatMoney((usedMargin / Math.max(1, data.portfolio.totalEquityUsdt)) * 100, 1)}%` : "未同步"}</div><small>风险等级：{data.portfolio.riskLabel || "未同步"}</small></Card>
        <Card className="safetyCard"><h2>强平安全</h2><strong>{data.positions?.length ? "需计算" : "暂无持仓"}</strong><ProgressBar value={0} /><div className="scale"><span>同步账户</span><span>计算风险</span><span>监控强平</span></div></Card>
        <Card className="syncCard"><h2>交易所同步状态</h2>{(data.exchangeAccounts || []).map((account) => <RiskLine key={account.id} label={account.exchange} value={exchangeState(account).label} />)}<RiskLine label="已配置账户" value={`${configuredAccounts} / ${totalAccounts}`} /><button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看同步日志 <ChevronRight size={14} /></button></Card>
      </div>
    </div>
  );
}

function EventsTasksPage({ data, action, ui }) {
  const events = data.events || [];
  const tasks = data.tasks || [];
  const [selectedEventId, setSelectedEventId] = useState("");
  const [taskFilter, setTaskFilter] = useState("全部");
  const eventRows = events.reduce((acc, event) => {
    const key = `${event.title}:${event.category}`;
    if (!acc.some((item) => `${item.title}:${item.category}` === key)) acc.push(event);
    return acc;
  }, []).slice(0, 5);
  const primaryEvent = eventRows.find((event) => event.id === selectedEventId) || eventRows[0] || events[0] || {};
  const filteredTasks = taskFilter === "全部" ? tasks : tasks.filter((task) => task.type === taskFilter);
  const eventRuleRows = (data.riskRules || []).filter((rule) => rule.scope === "event").map((rule) => ({
    id: rule.id,
    rule: rule.name,
    event: rule.event || "事件条件",
    condition: rule.condition || rule.description || "-",
    action: humanize(rule.action),
    status: <StatusBadge tone={rule.enabled === false ? "warning" : "ok"}>{rule.enabled === false ? "已停用" : "启用"}</StatusBadge>,
    op: <button className="linkCell" onClick={() => ui.openPanel("riskRules")}>管理</button>
  }));
  const taskTabs = [
    ["全部", tasks.length],
    ["Cron", tasks.filter((task) => task.type === "Cron").length],
    ["Every", tasks.filter((task) => task.type === "Every").length],
    ["At", tasks.filter((task) => task.type === "At").length]
  ];
  return (
    <div className="pageStack">
      <PageHeader active="eventsTasks" />
      <div className="eventsGrid">
        <Card className="eventRadarCard">
          <SectionTitle icon={Target} title="重要事件雷达" action={<button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button>} />
          <div className="dateStrip">{eventRows.map((event, index) => <button className={(selectedEventId ? selectedEventId === event.id : index === 0) ? "active" : ""} key={event.id} onClick={() => { setSelectedEventId(event.id); ui.notify(`已选择事件：${event.title}`); }}><span>{event.due || "待定"}</span><span>{event.category}</span></button>)}</div>
          {!eventRows.length && <div className="emptyPanel emptyPanelAction"><strong>暂无真实事件卡</strong><button className="secondaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button></div>}
          <div className="eventRadarInner">
            <div className="eventTimeline">
              {eventRows.map((event, index) => (
                <div className="eventTimelineItem" key={event.id}>
                  <b>{event.due || "待定"}<small>{event.category}</small></b>
                  <span>{event.title}</span>
                  <StatusBadge tone={event.impact >= 80 ? "danger" : "warning"}>{event.impactLabel || "中影响"}</StatusBadge>
                </div>
              ))}
            </div>
            <div className="eventDetail">
              <div className="eventDetailHead"><strong>{primaryEvent.title || "暂无事件"}</strong><StatusBadge tone={primaryEvent.impact >= 80 ? "danger" : "warning"}>{primaryEvent.impactLabel || "待评估"}</StatusBadge><button className="textButton" onClick={() => ui.openPanel("eventSources")}>事件详情 <ChevronRight size={14} /></button></div>
              <div className="countdown eventDue"><b>{primaryEvent.due || "待定"}</b></div>
              <div className="eventMetrics">
                <span>影响等级<b className={primaryEvent.impact >= 80 ? "negative" : "warning"}>{primaryEvent.impactLabel || "待评估"}</b></span>
                <span>市场影响度<b>{primaryEvent.impact ? `${Number(primaryEvent.impact) / 10}/10` : "未评估"}</b><ProgressBar value={primaryEvent.impact || 0} tone="red" /></span>
                <span>历史波动率<b>{data.activeMarket?.candles?.length ? "待计算" : "未同步"}</b><MiniSparkline candles={data.activeMarket?.candles} /></span>
                <span>置信度<b>{primaryEvent.confidence ? `${primaryEvent.confidence}%` : "未评估"}</b><ProgressBar value={primaryEvent.confidence || 0} /></span>
              </div>
              <div className="assetChips">{(primaryEvent.relatedSymbols || []).map((symbol) => <span key={symbol}>{symbol}</span>)}</div>
              <p className="eventAdvice">{primaryEvent.action || "暂无事件建议；刷新真实事件源后显示。"}</p>
            </div>
          </div>
        </Card>

        <Card className="taskCard">
          <SectionTitle icon={CalendarClock} title="定时任务" action={<button className="primaryButton" onClick={() => ui.openPanel("taskManager")}><Plus size={15} /> 新建任务</button>} />
          <div className="taskTabs">{taskTabs.map(([name, count]) => <button className={taskFilter === name ? "active" : ""} key={name} onClick={() => { setTaskFilter(name); ui.notify(`任务筛选：${name}`); }}>{name} {count}</button>)}</div>
          <DataTable columns={[
            { key: "name", label: "任务名称" }, { key: "schedule", label: "触发方式" }, { key: "next", label: "下次运行" }, { key: "status", label: "状态" }, { key: "type", label: "任务分类" }, { key: "op", label: "操作" }
          ]} rows={filteredTasks.slice(0, 5).map((task) => ({ id: task.id, name: task.name, schedule: task.schedule || "Every 1h", next: formatDateTime(task.nextRunAt, task.nextRun || "-"), status: <StatusBadge>{humanize(task.status || "running")}</StatusBadge>, type: task.role || "风控", op: <span className="rowActions"><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button><button className="linkCell" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button></span> }))} />
        </Card>
      </div>

      <div className="eventsBottom">
        <Card>
          <SectionTitle icon={GitBranch} title="事件相对任务规则" action={<button className="primaryButton" onClick={() => ui.openPanel("eventRule")}><Plus size={14} /> 新建规则</button>} />
          <DataTable columns={[
            { key: "rule", label: "规则名称" }, { key: "event", label: "触发事件" }, { key: "condition", label: "触发条件" }, { key: "action", label: "执行动作" }, { key: "status", label: "状态" }, { key: "op", label: "操作" }
          ]} rows={eventRuleRows} />
        </Card>
        <Card>
          <SectionTitle icon={ClipboardList} title="任务运行日志" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看全部日志 <ChevronRight size={14} /></button>} />
          <div className="runLogList">
            {(data.jobRuns || []).slice(0, 5).map((run, index) => (
              <div className="runLog" key={run.id}><b>{formatTime(run.createdAt)}</b><span>{run.taskName}</span><StatusBadge tone={statusTone(run.status)}>{humanize(run.status)}</StatusBadge><small>{run.output}</small></div>
            ))}
            {!data.jobRuns?.length && <div className="emptyPanel">暂无真实任务运行日志。</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function latestAnalysisRows(data) {
  const bundle = data.analysisBundles?.[0];
  if (!bundle) return [];
  const views = (bundle.expertViews || []).map((view, index) => ({
    id: `${bundle.id || "analysis"}:${index}`,
    name: view.domain || "分析视角",
    type: "分析",
    quote: view.view || bundle.summary || "-",
    confidence: view.confidence ? `${Math.round(view.confidence * 100)}%` : "-",
    source: bundle.id || "本次运行"
  }));
  const citations = (bundle.citations || []).map((citation) => ({
    id: `citation:${citation}`,
    name: citation,
    type: "引用",
    quote: "来自真实导入知识库的引用标识",
    confidence: "-",
    source: bundle.id || "本次运行"
  }));
  return [...views, ...citations].slice(0, 6);
}

function KnowledgeSkillsPage({ data, action, ui }) {
  const knowledge = data.knowledge || {};
  const sourceCount = knowledge.sources?.length || 0;
  const conceptCount = knowledge.conceptCards?.length || 0;
  const ruleCount = knowledge.ruleProposals?.length || 0;
  const enabledSkills = (data.skills || []).filter((skill) => skill.status === "已启用").length;
  const importActions = (
    <div className="titleActions">
      <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={14} /> 导入知识</button>
      <button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>全部知识 <ChevronRight size={14} /></button>
    </div>
  );
  return (
    <div className="pageStack">
      <PageHeader active="knowledgeSkills" />
      <div className="metricGrid four">
        <MetricCard icon={FileText} label="知识来源" value={String(sourceCount)} sub={`${knowledge.chunks?.length || 0} 个片段`} tone="positive" />
        <MetricCard icon={Settings} label="专家规则" value={String(ruleCount)} sub={`${conceptCount} 张概念卡`} tone="positive" />
        <MetricCard icon={Sparkles} label="已启用技能" value={String(enabledSkills)} sub={`共 ${data.skills?.length || 0} 个技能`} tone="positive" />
        <MetricCard icon={RefreshCw} label="同步状态" value={data.eventSources?.length ? "有订阅源" : "未配置"} sub={`${data.eventSources?.length || 0} 个事件源`} />
      </div>

      <div className="knowledgeGrid">
        <Card>
          <SectionTitle title="专家知识库" action={importActions} />
          <div className="knowledgeCategoryList">
            {(knowledge.sources || []).slice(0, 5).map((source) => <button className="knowledgeCategory" key={source.id} onClick={() => ui.openPanel("knowledgeList")}><div><Globe2 size={22} /></div><span><strong>{source.domain || source.type}</strong><small>{source.title}</small></span><b>{humanize(source.status)}</b></button>)}
            {!knowledge.sources?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实知识来源</strong>
                <span>可以粘贴文本、导入网页链接、上传 PDF/DOCX/MD/TXT，或填写本地文件路径。</span>
                <button className="primaryButton" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={14} /> 导入知识</button>
              </div>
            )}
          </div>
        </Card>
        <Card className="graphCard">
          <SectionTitle title="概念图谱 / 规则库" action={<button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>全部规则 <ChevronRight size={14} /></button>} />
          {ruleCount || conceptCount ? <div className="conceptGraph"><b>知识图谱</b>{(knowledge.conceptCards || []).slice(0, 6).map((concept, index) => <span className={`node n${index + 1}`} key={concept.id}>{concept.name}</span>)}</div> : (
            <div className="emptyPanel emptyPanelAction">
              <strong>还没有概念或规则</strong>
              <span>导入资料后会自动切片并抽取概念；也可以在导入时生成待审批规则草案。</span>
              <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入并生成图谱</button>
            </div>
          )}
          <div className="ruleTiles">
            {(knowledge.ruleProposals || []).slice(0, 4).map((rule) => <button key={rule.id} onClick={() => ui.openPanel("ruleLibrary")}><strong>{rule.name}</strong><small>{rule.description || "基于专家知识库生成"}</small><StatusBadge tone={rule.status === "已批准" ? "ok" : "warning"}>{humanize(rule.status, "待审批")}</StatusBadge></button>)}
          </div>
          <button className="textButton centered" onClick={() => ui.openPanel("ruleLibrary")}>查看全部规则 <ChevronRight size={14} /></button>
        </Card>
        <Card className="skillCenterCard">
          <SectionTitle title="Skills 中心" action={<button className="textButton" onClick={() => ui.openPanel("skillImport")}>全部技能 <ChevronRight size={14} /></button>} />
          <div className="skillList">
            {(data.skills || []).slice(0, 3).map((skill) => <div key={skill.id}><Sparkles size={18} /><strong>{skill.name}</strong><small>v{skill.version}</small><StatusBadge>{skill.status || "已启用"}</StatusBadge></div>)}
            {!data.skills?.length && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无已导入 Skill</strong>
                <span>填写 GitHub 仓库、Skill.md 链接，或直接粘贴 Skill.md 内容后再扫描安装。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("skillImport")}>导入 Skill</button>
              </div>
            )}
          </div>
          <div className="importButtons"><button onClick={() => ui.openPanel("skillImport")}>从 GitHub 导入</button><button onClick={() => ui.openPanel("skillImport")}>粘贴 Skill.md</button></div>
          <div className="mcpBox">
            <div><strong>MCP 工具</strong><span>{data.mcpServers?.filter((item) => item.status === "connected").length || 0}/{data.mcpServers?.length || 0} 已连接</span></div>
            <div className="mcpChips">{(data.mcpServers || []).slice(0, 3).map((item) => <span key={item.id}>{item.name}<b>{item.status}</b></span>)}</div>
            <RiskLine label="权限与隔离" value="沙箱执行" />
          </div>
        </Card>
      </div>

      <div className="knowledgeBottom">
        <Card>
          <SectionTitle icon={FileText} title="本次决策引用知识" />
          <DataTable columns={[
            { key: "name", label: "知识/规则/技能" }, { key: "type", label: "类型" }, { key: "quote", label: "引用片段", width: "2fr" }, { key: "confidence", label: "置信度" }, { key: "source", label: "来源" }
          ]} rows={(latestAnalysisRows(data) || [])} />
        </Card>
        <Card>
          <SectionTitle icon={RefreshCw} title="最近更新" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>全部更新 <ChevronRight size={14} /></button>} />
          <div className="updateList">
            {data.auditLogs?.filter((item) => item.action?.includes("知识") || item.action?.includes("Skill") || item.action?.includes("导入")).slice(0, 5).map((item) => <div key={item.id}><b>{formatTime(item.createdAt)}</b><span>{item.action}</span><StatusBadge>{item.severity}</StatusBadge><small>{item.actor}</small></div>)}
            {!data.auditLogs?.some((item) => item.action?.includes("知识") || item.action?.includes("Skill") || item.action?.includes("导入")) && (
              <div className="emptyPanel emptyPanelAction">
                <strong>暂无真实知识或技能更新</strong>
                <span>完成一次知识或 Skill 导入后，这里会显示审计记录。</span>
                <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入第一条知识</button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function RiskAuthPage({ data, action, ui }) {
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || {};
  const grayPolicy = data.grayReleasePolicies?.[0] || {};
  const rawRiskScore = latestRisk.riskScore ?? data.portfolio.riskScore;
  const hasRiskScore = rawRiskScore !== null && rawRiskScore !== undefined && rawRiskScore !== "" && Number.isFinite(Number(rawRiskScore));
  const riskScore = hasRiskScore ? Number(rawRiskScore) : 0;
  const mandateTone = mandate.status === "running" || mandate.status === "active" ? "ok" : statusTone(mandate.status);
  const validFrom = mandate.validFrom || mandate.valid_from;
  const validUntil = mandate.validUntil || mandate.valid_until;
  const mandateValidity = validFrom && validUntil
    ? `${formatDate(validFrom)} ~ ${formatDate(validUntil)}`
    : validUntil
      ? `截至 ${formatDate(validUntil)}`
      : validFrom
        ? `${formatDate(validFrom)} 起`
        : "未记录";
  return (
    <div className="pageStack">
      <PageHeader active="riskAuth" />
      <div className="riskAuthGrid">
        <Card>
          <SectionTitle title="授权委托 Mandate" action={<><StatusBadge tone={mandateTone}>{humanize(mandate.status, "未授权")}</StatusBadge><button className="secondaryButton" onClick={() => ui.openPanel("mandate")}>编辑</button></>} />
          <div className="mandateRows">
            <RiskLine label="授权范围" value={humanizeList(mandate.marketTypes, "未设置")} />
            <RiskLine label="交易所" value={safeList(mandate.exchanges, "未授权")} />
            <RiskLine label="交易对白名单" value={safeList(mandate.allowedSymbols, "未授权")} />
            <RiskLine label="最大杠杆倍数" value={mandate.max_leverage || mandate.maxLeverageBySymbol ? `${mandate.max_leverage || Math.max(1, ...Object.values(mandate.maxLeverageBySymbol || { default: 1 }))}x` : "未授权"} />
            <RiskLine label="单日最大亏损" value={`${mandate.maxDailyLossPct || "-"}%`} />
            <RiskLine label="审批阈值（单笔下单）" value={mandate.id ? `≥ ${formatMoney(mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 0, 0)} USDT` : "未授权"} />
            <RiskLine label="有效期" value={mandateValidity} />
            <RiskLine label="状态" value={humanize(mandate.status, "未授权")} />
          </div>
          <button className="textButton centered" onClick={() => ui.openPanel("mandate")}>查看委托详情与审批记录 <ChevronRight size={14} /></button>
        </Card>
        <Card>
          <SectionTitle title="风险规则" action={<button className="secondaryButton" onClick={() => ui.openPanel("riskRules")}>管理规则</button>} />
          <div className="riskRuleGrid">
            {(data.riskRules || []).map((rule) => <div className="riskRuleBox" key={rule.id}><h3>{rule.name}</h3><span>{rule.description}</span><span>级别 {rule.level || "-"}</span><span>动作 {humanize(rule.action, rule.action || "-")}</span><StatusBadge>{rule.enabled ? "启用" : "停用"}</StatusBadge></div>)}
            {!data.riskRules?.length && <div className="emptyPanel">暂无风险规则。</div>}
          </div>
          <p className="muted">规则触发将按预设动作执行，可在右侧「风险状态墙」中手动干预。</p>
        </Card>
        <Card className="riskStatusWall">
          <SectionTitle title="风险状态墙" action={<small>实时更新 {formatDateTime(latestRisk.createdAt || data.system.updatedAt)} <RefreshCw size={13} /></small>} />
          <div className="riskScoreBox"><Shield size={28} /><span>当前风险等级</span><strong>{data.portfolio.riskLabel || "未同步"}</strong><div className="riskGauge">{hasRiskScore ? riskScore : "—"}<small>{hasRiskScore ? "/100" : ""}</small></div></div>
          <div className="lossBudget"><span>剩余亏损预算（今日）<b>{data.system.remainingDailyLossUsdt === null || data.system.remainingDailyLossUsdt === undefined ? "未授权" : `${displayMoney(data.system.remainingDailyLossUsdt, 2, "0.00")} USDT`}</b></span><small>日亏损上限 {mandate.maxDailyLossPct || "-"}%</small><ProgressBar value={hasRiskScore ? Math.max(0, 100 - riskScore) : 0} /></div>
          <RiskLine label="灰度实盘额度" value={grayPolicy.enabled ? `${formatMoney(grayPolicy.maxNotionalUsdt, 0)} USDT` : "未启用"} />
          <RiskLine label="最大杠杆倍数" value={mandate.max_leverage || mandate.maxLeverageBySymbol ? `${mandate.max_leverage || Math.max(1, ...Object.values(mandate.maxLeverageBySymbol || { default: 1 }))}x` : "未授权"} />
          <RiskLine label="最近风控结论" value={latestRisk.summary || humanize(latestRisk.decision, "暂无检查")} />
          <RiskLine label="系统状态" value={systemStatus(data).label} />
          <div className="riskActionRow"><button onClick={() => action("/api/system/autonomy", { enabled: false })}>暂停交易</button><button onClick={() => action("/api/risk/reduce-only", { enabled: true })}>只减仓</button><button className="danger" onClick={() => action("/api/risk/kill-switch", { enabled: true })}>一键熔断</button></div>
          <small className="centerMuted">触发后将立即生效，并记录审计日志。</small>
        </Card>
      </div>
      <div className="securityGrid">
        <Card><SectionTitle title="API 与账户安全" />{(data.exchangeAccounts || []).map((account) => <RiskLine key={account.id} label={account.exchange} value={exchangeState(account).label} />)}<RiskLine label="告警 Webhook" value={data.alerts?.length ? "有告警记录" : "未触发"} /><button className="textButton centered" onClick={() => ui.openPanel("security")}>安全设置 <ChevronRight size={14} /></button></Card>
        <Card><SectionTitle title="IP 白名单" action={<button className="secondaryButton" onClick={() => ui.openPanel("ip")}>管理 IP</button>} />{(data.exchangeAccounts || []).map((account) => <RiskLine key={account.id} label={account.exchange} value={account.ipWhitelist || "未记录"} />)}<button className="textButton centered" onClick={() => ui.openPanel("ip")}>添加 IP <ChevronRight size={14} /></button></Card>
        <Card><SectionTitle title="密钥权限" action={<button className="secondaryButton" onClick={() => ui.openPanel("keys")}>管理密钥</button>} />{(data.apiKeyMetadata || []).map((key) => <RiskLine key={key.id} label={key.exchange} value={key.hasApiKey ? key.hasSecret ? "读写凭证已配置" : "仅 API Key" : "未配置"} />)}<RiskLine label="提现权限" value={(data.apiKeyMetadata || []).some((key) => key.withdrawPermission) ? "危险：发现提现权限" : "禁止"} /></Card>
        <Card><SectionTitle title="授权历史" action={<button className="textButton" onClick={() => ui.setActive("auditSystem")}>查看全部 <ChevronRight size={14} /></button>} /><div className="historyList">{(data.auditLogs || []).filter((item) => item.target?.includes("mandate") || item.action?.includes("授权")).slice(0, 4).map((item) => <div key={item.id}><StatusBadge>{item.severity}</StatusBadge><span>{item.action}</span><small>{item.actor}</small></div>)}</div><button className="textButton centered" onClick={() => ui.download("/api/audit-logs/export?format=csv", "audit-logs.csv")}>导出审计日志 <ChevronRight size={14} /></button></Card>
      </div>
    </div>
  );
}

function AuditSystemPage({ data, ui }) {
  const traces = data.traces || [];
  const jobRuns = data.jobRuns || [];
  const [traceTypeFilter, setTraceTypeFilter] = useState("全部");
  const [traceWindow, setTraceWindow] = useState("24h");
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  const auditOk = data.readiness?.checks?.find((item) => item.key === "audit_chain")?.configured ?? true;
  const successfulRuns = jobRuns.filter((run) => ["ok", "completed"].includes(String(run.status).toLowerCase())).length;
  const successRate = jobRuns.length ? `${((successfulRuns / jobRuns.length) * 100).toFixed(1)}%` : "暂无数据";
  const latencies = traces.map((trace) => Number(trace.latencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = latencies.length ? formatDuration(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]) : "暂无数据";
  const incidents = [...(data.riskIncidents || []), ...(data.alerts || [])].slice(0, 5);
  const cutoff = traceWindow === "24h" ? Date.now() - 24 * 60 * 60 * 1000 : 0;
  const filteredTraces = traces.filter((trace) => {
    const withinWindow = !cutoff || new Date(trace.createdAt).getTime() >= cutoff;
    const withinType = traceTypeFilter === "全部" || trace.type === traceTypeFilter;
    return withinWindow && withinType;
  });
  const traceTypes = ["全部", ...Array.from(new Set(traces.map((trace) => trace.type).filter(Boolean))).slice(0, 3)];
  const chainItems = [
    ["授权任务", latestPlan.mandateId, humanize(data.agentStatus?.activeMandate?.status, "未授权")],
    ["分析包", latestPlan.analysisBundleId, latestPlan.analysisBundleId ? "已生成" : "未生成"],
    ["交易计划", latestPlan.id, humanize(latestPlan.status, "未生成")],
    ["风险校验", latestPlan.riskCheckId || latestRisk.id, humanize(latestRisk.decision || latestRisk.result, "未检查")],
    ["执行", latestOrder.id, humanize(latestOrder.status, "真实写关闭")],
    ["结算对账", data.reconciliationReports?.[0]?.id, humanize(data.reconciliationReports?.[0]?.status, "未对账")],
    ["复盘审查", data.reviews?.[0]?.id, data.reviews?.[0]?.id ? "已记录" : "未生成"]
  ];
  return (
    <div className="pageStack">
      <PageHeader active="auditSystem" />
      <div className="metricGrid five">
        <MetricCard icon={Gauge} label="API 健康" value={data.system.apiHealth || "未知"} sub={`实现 ${data.readiness?.implementationCompletionPct || 0}%`} />
        <MetricCard icon={Activity} label="WebSocket 状态" value={String(data.realtimeConnections?.filter((item) => item.status === "connected").length || 0)} sub={`${data.realtimeConnections?.length || 0} 个连接配置`} />
        <MetricCard icon={Zap} label="任务引擎" value={String(data.tasks?.filter((task) => task.enabled).length || 0)} sub="启用任务" />
        <MetricCard icon={RefreshCw} label="交易所同步" value={`${data.exchangeAccounts?.filter((item) => item.readEnabled).length || 0} / ${data.exchangeAccounts?.length || 0}`} sub="已配置只读账户" />
        <MetricCard icon={Shield} label="审计链" value={auditOk ? "正常" : "异常"} sub={`${data.auditLogs?.length || 0} 条日志`} />
      </div>

      <div className="auditGrid">
        <Card className="auditChainCard">
          <SectionTitle title="Agent 运行审计链" />
          <div className="auditChain">
            {chainItems.map(([item, value, state], index) => (
              <div className="auditStep" key={item} title={value || "未生成"}>
                <div>{index + 1}</div>
                <span><strong>{item}</strong><small>ID: {shortId(value)}</small></span>
                <StatusBadge tone={statusTone(state)}>{state}</StatusBadge>
              </div>
            ))}
          </div>
          <footer><span>最近耗时 <b>{formatDuration(traces[0]?.latencyMs)}</b></span><span>状态 <b className={latestRisk.passed ? "positive" : "warning"}>{humanize(latestRisk.decision || latestPlan.status, "未生成")}</b></span><button className="secondaryButton" onClick={() => ui.openPanel("auditChain")}>查看完整链路 <ChevronRight size={14} /></button></footer>
        </Card>
        <Card>
          <SectionTitle title="决策与工具调用日志" action={<div className="filterGroup">{traceTypes.map((type) => <button className={traceTypeFilter === type ? "active" : ""} key={type} onClick={() => setTraceTypeFilter(type)}>{humanize(type, type)}</button>)}<button className={traceWindow === "24h" ? "active" : ""} onClick={() => setTraceWindow((current) => current === "24h" ? "all" : "24h")}>{traceWindow === "24h" ? "近 24 小时" : "全部时间"} <ChevronDown size={13} /></button></div>} />
          <DataTable columns={[
            { key: "time", label: "时间" }, { key: "agent", label: "Agent / 步骤" }, { key: "type", label: "类型" }, { key: "detail", label: "详情", width: "1.5fr" }, { key: "status", label: "状态" }
          ]} rows={filteredTraces.slice(0, 8).map((trace) => ({ id: trace.id, time: formatTime(trace.createdAt), agent: humanize(trace.type || "步骤"), type: trace.type?.includes("tool") ? "工具调用" : "决策", detail: trace.title, status: <StatusBadge tone={statusTone(trace.status)}>{humanize(trace.status)}</StatusBadge> }))} />
        </Card>
        <Card className="executionAuditCard">
          <SectionTitle title="执行审计" />
          <div className="executionAudit">
            <RiskLine label="订单 ID" value={shortId(latestOrder.id)} />
            <RiskLine label="交易计划 ID" value={shortId(latestPlan.id)} />
            <RiskLine label="风险校验 ID" value={shortId(latestPlan.riskCheckId || latestRisk.id)} />
            <RiskLine label="交易对" value={latestPlan.symbol || latestOrder.symbol || "-"} />
            <RiskLine label="方向 / 类型" value={`${humanize(latestPlan.direction || latestOrder.side, "-")} / ${humanize(latestOrder.type || latestPlan.entry?.type, "-")}`} />
            <RiskLine label="执行状态" value={humanize(latestOrder.status, "真实写操作关闭")} />
            <RiskLine label="对账结果" value={humanize(data.reconciliationReports?.[0]?.status, "未对账")} />
          </div>
          <button className="textButton centered" onClick={() => ui.openPanel("executionDetail")}>查看详情 <ChevronRight size={14} /></button>
        </Card>
      </div>

      <Card>
        <SectionTitle title="系统可观测性" action={<button className="textButton" onClick={() => ui.setActive("eventsTasks")}>全部事件 <ChevronRight size={14} /></button>} />
        <div className="observabilityGrid">
          <MiniChart title="任务成功率" value={successRate} sub={`${jobRuns.length} 次真实任务运行`} />
          <MiniChart title="任务延迟（P95）" value={p95} sub={`${latencies.length} 条 Trace 样本`} />
          <MiniChart title="告警数量" value={String(incidents.length)} sub="风险事件 + 外部告警" />
          <div className="incidentPanel">
            <h3>近期告警与事件</h3>
            {incidents.map((item) => <div key={item.id}><StatusBadge tone={statusTone(item.severity || item.status)}>{humanize(item.status || item.severity, "记录")}</StatusBadge><span>{item.title || item.message || item.action || item.id}</span><small>{formatTime(item.createdAt)}</small></div>)}
            {!incidents.length && <div className="emptyPanel">暂无真实告警。</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}

function MiniChart({ title, value, sub, bars = false }) {
  return (
    <div className="miniChart">
      <h3>{title}</h3>
      <strong>{value}</strong>
      <small>{sub}</small>
      {bars ? <div className="barChart">{[18, 25, 16, 21, 13, 8].map((h, index) => <span style={{ height: `${h * 2}px` }} key={index} />)}</div> : <MiniSparkline />}
    </div>
  );
}

function ConfigPanel({ panel, data, action, ui }) {
  const titles = {
    mandate: "授权委托配置",
    riskRules: "风险规则管理",
    security: "API 与账户安全",
    ip: "IP 白名单",
    keys: "密钥权限",
    eventRule: "事件规则",
    knowledgeImport: "导入知识",
    knowledgeList: "知识来源",
    ruleLibrary: "规则库",
    skillImport: "导入 Skill",
    taskManager: "任务管理",
    marketIndicators: "市场指标",
    eventSources: "事件详情与来源",
    auditChain: "完整审计链",
    executionDetail: "执行详情",
    positions: "持仓详情"
  };
  return (
    <div className="panelOverlay" onClick={ui.closePanel}>
      <aside className="configPanel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>配置中心</span>
            <h2>{titles[panel] || "系统配置"}</h2>
          </div>
          <button className="secondaryButton" onClick={ui.closePanel}>关闭</button>
        </header>
        {panel === "mandate" && <MandatePanel data={data} action={action} />}
        {panel === "riskRules" && <RiskRulesPanel data={data} action={action} />}
        {panel === "security" && <SecurityPanel data={data} action={action} ui={ui} />}
        {panel === "ip" && <IpPanel data={data} action={action} />}
        {panel === "keys" && <KeysPanel action={action} />}
        {panel === "eventRule" && <EventRulePanel action={action} />}
        {panel === "knowledgeImport" && <KnowledgeImportPanel action={action} ui={ui} />}
        {panel === "knowledgeList" && <KnowledgeListPanel data={data} action={action} ui={ui} />}
        {panel === "ruleLibrary" && <RuleLibraryPanel data={data} action={action} ui={ui} />}
        {panel === "skillImport" && <SkillImportPanel data={data} action={action} ui={ui} />}
        {panel === "taskManager" && <TaskManagerPanel data={data} action={action} />}
        {panel === "marketIndicators" && <MarketIndicatorsPanel data={data} action={action} />}
        {panel === "eventSources" && <EventSourcesPanel data={data} action={action} ui={ui} />}
        {panel === "auditChain" && <AuditChainPanel data={data} />}
        {panel === "executionDetail" && <ExecutionDetailPanel data={data} />}
        {panel === "positions" && <PositionsPanel data={data} />}
      </aside>
    </div>
  );
}

function MandatePanel({ data, action }) {
  const mandate = data.mandates?.[0] || {};
  const [form, setForm] = useState({
    name: mandate.name || "主账户授权委托",
    exchange: mandate.exchanges?.[0] || "BINANCE",
    allowedSymbols: safeList(mandate.allowedSymbols, "BTC/USDT, ETH/USDT"),
    maxLeverage: mandate.max_leverage || 1,
    singleRisk: mandate.maxSingleTradeRiskPct || 0.3,
    dailyLoss: mandate.maxDailyLossPct || 1,
    approval: mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 5000
  });
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    const symbols = asArray(form.allowedSymbols).map((item) => item.toUpperCase());
    const maxLeverage = Number(form.maxLeverage || 1);
    const body = {
      name: form.name,
      status: "active",
      exchanges: [form.exchange],
      marketTypes: ["perpetual_usdt"],
      allowedSymbols: symbols,
      strategies: ["manual_review"],
      maxLeverageBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, maxLeverage])),
      max_leverage: maxLeverage,
      maxSingleTradeRiskPct: Number(form.singleRisk || 0),
      maxDailyLossPct: Number(form.dailyLoss || 0),
      humanApprovalNotionalUsdt: Number(form.approval || 0),
      manual_approval_threshold_usdt: Number(form.approval || 0),
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    await action(mandate.id ? `/api/mandates/${mandate.id}` : "/api/mandates", body, mandate.id ? "PATCH" : "POST");
  }
  return (
    <form className="panelForm" onSubmit={submit}>
      <label>名称<input value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label>交易所<select value={form.exchange} onChange={(event) => update("exchange", event.target.value)}><option>BINANCE</option><option>OKX</option></select></label>
      <label>交易对白名单<input value={form.allowedSymbols} onChange={(event) => update("allowedSymbols", event.target.value)} placeholder="BTC/USDT, ETH/USDT" /></label>
      <div className="formGrid">
        <label>最大杠杆<input type="number" min="1" value={form.maxLeverage} onChange={(event) => update("maxLeverage", event.target.value)} /></label>
        <label>单笔风险 %<input type="number" step="0.1" min="0" value={form.singleRisk} onChange={(event) => update("singleRisk", event.target.value)} /></label>
        <label>日亏损上限 %<input type="number" step="0.1" min="0" value={form.dailyLoss} onChange={(event) => update("dailyLoss", event.target.value)} /></label>
        <label>人工确认阈值 USDT<input type="number" min="0" value={form.approval} onChange={(event) => update("approval", event.target.value)} /></label>
      </div>
      <button className="primaryButton" type="submit">保存授权</button>
    </form>
  );
}

function RiskRulesPanel({ data, action }) {
  const [newRule, setNewRule] = useState({ name: "", level: "L3", action: "block", description: "" });
  async function createRule(event) {
    event.preventDefault();
    await action("/api/risk/rules", { ...newRule, scope: "trade" });
    setNewRule({ name: "", level: "L3", action: "block", description: "" });
  }
  return (
    <div className="panelStack">
      {(data.riskRules || []).map((rule) => (
        <div className="panelItem" key={rule.id}>
          <div><strong>{rule.name}</strong><small>{rule.description}</small></div>
          <select defaultValue={rule.action} onChange={(event) => action(`/api/risk/rules/${rule.id}`, { action: event.target.value }, "PATCH")}><option value="block">阻断</option><option value="restrict">限制</option><option value="notify">通知</option><option value="kill_switch">熔断</option></select>
          <button className="secondaryButton" onClick={() => action(`/api/risk/rules/${rule.id}`, { enabled: !rule.enabled }, "PATCH")}>{rule.enabled ? "停用" : "启用"}</button>
        </div>
      ))}
      <form className="panelForm" onSubmit={createRule}>
        <h3>新增规则</h3>
        <label>规则名称<input value={newRule.name} onChange={(event) => setNewRule((current) => ({ ...current, name: event.target.value }))} placeholder="例如：高波动暂停新开仓" /></label>
        <label>说明<textarea value={newRule.description} onChange={(event) => setNewRule((current) => ({ ...current, description: event.target.value }))} /></label>
        <div className="formGrid">
          <label>等级<select value={newRule.level} onChange={(event) => setNewRule((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
          <label>动作<select value={newRule.action} onChange={(event) => setNewRule((current) => ({ ...current, action: event.target.value }))}><option value="notify">通知</option><option value="restrict">限制</option><option value="block">阻断</option><option value="kill_switch">熔断</option></select></label>
        </div>
        <button className="primaryButton" type="submit">创建规则</button>
      </form>
    </div>
  );
}

function SecurityPanel({ data, action, ui }) {
  return (
    <div className="panelStack">
      {(data.exchangeAccounts || []).map((account) => <div className="panelItem" key={account.id}><div><strong>{account.exchange}</strong><small>{account.label}</small></div><StatusBadge tone={exchangeState(account).tone === "off" ? "warning" : "ok"}>{exchangeState(account).label}</StatusBadge><button className="secondaryButton" onClick={() => ui.openPanel("keys")}>配置密钥</button></div>)}
      <button className="primaryButton" onClick={() => action("/api/security/alerts", { severity: "info", title: "安全设置测试", body: "前端安全面板触发" })}>发送测试告警</button>
      <button className="secondaryButton" onClick={() => action("/api/security/drills/kill_switch", {})}>运行熔断演练</button>
    </div>
  );
}

function IpPanel({ data, action }) {
  const [values, setValues] = useState(() => Object.fromEntries((data.exchangeAccounts || []).map((account) => [account.id, account.ipWhitelist || ""])));
  return (
    <div className="panelStack">
      {(data.exchangeAccounts || []).map((account) => (
        <form className="panelForm compact" key={account.id} onSubmit={(event) => { event.preventDefault(); action(`/api/exchange/accounts/${account.id}`, { ipWhitelist: values[account.id] }, "PATCH"); }}>
          <h3>{account.exchange}</h3>
          <label>IP 白名单<input value={values[account.id] || ""} onChange={(event) => setValues((current) => ({ ...current, [account.id]: event.target.value }))} placeholder="例如：1.2.3.4, 5.6.7.8" /></label>
          <button className="primaryButton" type="submit">保存 {account.exchange}</button>
        </form>
      ))}
    </div>
  );
}

function KeysPanel({ action }) {
  return (
    <div className="panelStack">
      <ExchangeCredentialForm exchange="BINANCE" action={action} />
      <ExchangeCredentialForm exchange="OKX" action={action} />
    </div>
  );
}

function ExchangeCredentialForm({ exchange, action }) {
  const needsPassphrase = exchange === "OKX";
  const [form, setForm] = useState({ apiKey: "", apiSecret: "", passphrase: "", ipWhitelist: "" });
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    await action("/api/security/exchange-credentials", { exchange, ...form });
    setForm({ apiKey: "", apiSecret: "", passphrase: "", ipWhitelist: form.ipWhitelist });
  }
  return (
    <form className="panelForm compact" onSubmit={submit}>
      <h3>{exchange} API</h3>
      <label>API Key<input type="password" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" /></label>
      <label>Secret<input type="password" value={form.apiSecret} onChange={(event) => update("apiSecret", event.target.value)} autoComplete="off" /></label>
      {needsPassphrase && <label>Passphrase<input type="password" value={form.passphrase} onChange={(event) => update("passphrase", event.target.value)} autoComplete="off" /></label>}
      <label>IP 白名单<input value={form.ipWhitelist} onChange={(event) => update("ipWhitelist", event.target.value)} placeholder="建议填写交易所绑定 IP" /></label>
      <button className="primaryButton" type="submit">保存 {exchange} 凭证</button>
    </form>
  );
}

function EventRulePanel({ action }) {
  const [form, setForm] = useState({ name: "高影响事件前限制新开仓", description: "事件影响未评估前，限制高杠杆新开仓。", level: "L3" });
  return (
    <form className="panelForm" onSubmit={(event) => { event.preventDefault(); action("/api/risk/rules", { ...form, scope: "event", action: "restrict" }); }}>
      <label>规则名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <label>说明<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
      <label>等级<select value={form.level} onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
      <button className="primaryButton" type="submit">创建事件规则</button>
    </form>
  );
}

function KnowledgeImportPanel({ action, ui }) {
  const [mode, setMode] = useState("text");
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    title: "",
    domain: "交易策略",
    url: "",
    subPath: "",
    filePath: "",
    content: "",
    trustScore: 70,
    createRuleDraft: false
  });
  const modes = [
    ["text", "粘贴文本"],
    ["web", "网页链接"],
    ["upload", "上传文件"],
    ["path", "本地路径"],
    ["github", "GitHub"]
  ];
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    const common = {
      title: form.title.trim(),
      domain: form.domain,
      trustScore: Number(form.trustScore || 70),
      createRuleDraft: form.createRuleDraft
    };
    if (mode === "github") {
      if (!form.url.trim()) return ui.notify("请填写 GitHub 仓库地址");
      const result = await action("/api/knowledge/github-import", { repoUrl: form.url.trim(), subPath: form.subPath.trim() });
      if (result.status === "ok") ui.closePanel();
      return result;
    }
    const body = { ...common };
    if (mode === "text") {
      if (!form.content.trim()) return ui.notify("请粘贴知识文本");
      body.type = "text";
      body.content = form.content;
      body.fileName = `${form.title.trim() || "pasted-knowledge"}.md`;
    }
    if (mode === "web") {
      if (!form.url.trim()) return ui.notify("请填写网页链接");
      body.type = "web";
      body.url = form.url.trim();
    }
    if (mode === "path") {
      if (!form.filePath.trim()) return ui.notify("请填写本地文件路径");
      body.filePath = form.filePath.trim();
    }
    if (mode === "upload") {
      if (!file) return ui.notify("请选择 PDF、DOCX、MD 或 TXT 文件");
      body.fileName = file.name;
      body.title ||= file.name;
      body.fileBase64 = await readFileAsDataUrl(file);
    }
    const result = await action("/api/knowledge/import-real", body);
    if (result.source || result.parsed?.source) ui.closePanel();
    return result;
  }
  return (
    <form className="panelForm" onSubmit={submit}>
      <div className="modeTabs">{modes.map(([id, label]) => <button type="button" className={mode === id ? "active" : ""} key={id} onClick={() => setMode(id)}>{label}</button>)}</div>
      <div className="formGrid">
        <label>标题<input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：趋势交易笔记" /></label>
        <label>领域<input value={form.domain} onChange={(event) => update("domain", event.target.value)} placeholder="交易策略 / 风控 / 宏观" /></label>
      </div>
      {mode === "text" && <label>知识文本<textarea className="largeTextarea" value={form.content} onChange={(event) => update("content", event.target.value)} placeholder="粘贴 Markdown、交易规则、研究笔记或复盘内容" /></label>}
      {mode === "web" && <label>网页链接<input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://..." /></label>}
      {mode === "upload" && <label>上传文件<input type="file" accept=".pdf,.docx,.md,.txt,.json,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
      {mode === "path" && <label>本地文件路径<input value={form.filePath} onChange={(event) => update("filePath", event.target.value)} placeholder="/Users/ely/Desktop/xxx.pdf" /></label>}
      {mode === "github" && (
        <>
          <label>GitHub 仓库<input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://github.com/user/repo.git" /></label>
          <label>子目录<input value={form.subPath} onChange={(event) => update("subPath", event.target.value)} placeholder="可留空" /></label>
        </>
      )}
      <div className="formGrid">
        <label>可信度<input type="number" min="1" max="100" value={form.trustScore} onChange={(event) => update("trustScore", event.target.value)} /></label>
        <label className="checkboxLabel"><input type="checkbox" checked={form.createRuleDraft} onChange={(event) => update("createRuleDraft", event.target.checked)} /> 生成规则草案</label>
      </div>
      <button className="primaryButton" type="submit">导入并解析</button>
    </form>
  );
}

function KnowledgeListPanel({ data, action, ui }) {
  const knowledge = data.knowledge || {};
  const sources = knowledge.sources || [];
  return (
    <div className="panelStack">
      {!sources.length && (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有知识来源</strong>
          <button className="primaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入知识</button>
        </div>
      )}
      {sources.map((source) => {
        const chunkCount = (knowledge.chunks || []).filter((chunk) => chunk.sourceId === source.id).length;
        return (
          <div className="panelItem" key={source.id}>
            <div><strong>{source.title}</strong><small>{source.domain || source.type} · {chunkCount} 个片段 · {formatDateTime(source.importedAt, "未记录")}</small></div>
            <StatusBadge tone={source.status === "parsed" ? "ok" : "warning"}>{humanize(source.status)}</StatusBadge>
            <button className="secondaryButton" onClick={() => action(`/api/knowledge/sources/${source.id}/parse-real`, {})}>{source.status === "parsed" ? "重新解析" : "解析"}</button>
          </div>
        );
      })}
    </div>
  );
}

function RuleLibraryPanel({ data, action, ui }) {
  const knowledge = data.knowledge || {};
  const [newRule, setNewRule] = useState({ name: "", description: "", level: "L2", action: "notify" });
  async function createRule(event) {
    event.preventDefault();
    await action("/api/knowledge/rules/proposals", newRule);
    setNewRule({ name: "", description: "", level: "L2", action: "notify" });
  }
  return (
    <div className="panelStack">
      {!(knowledge.ruleProposals || []).length && (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有规则草案</strong>
          <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>从知识生成</button>
        </div>
      )}
      {(knowledge.ruleProposals || []).map((rule) => (
        <div className="panelItem" key={rule.id}>
          <div><strong>{rule.name}</strong><small>{rule.description || "基于专家知识库生成"} · {rule.level}</small></div>
          <StatusBadge tone={rule.status === "已批准" ? "ok" : "warning"}>{humanize(rule.status, "待审批")}</StatusBadge>
          <button className="secondaryButton" onClick={() => rule.status === "已批准" ? ui.openPanel("riskRules") : action(`/api/knowledge/rules/${rule.id}/approve`, { approved: true })}>{rule.status === "已批准" ? "看风控" : "批准"}</button>
        </div>
      ))}
      <form className="panelForm compact" onSubmit={createRule}>
        <h3>新增规则草案</h3>
        <label>名称<input value={newRule.name} onChange={(event) => setNewRule((current) => ({ ...current, name: event.target.value }))} placeholder="例如：重大事件前禁止高杠杆" /></label>
        <label>说明<textarea value={newRule.description} onChange={(event) => setNewRule((current) => ({ ...current, description: event.target.value }))} /></label>
        <div className="formGrid">
          <label>等级<select value={newRule.level} onChange={(event) => setNewRule((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
          <label>动作<select value={newRule.action} onChange={(event) => setNewRule((current) => ({ ...current, action: event.target.value }))}><option value="notify">通知</option><option value="restrict">限制</option><option value="block">阻断</option><option value="kill_switch">熔断</option></select></label>
        </div>
        <button className="primaryButton" type="submit">提交草案</button>
      </form>
    </div>
  );
}

function SkillImportPanel({ data, action, ui }) {
  const [form, setForm] = useState({ name: "", sourceUrl: "", skillMd: "" });
  async function submit(event) {
    event.preventDefault();
    if (!form.sourceUrl.trim() && !form.skillMd.trim()) return ui.notify("请填写 GitHub/URL 或粘贴 Skill.md");
    await action("/api/skills/fetch", { name: form.name.trim(), sourceUrl: form.sourceUrl.trim(), skillMd: form.skillMd });
    setForm({ name: "", sourceUrl: "", skillMd: "" });
  }
  return (
    <div className="panelStack">
      <form className="panelForm" onSubmit={submit}>
        <label>Skill 名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="可留空，自动读取 SKILL.md 标题" /></label>
        <label>GitHub / Skill.md URL<input value={form.sourceUrl} onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://github.com/user/skill 或 https://.../SKILL.md" /></label>
        <label>Skill.md 内容<textarea className="largeTextarea" value={form.skillMd} onChange={(event) => setForm((current) => ({ ...current, skillMd: event.target.value }))} placeholder="# Skill Name" /></label>
        <button className="primaryButton" type="submit">导入 Skill</button>
      </form>
      {(data.skills || []).map((skill) => (
        <div className="panelItem" key={skill.id}>
          <div><strong>{skill.name}</strong><small>{skill.source || "uploaded"} · v{skill.version}</small></div>
          <StatusBadge tone={skill.status === "已启用" ? "ok" : "warning"}>{skill.status}</StatusBadge>
          <button className="secondaryButton" onClick={() => action(`/api/skills/${skill.id}/${skill.scan === "已扫描" ? "install" : "scan"}`, {})}>{skill.scan === "已扫描" ? "安装" : "扫描"}</button>
        </div>
      ))}
    </div>
  );
}

function TaskManagerPanel({ data, action }) {
  const [form, setForm] = useState({ name: "", type: "Every", schedule: "Every 5m", role: "风控" });
  function updateType(type) {
    const schedule = type === "Cron" ? "*/5 * * * *" : type === "At" ? new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16) : "Every 5m";
    setForm((current) => ({ ...current, type, schedule }));
  }
  async function submit(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const schedule = form.type === "At" ? new Date(form.schedule).toISOString() : form.schedule.trim();
    await action("/api/tasks", { ...form, name, schedule, enabled: true });
    setForm({ name: "", type: form.type, schedule: form.schedule, role: form.role });
  }
  return (
    <div className="panelStack">
      <form className="panelForm" onSubmit={submit}>
        <label>任务名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：行情扫描 / 知识过期检查" /></label>
        <div className="formGrid">
          <label>触发类型<select value={form.type} onChange={(event) => updateType(event.target.value)}><option>Every</option><option>Cron</option><option>At</option></select></label>
          <label>任务分类<input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} /></label>
        </div>
        <label>{form.type === "At" ? "运行时间" : "触发表达式"}<input type={form.type === "At" ? "datetime-local" : "text"} value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} /></label>
        <button className="primaryButton" type="submit">创建任务</button>
      </form>
      {(data.tasks || []).map((task) => (
        <div className="panelItem" key={task.id}>
          <div><strong>{task.name}</strong><small>{task.schedule || "-"} · 下次 {formatDateTime(task.nextRunAt, "未排期")}</small></div>
          <StatusBadge tone={task.enabled === false ? "warning" : "ok"}>{task.enabled === false ? "已暂停" : humanize(task.status, "运行中")}</StatusBadge>
          <span className="panelActions"><button className="secondaryButton" onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button><button className="secondaryButton" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button><button className="secondaryButton dangerText" onClick={() => action(`/api/tasks/${task.id}`, {}, "DELETE")}>删除</button></span>
        </div>
      ))}
      {!data.tasks?.length && <div className="emptyPanel emptyPanelAction"><strong>暂无任务</strong><span>创建任务后会进入调度器，并在运行日志中留下记录。</span></div>}
    </div>
  );
}

function MarketIndicatorsPanel({ data, action }) {
  const markets = data.markets || [];
  return (
    <div className="panelStack">
      {markets.map((market) => (
        <div className="panelItem" key={market.symbol}>
          <div><strong>{market.symbol}</strong><small>状态 {humanize(market.status, "未同步")} · K 线 {market.candles?.length || 0} 根</small></div>
          <StatusBadge tone={market.status === "synced" ? "ok" : "warning"}>{market.price ? `${displayMoney(market.price)} USDT` : "未同步"}</StatusBadge>
          <button className="secondaryButton" onClick={() => action(`/api/exchange/BINANCE/ticker?symbol=${encodeURIComponent(market.symbol)}`, {}, "GET")}>同步</button>
        </div>
      ))}
      <div className="panelForm compact">
        <h3>当前可用指标</h3>
        <RiskLine label="24h 涨跌幅" value={displayPct(data.activeMarket?.changePct)} />
        <RiskLine label="资金费率" value={data.activeMarket?.fundingRate || "未同步"} />
        <RiskLine label="持仓量 OI" value={data.activeMarket?.openInterest ? `${data.activeMarket.openInterest} USDT` : "未同步"} />
        <RiskLine label="波动率" value={data.activeMarket?.candles?.length ? "待计算" : "需先同步 K 线"} />
      </div>
    </div>
  );
}

function EventSourcesPanel({ data, action, ui }) {
  const [form, setForm] = useState({ name: "", type: "rss", url: "", trustScore: 80 });
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.url.trim()) {
      ui.notify("请填写事件源名称和 URL");
      return;
    }
    await action("/api/event-sources", { ...form, trustScore: Number(form.trustScore || 80) });
    setForm({ name: "", type: form.type, url: "", trustScore: form.trustScore });
  }
  return (
    <div className="panelStack">
      <button className="primaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button>
      {(data.events || []).slice(0, 5).map((event) => (
        <div className="panelItem" key={event.id}>
          <div><strong>{event.title}</strong><small>{event.category || "事件"} · {event.due || "待定"}</small></div>
          <StatusBadge tone={event.impact >= 80 ? "danger" : "warning"}>{event.impactLabel || "待评估"}</StatusBadge>
          <button className="secondaryButton" onClick={() => action(`/api/events/${event.id}/progress`, { note: "人工查看后标记进度" })}>标记</button>
        </div>
      ))}
      {!data.events?.length && <div className="emptyPanel emptyPanelAction"><strong>暂无事件卡</strong><span>刷新事件源后会生成真实事件卡。</span></div>}
      <form className="panelForm compact" onSubmit={submit}>
        <h3>新增事件源</h3>
        <label>名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：交易所公告 / 宏观日历 RSS" /></label>
        <label>URL<input value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." /></label>
        <div className="formGrid">
          <label>类型<select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option value="rss">RSS</option><option value="html">HTML</option><option value="json">JSON</option></select></label>
          <label>可信度<input type="number" min="1" max="100" value={form.trustScore} onChange={(event) => setForm((current) => ({ ...current, trustScore: event.target.value }))} /></label>
        </div>
        <button className="primaryButton" type="submit">保存事件源</button>
      </form>
    </div>
  );
}

function AuditChainPanel({ data }) {
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  const chainItems = [
    ["授权任务", latestPlan.mandateId, humanize(data.agentStatus?.activeMandate?.status, "未授权")],
    ["分析包", latestPlan.analysisBundleId, latestPlan.analysisBundleId ? "已生成" : "未生成"],
    ["交易计划", latestPlan.id, humanize(latestPlan.status, "未生成")],
    ["风险校验", latestPlan.riskCheckId || latestRisk.id, humanize(latestRisk.decision || latestRisk.result, "未检查")],
    ["执行", latestOrder.id, humanize(latestOrder.status, "真实写关闭")],
    ["结算对账", data.reconciliationReports?.[0]?.id, humanize(data.reconciliationReports?.[0]?.status, "未对账")],
    ["复盘审查", data.reviews?.[0]?.id, data.reviews?.[0]?.id ? "已记录" : "未生成"]
  ];
  return (
    <div className="panelStack">
      {chainItems.map(([label, value, state], index) => (
        <div className="panelItem" key={label}>
          <div><strong>{index + 1}. {label}</strong><small>{value || "未生成 ID"}</small></div>
          <StatusBadge tone={statusTone(state)}>{state}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

function ExecutionDetailPanel({ data }) {
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  return (
    <div className="panelStack">
      <div className="panelForm compact">
        <RiskLine label="订单 ID" value={latestOrder.id || "未生成"} />
        <RiskLine label="交易计划 ID" value={latestPlan.id || "未生成"} />
        <RiskLine label="风险校验 ID" value={latestPlan.riskCheckId || latestRisk.id || "未生成"} />
        <RiskLine label="交易对" value={latestPlan.symbol || latestOrder.symbol || "-"} />
        <RiskLine label="方向 / 类型" value={`${humanize(latestPlan.direction || latestOrder.side, "-")} / ${humanize(latestOrder.type || latestPlan.entry?.type, "-")}`} />
        <RiskLine label="执行状态" value={humanize(latestOrder.status, "真实写操作关闭")} />
        <RiskLine label="对账结果" value={humanize(data.reconciliationReports?.[0]?.status, "未对账")} />
      </div>
      {!latestOrder.id && !latestPlan.id && <div className="emptyPanel emptyPanelAction"><strong>暂无执行对象</strong><span>生成交易计划并通过风控后，这里会展示订单、风控和对账详情。</span></div>}
    </div>
  );
}

function PositionsPanel({ data }) {
  const positions = data.positions || [];
  return (
    <div className="panelStack">
      {positions.map((position) => (
        <div className="panelForm compact" key={position.id}>
          <h3>{position.symbol}</h3>
          <RiskLine label="方向" value={position.direction || "-"} />
          <RiskLine label="数量" value={position.size || "-"} />
          <RiskLine label="开仓均价" value={position.entry ? formatMoney(position.entry) : "-"} />
          <RiskLine label="标记价格" value={position.mark ? formatMoney(position.mark) : "-"} />
          <RiskLine label="未实现盈亏" value={position.pnl ? formatMoney(position.pnl) : "-"} />
        </div>
      ))}
      {!positions.length && <div className="emptyPanel emptyPanelAction"><strong>暂无真实持仓</strong><span>配置只读 API 并完成同步后，这里会展示交易所持仓明细。</span></div>}
    </div>
  );
}

function App() {
  const [active, setActive] = useState("agent");
  const [panel, setPanel] = useState("");
  const { data, loading, action, toast, authRequired, login, notify, download, refresh } = useApi();
  const ui = { setActive, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const content = useMemo(() => {
    if (!data) return null;
    if (active === "marketAccount") return <MarketAccountPage data={data} action={action} ui={ui} />;
    if (active === "eventsTasks") return <EventsTasksPage data={data} action={action} ui={ui} />;
    if (active === "knowledgeSkills") return <KnowledgeSkillsPage data={data} action={action} ui={ui} />;
    if (active === "riskAuth") return <RiskAuthPage data={data} action={action} ui={ui} />;
    if (active === "auditSystem") return <AuditSystemPage data={data} action={action} ui={ui} />;
    return <AgentPage data={data} action={action} ui={ui} />;
  }, [active, data, action, notify, download, refresh]);

  if (authRequired && !data) return <LoginScreen login={login} toast={toast} />;
  if (loading || !data) return <div className="loading"><Activity size={28} /> 正在启动 AI Trading Agent...</div>;

  return (
    <div className="appShell">
      <Sidebar active={active} setActive={setActive} data={data} />
      <main className="mainArea">
        <AppTopbar active={active} data={data} setActive={setActive} notify={notify} />
        <div className="content">{content}</div>
      </main>
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function LoginScreen({ login, toast }) {
  const [password, setPassword] = useState("");
  return (
    <div className="loginScreen">
      <form className="loginPanel" onSubmit={(event) => { event.preventDefault(); login(password); }}>
        <div className="brandMark"><Layers size={24} /></div>
        <h1>AI 数字货币交易 Agent</h1>
        <p>请输入管理员密码进入交易驾驶舱。</p>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="ADMIN_PASSWORD" autoFocus />
        <button className="primaryButton" type="submit">登录</button>
        {toast && <small>{toast}</small>}
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
