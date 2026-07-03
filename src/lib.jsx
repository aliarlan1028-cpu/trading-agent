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
  marketAccount: { title: "仪表盘", sub: "聚合账户绩效、对账健康、收益质量与风险承压，不展示交易图表噪音", search: "搜索绩效、账户、对账或风险" },
  eventsTasks: { title: "事件与任务", sub: "接入真实事件源与任务规则后，追踪风险窗口和自动化运行记录", search: "搜索市场、交易对、知识或功能" },
  knowledgeSkills: { title: "知识与技能", sub: "沉淀专家知识，构建规则与技能，让 Agent 更懂市场、更会交易。", search: "搜索知识、规则、技能或文档" },
  review: { title: "复盘", sub: "复盘交易、Agent 行为、Skill 运行和可优化线索，形成下一轮改进闭环", search: "搜索交易、复盘、Skill 或优化项" },
  riskAuth: { title: "风控与授权", sub: "集中管理授权委托、风险规则与安全策略，确保交易策略在可控范围内执行。", search: "搜索市场、交易对、知识或功能" },
  auditSystem: { title: "审计", sub: "审计 Agent 行为，监控系统健康，保障交易安全与合规", search: "搜索市场、交易对、知识或功能" },
  systemSettings: { title: "系统设置", sub: "集中维护模型、交易所、告警、运行参数与实盘灰度配置", search: "搜索配置、密钥、模型或交易所" }
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
  const dangerStates = ["blocked", "error", "failed", "rejected", "risk_rejected", "已阻断", "异常", "失败", "已拒绝", "风控拒绝"];
  const warningStates = ["warning", "degraded", "skipped_locked", "allowed_with_warnings", "paused", "setup_required", "missing_credentials", "not_synced", "data_unavailable", "降级运行", "并发锁跳过", "允许但有警告", "已暂停", "告警", "只读观察", "人工暂停", "风控暂停", "待配置", "未配置", "未同步", "缺少数据"];
  if (dangerStates.includes(value) || dangerStates.includes(String(status || ""))) return "danger";
  if (warningStates.includes(value) || warningStates.includes(String(status || ""))) return "warning";
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

export function useApi() {
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

export function PageHeader({ active }) {
  const copy = pageCopy[active] || pageCopy.agent;
  return (
    <div className="pageHeader">
      <h1>{copy.title}</h1>
      <p>{copy.sub}</p>
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

export function MetricCard({ icon: Icon, label, value, sub, tone = "" }) {
  return (
    <Card className={`metricCard ${Icon ? "" : "noIcon"}`}>
      {Icon && <div className={`metricIcon ${tone}`}><Icon size={20} /></div>}
      <div>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
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
