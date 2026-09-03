import { useEffect, useRef, useState } from "react";
import { getLang, t } from "./i18n.js";
import {
  createJsonProjectionArray,
  createJsonProjectionRecord,
  hasJsonResponseProvenance,
  jsonResponseArrayValues,
  parseJsonResponse,
  parseJsonResponseText,
  projectJsonResponseRecord
} from "./jsonResponseProvenance.js";
import { acceptCoreSnapshot, acceptSectionSnapshot, clearSnapshotStore, createSnapshotStore, markSnapshotResource, observeSnapshotInvalidation, projectSnapshotStore, shouldRetryStaleSnapshot } from "./snapshotStore.js";
import { connectionSecurityStatus, shouldAttemptNativeFallback } from "./connectionSecurity.js";
import { initialAuthRequired, shouldSynchronizeAuthenticatedData } from "./sessionBootstrap.js";

const boundedApprovalText = (value, maximum = 240) => typeof value === "string"
  && value.length > 0
  && value.length <= maximum
  && !/[\u0000-\u001f\u007f]/u.test(value)
  ? value
  : undefined;

function boundedApprovalFailure(url, json, httpStatus) {
  if (!/^\/api\/trade-plans\/[^/]+\/approve$/u.test(url) || !json || typeof json !== "object") return null;
  const result = { ok: false, httpStatus };
  for (const key of ["error", "message"]) {
    const value = boundedApprovalText(json[key]);
    if (value !== undefined) result[key] = value;
  }
  for (const key of ["approvalGranted", "executionSubmitted"]) {
    if (typeof json[key] === "boolean") result[key] = json[key];
  }
  const projections = [
    ["plan", ["id", "status"]],
    ["execution", ["status", "reason"]],
    ["guard", ["label", "fix"]]
  ];
  for (const [key, fields] of projections) {
    const source = json[key];
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const projected = {};
    for (const field of fields) {
      const value = boundedApprovalText(source[field]);
      if (value !== undefined) projected[field] = value;
    }
    if (Object.keys(projected).length) result[key] = projected;
  }
  return result;
}

export function TurnstileWidget({ siteKey, onToken }) {
  const hostRef = useRef(null);
  const callbackRef = useRef(onToken);
  useEffect(() => { callbackRef.current = onToken; }, [onToken]);
  useEffect(() => {
    if (!siteKey || !hostRef.current) return undefined;
    let cancelled = false;
    let widgetId;
    const render = () => {
      if (cancelled || !hostRef.current || !window.turnstile || widgetId !== undefined) return;
      widgetId = window.turnstile.render(hostRef.current, {
        sitekey: siteKey,
        callback: (token) => callbackRef.current?.(token),
        "expired-callback": () => callbackRef.current?.(""),
        "error-callback": () => callbackRef.current?.("")
      });
    };
    let script = document.querySelector('script[data-trading-agent-turnstile="true"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.tradingAgentTurnstile = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    const poll = window.setInterval(render, 250);
    render();
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      script?.removeEventListener("load", render);
      if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);
  if (!siteKey) return null;
  return <div className="turnstileHost" ref={hostRef} />;
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

export function displayMoney(value, digits = 2, fallback = t("未同步", "Not synced")) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function displayPct(value, fallback = t("未同步", "Not synced")) {
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

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(t("文件读取失败", "Unable to read file")));
    reader.readAsDataURL(file);
  });
}

export function formatDateTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(getLang() === "en" ? "en-US" : "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
}

export function formatDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(getLang() === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" });
}

// 北京时间 HH:mm(全站时间统一 UTC+8;ISO 直接 slice 是 UTC 会差 8 小时)。
export function hhmmCn(value, fallback = "?") {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleTimeString(getLang() === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
}

export function formatTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString(getLang() === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Shanghai" });
}

export function humanize(value, fallback = "-") {
  const key = String(value || "").trim();
  if (!key) return fallback;
  const normalized = key.toLowerCase();
  const labels = {
    running: ["运行中", "Running"], active: ["已生效", "Active"], trialing: ["试用中", "Trial"], paused: ["已暂停", "Paused"], revoked: ["已撤销", "Revoked"],
    pending_confirmation: ["待确认", "Needs confirmation"], setup_required: ["待配置", "Setup required"], missing_credentials: ["未配置", "Credentials missing"], missing: ["未授权", "Not authorized"], not_synced: ["未同步", "Not synced"], data_unavailable: ["缺少数据", "Data unavailable"],
    configured: ["已配置", "Configured"], connected: ["已连接", "Connected"], registered: ["待连接", "Awaiting connection"], available_without_key: ["免密钥可用", "Available without a key"], imported: ["已导入", "Imported"], parsed: ["已解析", "Parsed"], empty: ["无可用文本", "No usable text"], degraded: ["降级运行", "Degraded"], ok: ["正常", "Healthy"],
    blocked: ["已阻断", "Blocked"], block: ["阻断", "Block"], kill_switch: ["紧急停止", "Emergency stop"], error: ["异常", "Error"], warning: ["告警", "Warning"], failed: ["失败", "Failed"], stopped: ["已停止", "Stopped"], completed: ["已完成", "Completed"], open: ["挂单中", "Open order"],
    allowed: ["允许", "Allowed"], allowed_with_warnings: ["允许但有警告", "Allowed with warnings"], allow_small_position: ["允许小仓位", "Small position allowed"], risk_rejected: ["风控拒绝", "Rejected by risk controls"], auto_blocked: ["自动执行被阻断", "Automated execution blocked"], setup_rejected: ["交易计划未通过", "Trade plan rejected"], protection_failed: ["保护单失败", "Protection order failed"],
    cancelled: ["已取消", "Cancelled"], canceled: ["已取消", "Cancelled"], dry_run: ["模拟执行（未下单）", "Simulation only (no order)"], executing: ["执行中", "Executing"], entry_pending: ["入场挂单中", "Entry order open"], entry_filled: ["入场已成交", "Entry filled"], protecting: ["止盈止损中", "Exit protection active"], awaiting_approval: ["等待确认", "Awaiting approval"], armed: ["等待价格条件（未下单）", "Waiting for price (no order)"], triggered: ["价格已到，执行前复核", "Price reached; pre-trade checks"], fast_validating: ["刷新行情、账户与风控", "Refreshing market, account, and risk"], approved: ["已批准", "Approved"], expired: ["已过期", "Expired"], invalidated: ["计划已失效", "Plan invalidated"], superseded: ["已被新计划替代", "Replaced by a newer plan"], draft: ["草案", "Draft"], monitoring: ["持仓监控", "Position monitoring"], submitted: ["已提交", "Submitted"],
    skipped_locked: ["任务繁忙，已跳过", "Skipped while another run was active"], scheduled_task: ["定时任务", "Scheduled task"], risk_check: ["风控检查", "Risk check"], mandate: ["交易权限检查", "Trading permission check"], "mandate checking": ["交易权限检查", "Trading permission check"], observing: ["观察市场", "Monitoring market"], analyzing: ["生成分析", "Analyzing"], planning: ["生成计划", "Building trade plan"], "risk checking": ["风控检查", "Risk check"], reconciling: ["账户对账", "Reconciling account"], reviewing: ["复盘审查", "Reviewing"],
    agent_orchestrator: ["Agent 编排", "Agent orchestration"], exchange_private_read: ["交易所账户同步", "Exchange account sync"], exchange_market: ["公开行情", "Public market data"], realtime_ws: ["实时连接", "Real-time connection"], trade_execution: ["交易执行", "Trade execution"], system: ["系统", "System"],
    trend_pullback: ["趋势回调", "Trend pullback"], trend_continuation: ["趋势延续", "Trend continuation"], breakout_retest: ["突破后回踩", "Breakout retest"], breakdown_retest: ["跌破后回抽", "Breakdown retest"], reversal_reclaim: ["反转回收", "Reversal reclaim"], fake_breakout: ["假突破回收", "False-break reclaim"], range_rejection: ["区间边界拒绝", "Range rejection"], trend_following: ["趋势跟随", "Trend following"], event_protection: ["事件保护", "Event protection"], manual_review: ["自主研判", "AI review"], event_driven: ["事件驱动", "Event-driven"], breakout: ["突破策略", "Breakout"], spot: ["现货", "Spot"], perpetual_usdt: ["U 本位永续", "USDT perpetual"], perpetual: ["永续合约", "Perpetual"],
    "已启用": ["已启用", "Enabled"], "工具": ["工具", "Tool"], "完成": ["完成", "Completed"], "等待": ["等待", "Waiting"], "待批准": ["待批准", "Awaiting approval"], "待复核": ["待复核", "Awaiting review"], "待安全复核": ["待安全复核", "Awaiting security review"],
    create_mandate_draft: ["创建交易权限草案", "Create trading-permissions draft"],
    "低影响": ["低影响", "Low impact"], "中影响": ["中影响", "Medium impact"], "高影响": ["高影响", "High impact"],
    "宏观": ["宏观", "Macro"], "衍生品": ["衍生品", "Derivatives"], "币圈": ["币圈", "Crypto"], "币圈事件": ["币圈事件", "Crypto"], "链上事件": ["链上事件", "On-chain"], "项目": ["项目", "Project"]
  };
  const label = labels[key] || labels[normalized];
  return label ? t(label[0], label[1]) : key.replace(/_/g, " ");
}

// 后端审计与状态数据历史上以中文持久化；英文界面展示时在边界层翻译，
// 不改写原始审计事实，也避免把运行时语言偏好混入服务端状态机。
export function localizeText(value, fallback = "-") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const legacy = {
    "条件已武装": ["等待入场（尚未下单）", "Waiting for entry (no order placed)"],
    "Agent 条件交易计划已武装": ["等待入场计划已启动（尚未下单）", "Entry monitoring started (no order placed)"],
    "授权委托配置": ["交易权限设置", "Trading permissions"],
    "主账户授权委托": ["主账户交易权限", "Primary account trading permissions"]
  };
  if (legacy[raw]) return t(legacy[raw][0], legacy[raw][1]);
  if (getLang() !== "en") return raw;
  const exact = {
    "默认对话": "Default conversation",
    "本地管理员": "Local Admin",
    "自主决策被拦": "Autonomous decisions blocked",
    "无激活授权": "No active trading permissions",
    "未配置 LLM": "LLM not configured",
    "检测到提现权限时禁止交易并触发熔断。": "Block trading and activate the emergency stop if withdrawal permission is detected.",
    "自主推进已暂停": "Autonomy paused",
    "恢复后按定时巡检 + 观察哨自主决策": "Resume to run scheduled reviews and monitor registered watch conditions.",
    "配置交易所 API Key/Secret": "Add your OKX API key and secret",
    "确认 API Key 无提现权限并设置 IP 白名单": "Disable withdrawals and add an IP allowlist for the API key",
    "配置 LLM API Key": "Add an LLM API key",
    "同步公开行情与只读账户": "Sync public market data and the read-only account",
    "人工批准": "Per-trade approval",
    "人工暂停": "Paused manually",
    "风控暂停": "Paused by risk controls",
    "等待配置": "Setup required",
    "只读观察": "Observe only",
    "自动交易": "Automated trading",
    "正常": "Healthy",
    "市场观察员": "Market Analyst",
    "事件分析员": "News & Events Analyst",
    "策略研究员": "Strategy Researcher",
    "交易计划员": "Trade Planner",
    "风控官": "Risk Officer",
    "执行监督员": "Execution Supervisor",
    "持仓管理员": "Position Manager",
    "复盘/记忆管理员": "Review & Memory Manager",
    "我不是来替你冒险的，我是来把风险变得可见、可控、可复盘的。": "I do not take unmanaged risks on your behalf. I make risk visible, controlled, and reviewable.",
    "冷静、克制、证据优先；只描述市场状态，不把噪声包装成机会。": "Calm, disciplined, and evidence-first. Describe market conditions without dressing noise up as opportunity.",
    "警觉、保守、重视尾部风险；宁可提前降噪，也不忽略黑天鹅。": "Alert and conservative, with close attention to tail risk. Filter noise early without ignoring black swans.",
    "好奇但不冲动；把假设当假设，把证据当证据。": "Curious without being impulsive. Keep hypotheses separate from evidence.",
    "结构化、耐心、尊重授权边界；没有止损就不算计划。": "Structured, patient, and respectful of trading permissions. A plan without a stop is not a valid plan.",
    "怀疑、严格、保护型；默认先问这笔交易怎么亏。": "Skeptical, strict, and protective. Start by asking how the trade can lose.",
    "谨慎、机械、关注细节；只相信执行引擎和交易所回执。": "Cautious, procedural, and detail-oriented. Trust only the execution engine and exchange acknowledgements.",
    "防守优先、少做动作；盈利时保护利润，亏损时尊重止损。": "Defense first, with minimal intervention. Protect gains and respect stops.",
    "诚实、细致、不找借口；把亏损变成规则，把盈利变成可验证方法。": "Honest and meticulous, without excuses. Turn losses into rules and wins into testable methods.",
    "读取行情、资金费率、成交量、波动率和订单簿，形成结构化市场观察。": "Read prices, funding, volume, volatility, and the order book to produce structured market observations.",
    "分析宏观、链上、交易所公告和突发新闻对授权交易对的影响。": "Assess how macro events, on-chain activity, exchange announcements, and breaking news affect allowed markets.",
    "从知识库、历史复盘和行情结构中提出可验证的交易假设。": "Develop testable trading hypotheses from the knowledge base, historical reviews, and market structure.",
    "把交易假设转成结构化计划：方向、入场、止损、止盈、杠杆、仓位理由。": "Turn a trading hypothesis into a structured plan covering direction, entry, stop, targets, leverage, and sizing rationale.",
    "检查授权边界、单笔风险、日亏损、杠杆、事件窗口、相关性和止损。": "Check trading permissions, per-trade risk, daily loss, leverage, event windows, correlation, and stops.",
    "监督计划进入执行引擎后的订单状态、滑点、保护单、撤单和平仓条件。": "Monitor order status, slippage, protective orders, cancellations, and exit conditions after a plan reaches execution.",
    "监控已有仓位，建议移动止损、减仓、止盈或关闭风险仓位。": "Monitor open positions and recommend stop adjustments, reductions, profit-taking, or risk exits.",
    "交易后总结原因、执行质量、错误类型，并决定是否写入长期记忆或更新规则。": "After a trade, review rationale, execution quality, and error type, then decide whether to update long-term memory or rules.",
    "只写入高置信、可复盘的市场状态变化。": "Store only high-confidence market-state changes that can be reviewed later.",
    "记录事件前后市场反应和误判来源。": "Record market reactions around events and the sources of incorrect assessments.",
    "把被验证或被否定的策略假设写入长期记忆。": "Store validated and rejected strategy hypotheses in long-term memory.",
    "记录计划参数与最终表现之间的差异。": "Record the difference between planned parameters and final performance.",
    "把被拦截计划和真实损失案例沉淀为风控经验。": "Turn blocked plans and realized-loss cases into reusable risk lessons.",
    "记录滑点、拒单、保护单失败等执行质量问题。": "Record execution-quality issues such as slippage, rejections, and failed protective orders.",
    "记录持仓管理动作对回撤和利润回吐的影响。": "Record how position-management actions affect drawdown and profit giveback.",
    "负责长期记忆质量，定期清理低质量或过期经验。": "Maintain long-term memory quality and remove low-quality or stale lessons.",
    "不得给出下单指令": "Must not issue order instructions",
    "必须标注数据来源与同步时间": "Must identify data sources and synchronization time",
    "证据不足时输出继续观察": "Must continue monitoring when evidence is insufficient",
    "不得独立生成交易计划": "Must not create a trade plan independently",
    "高影响事件必须触发风险提示": "High-impact events must produce a risk warning",
    "必须区分事实、推断和未知": "Must distinguish facts, inferences, and unknowns",
    "不得跳过样本和失败条件": "Must not omit samples or failure conditions",
    "不得把研究结论直接变成订单": "Must not turn research conclusions directly into orders",
    "必须写清失效条件": "Must state invalidation conditions clearly",
    "必须包含止损": "A stop loss is required",
    "必须绑定授权委托": "Must be bound to active trading permissions",
    "必须交给风控官审查": "Must be reviewed by the Risk Officer",
    "不得直接调用交易写接口": "Must not call trading write APIs directly",
    "只能批准/拒绝/要求降风险": "May only approve, reject, or require lower risk",
    "不得为了收益放宽硬规则": "Must not relax hard controls to pursue returns",
    "风控失败必须写审计": "Risk-control failures must be audited",
    "不能绕过执行引擎": "Must not bypass the execution engine",
    "不能直接下单": "Must not place orders directly",
    "订单异常必须升级给风控官": "Order anomalies must be escalated to the Risk Officer",
    "加仓默认禁止": "Adding to a position is prohibited by default",
    "只能建议降风险动作": "May recommend only risk-reducing actions",
    "不得扩大未授权风险敞口": "Must not increase unauthorized exposure",
    "不得篡改历史记录": "Must not alter historical records",
    "不得只记录盈利样本": "Must not record only winning samples",
    "复盘结论必须可验证": "Review conclusions must be testable",
    "需要完成基础配置": "Basic setup required",
    "自主交易必须带止损": "Stop loss required for automated trades",
    "API Key 禁止提现权限": "API key must not allow withdrawals",
    "主账户授权委托": "Primary account trading permissions",
    "手写规范策略(精选)": "Curated rule-based strategies",
    "加密永续交易条令 v1": "Crypto perpetual trading doctrine v1",
    "条令·核心判读与反瘫痪": "Doctrine · decisive analysis without paralysis",
    "条令·行情场景手册(按当前regime套用,只有一个成立)": "Doctrine · market-regime playbook (use the single matching regime)",
    "条令·持仓生命周期管理": "Doctrine · position lifecycle management",
    "条令·执行与成本": "Doctrine · execution and costs",
    "条令·风险与压力测试": "Doctrine · risk and stress testing",
    "反叙事开仓:无统计支撑、说不出失效条件的形态式开仓禁止": "No narrative-only entries: a setup needs statistical support and a clear invalidation condition",
    "反过拟合:只认样本外+纯前向验证过的策略,不把模板名/知识方法冒充'已验证策略'": "Anti-overfitting: only out-of-sample and forward-tested strategies count as validated",
    "投机≠赌博:入场前必须有预定的失效/离场点,没有预定退出的仓不开": "Speculation is not gambling: define invalidation and exit before entry",
    "亏损中绝不下移止损扩大亏损": "Never widen a stop to increase risk on a losing position",
    "绝不无计划加仓摊平(扛单)": "Never average down without a pre-defined plan",
    "连续盈利后仓位不随浮盈膨胀、不超计划上限": "Do not let position size expand after a winning streak or exceed its planned limit",
    "持仓逻辑被证伪时不找支持性信息硬扛,按纪律减/平": "When the thesis is invalidated, reduce or exit instead of seeking confirmation bias",
    "复盘按过程打分不按结果:结果好但过程错的单也要标记、亏损单必复盘": "Score the process, not only the outcome; flag bad process even on winners and review every loss",
    "Binance 公告": "Binance announcements",
    "OKX 公告": "OKX announcements",
    "链上信号刷新": "On-chain signal refresh",
    "即时": "Now",
    "季度交割": "Quarterly settlement",
    "日程(系统)": "System calendar",
    "历史": "Historical record",
    "跟进中": "Monitoring",
    "已刷新": "Refreshed",
    "方向待观察": "Direction unclear",
    "偏空信号": "Bearish signal",
    "偏多信号": "Bullish signal",
    "季度交割前后波动与基差收敛,注意持仓与保证金": "Quarterly settlement can increase volatility and compress basis; review positions and margin.",
    "产品驾驶舱": "Product dashboard",
    "鉴权默认锁定": "Sign-in locked by default"
    ,"Owner 双因素认证": "Owner two-factor authentication"
    ,"密钥主密钥": "Secret master key"
    ,"SQLite 持久化": "SQLite persistence"
    ,"持久化 OMS 与 Outbox": "Persistent OMS and outbox"
    ,"客户物理隔离": "Tenant isolation"
    ,"真实交易写网关": "Live-trading write gateway"
    ,"执行前风控复查": "Pre-execution risk recheck"
    ,"真实交易配置": "Live-trading configuration"
    ,"私有 REST 持仓同步": "Private REST position sync"
    ,"OKX 私有 WebSocket": "OKX private WebSocket"
    ,"真实 LLM Agent": "Live LLM agent"
    ,"真实知识库解析": "Knowledge ingestion pipeline"
    ,"真实事件源": "Live event sources"
    ,"链上 API": "On-chain API"
    ,"Skill 沙箱": "Skill sandbox"
    ,"Docker 沙箱环境": "Docker sandbox runtime"
    ,"本地审计哈希链": "Local audit hash chain"
    ,"外部 WORM 审计": "External WORM audit storage"
    ,"提现权限确认": "Withdrawal permission check"
    ,"外部告警通道": "External alert channel"
    ,"最近一致性备份": "Recent consistent backup"
    ,"最近恢复演练": "Recent restore drill"
    ,"加密异机备份": "Encrypted off-host backup"
    ,"发布版本身份": "Release identity"
    ,"小额度灰度策略": "Small-size live validation"
    ,"交易所余额同步": "Exchange balance sync"
    ,"行情信号刷新": "Market signal refresh"
    ,"ME News 重要快讯快车道": "ME News breaking-news feed"
    ,"RSS 新闻源刷新": "RSS news refresh"
    ,"市场情报深层整合": "Market intelligence synthesis"
    ,"高影响日程分阶段准备": "High-impact event preparation"
    ,"链上基础资金面刷新": "On-chain fundamentals refresh"
    ,"Telegram观察哨Outbox": "Telegram watch outbox"
    ,"执行订单轮询": "Execution order polling"
    ,"持仓风险监控": "Position risk monitoring"
    ,"盈亏核算刷新": "PnL accounting refresh"
    ,"自主巡检决策": "Autonomous market review"
    ,"观察哨哨兵": "Watch-condition monitor"
    ,"全市场早期机会快扫": "Early-opportunity market scan"
    ,"账户对账": "Account reconciliation"
    ,"自适应策略研究": "Adaptive strategy research"
    ,"模拟盘前向验证": "Forward strategy validation"
    ,"平仓自动复盘": "Automatic closed-trade review"
    ,"错过机会复盘": "Missed-opportunity review"
    ,"策略改进闭环": "Strategy improvement loop"
    ,"TRC20 支付链上核验": "TRC20 payment verification"
    ,"交易事件 Outbox 派发": "Trade-event outbox delivery"
    ,"审计日志 WORM 外送": "WORM audit-log delivery"
    ,"不确定订单恢复": "Uncertain-order recovery"
    ,"趋势跟随（均线交叉）": "Trend following (moving-average crossover)"
    ,"均值回归（RSI 超卖反弹）": "Mean reversion (RSI oversold rebound)"
    ,"突破（唐奇安通道）": "Breakout (Donchian channel)"
    ,"MACD 金叉（趋势动量）": "MACD bullish crossover (trend momentum)"
    ,"布林带下轨反弹（均值回归）": "Lower Bollinger Band rebound (mean reversion)"
    ,"死叉做空（均线下穿）": "Bearish moving-average crossover"
    ,"RSI 超买回落（做空）": "RSI overbought reversal (short)"
    ,"唐奇安下破（做空）": "Donchian breakdown (short)"
    ,"Supertrend（ATR 趋势翻多）": "Supertrend bullish reversal (ATR)"
    ,"量价确认突破": "Volume-confirmed breakout"
    ,"布林挤压突破": "Bollinger squeeze breakout"
    ,"RSI 底背离（做多）": "RSI bullish divergence"
    ,"RSI 顶背离（做空）": "RSI bearish divergence"
    ,"多周期趋势对齐": "Multi-timeframe trend alignment"
    ,"资金费率极值扫描": "Extreme funding-rate scan"
    ,"市场状态分类": "Market regime classification"
    ,"支撑阻力位识别": "Support and resistance detection"
    ,"相对强度扫描": "Relative strength scan"
    ,"资金费率与基差": "Funding rate and basis"
    ,"流动性与冲击成本": "Liquidity and market impact"
    ,"合约风险画像": "Derivatives risk profile"
    ,"组合暴露分析": "Portfolio exposure analysis"
    ,"执行质量分析": "Execution quality analysis"
    ,"交易复盘与漂移检测": "Trade review and strategy drift detection"
    ,"交易所故障降级": "Exchange outage fallback"
    ,"无止损交易计划不得进入执行器。": "A trade plan without a stop loss cannot reach execution."
    ,"禁止提现权限": "Withdrawals must be disabled"
    ,"暂无已平仓交易——先建立交易闭环,行为画像会随成交累积。": "No closed trades yet. The behavior profile will build as completed trades accumulate."
    ,"Supertrend趋势做多(精选)": "Supertrend long (curated)"
    ,"RSI超买回落做空(精选)": "RSI overbought reversal short (curated)"
    ,"唐奇安20下破做空(精选)": "Donchian 20-period breakdown short (curated)"
    ,"唐奇安20突破做多(精选)": "Donchian 20-period breakout long (curated)"
    ,"布林挤压突破做多(精选)": "Bollinger squeeze breakout long (curated)"
    ,"小额度实盘灰度": "Small-size live validation"
    ,"调度员": "Scheduler"
    ,"后台运行任务": "Background task run"
    ,"实时 WebSocket 错误": "Real-time WebSocket error"
    ,"在 1h/4h/1d 三个周期判断趋势方向是否一致。多周期一致时趋势信号更可靠；不一致时应谨慎。内置 sync_market 只看单周期，这个技能补多周期确认。": "Checks whether the 1h, 4h, and 1d trends agree. Alignment strengthens a trend signal; disagreement calls for caution."
    ,"趋势确认后进入，禁止在区间极值追单": "Enter only after trend confirmation; do not chase at range extremes."
    ,"尚未产生合格样本外画像": "No qualifying out-of-sample profile yet."
    ,"低影响": "Low impact"
    ,"币圈事件": "Crypto",
    "链上事件": "On-chain",
    "衍生品": "Derivatives"
  };
  if (exact[raw]) return exact[raw];
  const quarterly = raw.match(/^(\d{4})年(3|6|9|12)月季度合约交割$/);
  if (quarterly) return `Q${Number(quarterly[2]) / 3} ${quarterly[1]} quarterly contract settlement`;
  if (/^后台运行任务/.test(raw)) return raw.replace(/^后台运行任务/, "Background task run");
  if (/^执行对账：/.test(raw)) return raw.replace(/^执行对账：/, "Reconciliation run: ");
  if (/^市场事件：/.test(raw)) return raw.replace(/^市场事件：/, "Market event: ");
  if (/^部分必要信息源陈旧或失败：/.test(raw)) return raw
    .replace(/^部分必要信息源陈旧或失败：/, "Some required sources are stale or failing: ")
    .replace(/；不得把旧内容当作当前催化剂。$/, "; do not treat stale content as a current catalyst.")
    .replace(/_/g, " ");
  if (/专题$/.test(raw)) return raw
    .replace(/稳定币/g, "Stablecoins")
    .replace(/安全事件/g, "Security")
    .replace(/\s*专题$/, " focus topic");
  if (/^批量历史验证完成/.test(raw)) return raw.replace(/^批量历史验证完成:通过\s*(\d+)\s*·\s*未达门槛\s*(\d+)\s*·\s*数据不足\/出错\s*(\d+)\(共\s*(\d+)\)$/, "Batch historical validation finished: $1 passed, $2 below threshold, $3 insufficient data/errors ($4 total)");
  return humanize(raw, raw);
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

// 交易运行状态的唯一展示模型。automationState 是后端按真实执行闸顺序派生的
// 权威结论；system 里的开关只用于兼容旧数据和极短暂的刷新间隙，不能在各页面
// 再各自拼出一套“看起来像状态”的标签。
export function automationPresentation(data = {}) {
  const automation = data.automationState || {};
  const system = data.system || {};
  const fallbackMode = system.killSwitch
    ? "halted"
    : system.reduceOnlyMode
      ? "reduce_only"
      : system.autonomyEnabled === false
        ? "paused"
        : system.liveTradingEnabled
          ? "semi_auto"
          : "observe";
  const mode = automation.mode || fallbackMode;
  const targetMode = automation.requestedMode
    || system.requestedOperatingMode
    || (mode === "full_auto_small" ? "full_auto" : mode === "semi_auto" ? "semi_auto" : "observe");
  const targetLabel = localizeText(automation.requestedLabel, ({
    full_auto: t("自动交易", "Automatic trading"),
    semi_auto: t("逐笔确认", "Approve each trade"),
    observe: t("只分析", "Analyze only")
  })[targetMode] || t("只分析", "Analyze only"));
  const definitions = {
    halted: {
      label: t("紧急停止中", "Emergency stop active"),
      tone: "danger",
      detail: t("所有新交易均已阻止，仅允许撤单、平仓等降风险动作。", "All new trades are blocked; only cancel, close, and other risk-reducing actions are allowed."),
      entryPolicy: t("禁止新开仓", "New entries blocked")
    },
    reduce_only: {
      label: t("暂停新开仓", "New entries paused"),
      tone: "warning",
      detail: t("系统仍会管理已有仓位，并允许撤单和平仓；原因解除后自动恢复已保存的运行模式。", "Existing positions remain managed, and cancel/close actions stay available. The saved operating mode resumes automatically after the cause clears."),
      entryPolicy: t("禁止新开仓", "New entries blocked")
    },
    paused: {
      label: t("运行已暂停", "Runtime paused"),
      tone: "warning",
      detail: t("AI 暂不自主分析或推进计划；重新选择运行模式即可恢复。", "The AI is not autonomously analyzing or advancing plans. Select an operating mode again to resume."),
      entryPolicy: t("AI 运行暂停", "AI runtime paused")
    },
    analysis_blocked: {
      label: t("分析暂不可用", "Analysis unavailable"),
      tone: "warning",
      detail: t("模型尚未配置或暂时不可用；恢复后继续分析，当前不会提交任何订单。", "The model is not configured or is temporarily unavailable. Analysis resumes after recovery, and no orders are submitted."),
      entryPolicy: t("只分析 · 不下单", "Analysis only · no orders")
    },
    blocked: {
      label: t("暂停新开仓", "New entries paused"),
      tone: "warning",
      detail: t("交易授权或运行条件尚未满足；分析可以继续，但不会新增真实仓位。", "Trading permissions or runtime conditions are incomplete. Analysis may continue, but no new live position will be opened."),
      entryPolicy: t("禁止新开仓", "New entries blocked")
    },
    live_blocked: {
      label: t("暂停新开仓", "New entries paused"),
      tone: "warning",
      detail: t("运行模式已经保存，但实盘安全条件尚未全部满足；分析和持仓管理仍会继续。", "The operating mode is saved, but live-trading safety conditions are incomplete. Analysis and position management continue."),
      entryPolicy: t("禁止实盘开仓", "Live entries blocked")
    },
    full_auto_small: {
      label: t("自动交易运行中", "Automated trading running"),
      tone: "ok",
      detail: t("仅在交易权限、账户事实和硬风控全部通过时自动下单。", "Orders are submitted automatically only after permissions, account facts, and hard-risk checks all pass."),
      entryPolicy: t("可按限制自动开仓", "Automatic entries within limits")
    },
    semi_auto: {
      label: t("逐笔确认", "Per-trade approval"),
      tone: "ok",
      detail: t("AI 可以生成计划，但每笔真实订单都需要你的确认。", "The AI can create plans, but every live order requires your approval."),
      entryPolicy: t("确认后可开仓", "Entries after approval")
    },
    observe: {
      label: t("只分析", "Analyze only"),
      tone: "neutral",
      detail: t("系统会分析并生成计划，但不会向交易所提交真实订单。", "The system analyzes and builds plans without submitting live orders to the exchange."),
      entryPolicy: t("不提交真实订单", "No live orders")
    }
  };
  const definition = definitions[mode] || {
    label: t("等待状态检查", "Awaiting status check"),
    tone: "neutral",
    detail: t("系统正在读取当前执行条件。", "The system is reading the current execution conditions."),
    entryPolicy: t("暂不执行新交易", "No new trades yet")
  };
  const blockerDetails = Array.isArray(automation.blockerDetails) && automation.blockerDetails.length
    ? automation.blockerDetails
    : (Array.isArray(automation.blockers) ? automation.blockers : []).map((label) => ({ code: null, label }));
  const firstBlocker = blockerDetails.map((item) => localizeText(item?.label || item)).find(Boolean);
  const runtimeStatus = automation.runtimeStatus || (
    mode === "halted" ? "emergency_stopped"
      : mode === "analysis_blocked" ? "analysis_unavailable"
      : ["reduce_only", "paused", "blocked", "live_blocked"].includes(mode) ? "opening_paused"
        : "normal"
  );
  const openingPaused = runtimeStatus === "opening_paused";
  const resumesAutomatically = automation.resumesAutomatically ?? (openingPaused && mode !== "paused");
  const recoveryLabel = runtimeStatus === "emergency_stopped"
    ? t("需要你解除紧急停止", "Clear the emergency stop to resume")
    : runtimeStatus === "analysis_unavailable"
      ? t("配置模型后恢复分析", "Configure the model to restore analysis")
    : openingPaused
      ? resumesAutomatically
        ? t("原因解除后自动恢复", "Resumes automatically after recovery")
        : t("重新选择运行模式即可恢复", "Select an operating mode again to resume")
      : t("无需处理", "No action needed");
  const authoritativeLabel = localizeText(automation.label, definition.label);
  const authoritativeDetail = localizeText(automation.detail, definition.detail);
  return {
    mode,
    targetMode,
    targetLabel,
    label: authoritativeLabel,
    shortLabel: definition.label,
    tone: definition.tone,
    detail: authoritativeDetail,
    entryPolicy: definition.entryPolicy,
    blockerDetails,
    blockers: blockerDetails.map((item) => localizeText(item?.label || item)).filter(Boolean),
    runtimeStatus,
    openingPaused,
    resumesAutomatically,
    recoveryLabel,
    primaryBlocker: firstBlocker || null,
    targetIsEffective: (targetMode === "full_auto" && mode === "full_auto_small")
      || (targetMode === "semi_auto" && mode === "semi_auto")
      || (targetMode === "observe" && mode === "observe")
  };
}

export function exchangeState(account = {}) {
  if (account.readEnabled && account.tradeEnabled) return { label: t("交易可用", "Trading enabled"), tone: "on" };
  if (account.readEnabled) return { label: t("只读", "Read-only"), tone: "warn" };
  return { label: t("未配置", "Not configured"), tone: "off" };
}

export function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

export function coreBootstrapTimeoutMs(native = isNativeApp()) {
  return native ? 30000 : 12000;
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

export function resolveApiBase({ native = isNativeApp(), stored = localStorage.getItem("agent_api_base") || "", configured = import.meta.env?.VITE_API_BASE_URL || "" } = {}) {
  // Web deployments must stay same-origin by default. A value saved months ago
  // for local development (localhost, an IP, or an old port) must never override
  // the HTTPS origin that served the current page; doing so made a healthy
  // production service look offline after the request timed out.
  if (!native) return normalizeApiBase(configured);
  const fallback = normalizeApiBase(configured || "https://yegidawir.xyz");
  const invalidStoredBase = !stored || /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):|:5173\b/.test(stored);
  return normalizeApiBase(invalidStoredBase ? fallback : stored);
}

function defaultApiBase() {
  return resolveApiBase();
}

function nativeApiFallback() {
  return normalizeApiBase(import.meta.env?.VITE_API_BASE_URL || "https://yegidawir.xyz");
}

function normalizeApiBase(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function apiUrl(path, baseOverride) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  const native = isNativeApp();
  const base = normalizeApiBase(baseOverride || resolveApiBase({ native }));
  if (!base) return value;
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timer = window.setTimeout(() => {
    const timeoutError = new Error("Request timed out");
    timeoutError.name = "TimeoutError";
    controller.abort(timeoutError);
  }, timeoutMs);
  try {
    return await fetch(url, { credentials: "include", ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

function connectionErrorMessage(error) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || /aborted|timed out/i.test(String(error?.message || ""))) return "连接超时，请确认后端地址可访问，推荐使用 https://yegidawir.xyz";
  return error?.message || "连接失败";
}

// 历史研究会分页读取多个周期的 OKX K 线，不能套用普通 CRUD 的 12 秒上限。
// 仍保留有限超时，避免断网或上游永久挂起使界面一直忙碌。
export function actionTimeoutMs(url) {
  const path = String(url || "");
  if (/^\/api\/strategy\/research(?:\?|$)/.test(path)) return 180000;
  if (/^\/api\/strategy\/studio\/drafts\/[^/]+\/backtest(?:\?|$)/.test(path)) return 120000;
  if (/^\/api\/(?:paper\/run|knowledge\/skills\/[^/]+\/(?:validate|paper))(?:\?|$)/.test(path)) return 120000;
  return isNativeApp() ? 8000 : 12000;
}

// 实时价 pub/sub：SSE 每个价格 tick 直接分发给订阅者（如 K 线图），不经 React 状态节流，
// 让图表能跟上 OKX 的逐 tick 更新；React 状态仍轻度节流避免整页高频重渲染。
const livePriceListeners = new Set();
function onLivePrice(fn) { livePriceListeners.add(fn); return () => livePriceListeners.delete(fn); }

// 大户持仓多空比 → 全端统一的偏向判定（阈值一处定义：≥1.05 偏多 / ≤0.95 偏空 / 之间平衡）。
// 注意语义：这是"持仓结构偏向"，不是趋势预测——展示词统一用"偏多/偏空"，不用"趋势"。
// 鉴权头（全站唯一实现；chat/assistant 曾各有一份副本）。
export function authHeaders(extra = {}) {
  const token = isNativeApp() ? (localStorage.getItem("agent_token") || "") : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}`, "X-Native-App": "true" } : {}) };
}

// 在途执行单状态（与后端 executionEngine OPEN_EXECUTION_STATES 对齐；曾有 3 份复制、1 份写错）。
export const OPEN_EXECUTION_STATES = ["created", "submitted", "entry_unknown_pending", "entry_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending", "entry_filled", "protecting", "protecting_degraded", "close_pending", "close_unknown_pending", "close_reconciliation_pending", "group_close_pending", "recovery_pending_reconciliation", "emergency_close_pending"];
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
  const [token, setToken] = useState(() => isNativeApp() ? (localStorage.getItem("agent_token") || "") : "");
  const [apiBase, setApiBaseState] = useState(defaultApiBase);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  // A browser cannot inspect the HttpOnly session cookie before the first core request returns.
  // Keep the public entry visible during that unresolved interval instead of presenting an
  // authenticated-workspace loader to signed-out visitors. Native keeps its existing token-led
  // startup because its session identity is available synchronously from local storage.
  const [authRequired, setAuthRequired] = useState(() => initialAuthRequired({ native: isNativeApp(), token }));
  const [connectionError, setConnectionError] = useState("");
  const [busyCount, setBusyCount] = useState(0);
  const [publicInfo, setPublicInfo] = useState({ registrationEnabled: false, trc20Configured: false, subscriptionPlans: [] });
  // 轮询闭包里读不到最新 data,用 ref 记录"是否已有数据"来区分首连失败与掉线重连。
  const hasDataRef = useRef(false);
  const overviewInFlightRef = useRef(false);
  const sectionInFlightRef = useRef(new Map());
  const loadedSectionsRef = useRef(new Set());
  const activeSectionRef = useRef("chat");
  const lastCoreSyncRef = useRef(0);
  const lastSectionSyncRef = useRef(0);
  const snapshotStoreRef = useRef(createSnapshotStore());
  const requestGenerationRef = useRef(1);
  const requestControllersRef = useRef(new Set());
  const tokenRef = useRef(token);
  const apiBaseRef = useRef(apiBase);

  function canSynchronizeAuthenticatedData() {
    return shouldSynchronizeAuthenticatedData({ native: isNativeApp(), token: tokenRef.current });
  }

  const supplementalSectionsFor = (section) => ({
    chat: ["operationsCenter"],
    systemSettings: ["riskCenter", "operationsCenter"]
  }[section] || []);

  function publishSnapshot(section = activeSectionRef.current) {
    setData(projectSnapshotStore(snapshotStoreRef.current, section, supplementalSectionsFor(section)));
  }

  function resetSnapshotIdentity({ clearData = true } = {}) {
    requestGenerationRef.current += 1;
    for (const controller of requestControllersRef.current) {
      const error = new Error("Request identity changed");
      error.name = "AbortError";
      controller.abort(error);
    }
    requestControllersRef.current.clear();
    clearSnapshotStore(snapshotStoreRef.current);
    loadedSectionsRef.current.clear();
    sectionInFlightRef.current.clear();
    overviewInFlightRef.current = false;
    hasDataRef.current = false;
    if (clearData) setData(null);
  }

  function requestContext(base = apiBaseRef.current) {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    return {
      controller,
      generation: requestGenerationRef.current,
      apiBase: normalizeApiBase(base),
      token: tokenRef.current,
      minimumRevision: 0
    };
  }

  function isCurrentRequest(context) {
    return context.generation === requestGenerationRef.current
      && context.apiBase === normalizeApiBase(apiBaseRef.current)
      && context.token === tokenRef.current
      && !context.controller.signal.aborted;
  }

  function finishRequest(context) {
    requestControllersRef.current.delete(context.controller);
  }

  function setApiBase(value) {
    // The browser build is served by the API host itself and therefore always
    // reconnects through same-origin /api. Custom hosts are a native-app-only
    // setting; ignore and remove stale browser overrides.
    if (!isNativeApp()) {
      localStorage.removeItem("agent_api_base");
      const configured = normalizeApiBase(import.meta.env?.VITE_API_BASE_URL || "");
      if (configured !== apiBaseRef.current) resetSnapshotIdentity();
      apiBaseRef.current = configured;
      setApiBaseState(configured);
      setConnectionError("");
      return configured;
    }
    const normalized = normalizeApiBase(value);
    const security = connectionSecurityStatus(normalized, {
      production: import.meta.env?.PROD,
      allowLocalDevelopment: import.meta.env?.DEV || import.meta.env?.VITE_ALLOW_INSECURE_LOCAL_BACKEND === "true"
    });
    if (normalized && !security.allowed) {
      setConnectionError(t("生产连接必须使用 HTTPS，当前地址已被拒绝。", "Production backends must use HTTPS. This address was rejected."));
      return apiBaseRef.current;
    }
    if (normalized) localStorage.setItem("agent_api_base", normalized);
    else localStorage.removeItem("agent_api_base");
    if (normalized !== apiBaseRef.current) resetSnapshotIdentity();
    apiBaseRef.current = normalized;
    setApiBaseState(normalized);
    setConnectionError("");
    return normalized;
  }

  function headers(extra = {}) {
    const currentToken = tokenRef.current;
    return { ...extra, ...(currentToken ? { Authorization: `Bearer ${currentToken}`, "X-Native-App": "true" } : {}) };
  }

  function notify(message, timeout = 2400) {
    setToast(message);
    window.setTimeout(() => setToast(""), timeout);
  }

  function expireSession(message = t("登录已过期，请重新登录", "Session expired — please sign in again")) {
    localStorage.removeItem("agent_token");
    tokenRef.current = "";
    setToken("");
    resetSnapshotIdentity();
    setAuthRequired(true);
    setConnectionError("");
    notify(message, 4200);
  }

  // 已有数据时同步失败只静默标记(顶部显示"重连中"),避免 App 弱网下重复弹错。
  function reportConnectionFailure(message) {
    setConnectionError(message);
    if (hasDataRef.current) return;
    setToast(`${t("连接后端失败", "Backend connection failed")}：${message}`);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function readCore(context) {
    const response = await fetchWithTimeout(apiUrl("/api/bootstrap/core", context.apiBase), {
      cache: "no-store",
      headers: { ...(context.token ? { Authorization: `Bearer ${context.token}`, "X-Native-App": "true" } : {}) },
      signal: context.controller.signal
    }, coreBootstrapTimeoutMs());
    if (response.status === 401 && isCurrentRequest(context)) {
      expireSession();
      return null;
    }
    if (!response.ok) throw new Error(`API ${response.status}`);
    return parseJsonResponse(response);
  }

  async function ensureSection(section = "chat", options = {}) {
    const selected = String(section || "chat");
    const background = options.background === true;
    if (!background) activeSectionRef.current = selected;
    publishSnapshot(activeSectionRef.current);
    if (!options.force && loadedSectionsRef.current.has(selected)) {
      if (background) publishSnapshot(activeSectionRef.current);
      return snapshotStoreRef.current.sections.get(selected) || null;
    }
    if (sectionInFlightRef.current.has(selected)) return sectionInFlightRef.current.get(selected);
    const context = requestContext();
    const request = (async () => {
      if (!snapshotStoreRef.current.sections.has(selected)) {
        markSnapshotResource(snapshotStoreRef.current, selected, "loading");
        publishSnapshot(activeSectionRef.current);
      }
      try {
        const response = await fetchWithTimeout(apiUrl(`/api/overview?view=section&section=${encodeURIComponent(selected)}`, context.apiBase), {
          cache: "no-store",
          headers: { ...(context.token ? { Authorization: `Bearer ${context.token}`, "X-Native-App": "true" } : {}) },
          signal: context.controller.signal
        }, isNativeApp() ? 30000 : 20000);
        if (!isCurrentRequest(context)) return null;
        if (response.status === 401) {
          expireSession();
          return null;
        }
        if (!response.ok) throw new Error(`API ${response.status}`);
        const json = await parseJsonResponse(response);
        if (!isCurrentRequest(context)) return null;
        if (!acceptSectionSnapshot(snapshotStoreRef.current, selected, json, context.minimumRevision)) {
          markSnapshotResource(snapshotStoreRef.current, selected, "not_loaded");
          publishSnapshot(selected);
          if (shouldRetryStaleSnapshot(options)) {
            window.setTimeout(() => {
              if (isCurrentRequest(context) && activeSectionRef.current === selected) ensureSection(selected, { force: true, staleRetry: true });
            }, 250);
          }
          return null;
        }
        lastSectionSyncRef.current = Date.now();
        loadedSectionsRef.current.add(selected);
        if (background || activeSectionRef.current === selected) publishSnapshot(activeSectionRef.current);
        setConnectionError("");
        return json;
      } catch (error) {
        if (!isCurrentRequest(context) || error?.name === "AbortError") return null;
        if (!snapshotStoreRef.current.sections.has(selected)) markSnapshotResource(snapshotStoreRef.current, selected, "error");
        if (background || activeSectionRef.current === selected) publishSnapshot(activeSectionRef.current);
        reportConnectionFailure(connectionErrorMessage(error));
        return null;
      } finally {
        finishRequest(context);
        if (sectionInFlightRef.current.get(selected) === request) sectionInFlightRef.current.delete(selected);
      }
    })();
    sectionInFlightRef.current.set(selected, request);
    return request;
  }

  async function refresh(showLoading = true, baseOverride, options = {}) {
    // The lightweight core is shared by web and native. Never stack background refreshes: the
    // previous snapshot remains interactive while a reconnect is in progress.
    if (overviewInFlightRef.current && !showLoading) return null;
    const activeBase = normalizeApiBase(baseOverride || apiBaseRef.current);
    const context = requestContext(activeBase);
    const firstLoad = !hasDataRef.current;
    try {
      overviewInFlightRef.current = context;
      if (isNativeApp() && !activeBase) {
        setConnectionError(t("请先填写 KORDYN 后端地址。", "Please enter the KORDYN backend URL first."));
        setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
      if (firstLoad && typeof performance !== "undefined") performance.mark("kordyn:bootstrap:start");
      const json = await readCore(context);
      if (!json) return;
      if (!isCurrentRequest(context)) return null;
      if (!acceptCoreSnapshot(snapshotStoreRef.current, json, context.minimumRevision)) {
        if (shouldRetryStaleSnapshot(options)) {
          window.setTimeout(() => { if (isCurrentRequest(context)) refresh(false, context.apiBase, { staleRetry: true }); }, 250);
        }
        return null;
      }
      lastCoreSyncRef.current = Date.now();
      publishSnapshot();
      hasDataRef.current = true;
      setAuthRequired(false);
      setConnectionError("");
      if (firstLoad && typeof performance !== "undefined") {
        performance.mark("kordyn:bootstrap:end");
        performance.measure("kordyn:bootstrap", "kordyn:bootstrap:start", "kordyn:bootstrap:end");
      }
    } catch (error) {
      const current = isCurrentRequest(context);
      if (!current || error?.name === "AbortError") return null;
      const fallback = nativeApiFallback();
      if (shouldAttemptNativeFallback({ current, error, native: isNativeApp(), activeBase, fallbackBase: fallback })) {
        const fallbackBase = setApiBase(fallback);
        setToast(t("正在切换到默认后端", "Switching to the default backend"));
        window.setTimeout(() => refresh(showLoading, fallbackBase), 0);
        return null;
      }
      reportConnectionFailure(connectionErrorMessage(error));
    } finally {
      finishRequest(context);
      if (overviewInFlightRef.current === context) overviewInFlightRef.current = false;
      if (showLoading && isCurrentRequest(context)) setLoading(false);
    }
  }

  async function action(url, body = {}, method = "POST") {
    const context = requestContext();
    setBusyCount((count) => count + 1);
    try {
      setToast(method.toUpperCase() === "GET" ? t("正在同步数据...", "Syncing data…") : t("操作处理中...", "Processing…"));
      const request = {
        method,
        headers: headers({ "Content-Type": "application/json" })
      };
      if (method.toUpperCase() !== "GET") request.body = JSON.stringify(body);
      request.signal = context.controller.signal;
      const response = await fetchWithTimeout(apiUrl(url, context.apiBase), request, actionTimeoutMs(url));
      if (!isCurrentRequest(context)) return { ok: false, error: "request_identity_changed" };
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
      if (!isCurrentRequest(context)) return { ok: false, error: "request_identity_changed" };
      const json = text ? parseJsonResponseText(text) : createJsonProjectionRecord();
      if (!response.ok) {
        const approvalFailure = boundedApprovalFailure(url, json, response.status);
        if (approvalFailure) {
          setToast(approvalFailure.message || approvalFailure.error || t("操作失败", "Action failed"));
          window.setTimeout(() => setToast(""), 4200);
          return approvalFailure;
        }
        const requestError = new Error(json.error || `${t("请求失败", "Request failed")} ${response.status}`);
        requestError.status = response.status;
        requestError.details = json.details;
        requestError.blockers = json.blockers;
        throw requestError;
      }
      if (json.sessionRotated === true && json.token && isNativeApp()) {
        localStorage.setItem("agent_token", json.token);
        resetSnapshotIdentity();
        tokenRef.current = json.token;
        setToken(json.token);
      }
      if (json.logoutRequired) {
        expireSession(json.message || t("请重新登录", "Please sign in again"));
        return json;
      }
      const localizedMessage = (json.messageZh || json.messageEn)
        ? t(json.messageZh || json.message || "", json.messageEn || json.message || "")
        : (json.message || json.summary || json.output || json.error || t("操作已完成", "Done"));
      setToast(localizedMessage);
      await refresh(false);
      await ensureSection(activeSectionRef.current, { force: true });
      window.setTimeout(() => setToast(""), 4200);
      return json;
    } catch (error) {
      if (!isCurrentRequest(context) || error?.name === "AbortError") return { ok: false, error: "request_cancelled" };
      const errorMessage = (error?.name === "AbortError" || error?.name === "TimeoutError" || /aborted|timed out/i.test(String(error?.message || "")))
        ? t("操作超时；研究任务可能仍在后台运行，请稍后刷新查看结果", "The operation timed out. Research may still be running; refresh shortly to check results.")
        : (error.message || t("操作失败", "Action failed"));
      setToast(errorMessage);
      window.setTimeout(() => setToast(""), 4200);
      // 调用方需要区分“空成功响应”和“真实失败”。此前统一返回 {}，资金与交易控制页
      // 只能再覆盖成笼统的“保存失败”，把后端给出的安全阻断原因全部吃掉。
      return { ok: false, error: errorMessage, httpStatus: error.status, details: error.details, blockers: error.blockers };
    } finally {
      finishRequest(context);
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
      return { ok: false, mfaRequired: json.mfaRequired === true, mfaRetry: json.mfaRetry || null, error: json.error || "login_failed" };
    }
    const native = isNativeApp();
    if (native) {
      localStorage.setItem("agent_token", json.token);
      resetSnapshotIdentity();
      tokenRef.current = json.token;
      setToken(json.token);
    } else {
      localStorage.removeItem("agent_token");
      resetSnapshotIdentity();
      tokenRef.current = "";
      setToken("");
    }
    setAuthRequired(false);
    // Web authentication is cookie-backed, so the token dependency does not change after
    // sign-in. Explicitly resume the authenticated bootstrap instead of leaving the startup
    // screen pending until a manual page reload. Native authentication changes the bearer
    // token and is refreshed by the token-dependent effect, avoiding a duplicate request.
    if (!native) await refresh(true, apiBaseRef.current);
    setToast(t("登录成功", "Signed in"));
    window.setTimeout(() => setToast(""), 1800);
    return { ok: true };
  }

  async function registerAccount(payload) {
    try {
      setToast(t("正在提交开通申请...", "Submitting your application…"));
      const response = await fetchWithTimeout(apiUrl("/api/public/registration/apply", apiBase), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      }, isNativeApp() ? 8000 : 12000);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || t("注册失败", "Registration failed"));
      // 公开入口只提交物理隔离实例的开通申请，不创建本实例会话，避免访客进入 Owner 工作区。
      setToast(t("申请已收到，请查收验证邮件或等待人工审核", "Application received — verify your email or wait for manual review"));
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
    if (canSynchronizeAuthenticatedData()) refresh();
    // SSE is the primary invalidation channel. This five-minute timer is only a recovery net for
    // proxies/WebViews that silently buffer EventSource; it no longer downloads the monolithic
    // overview every 15 seconds.
    const fallback = setInterval(() => {
      if (!canSynchronizeAuthenticatedData()) return;
      refresh(false);
      ensureSection(activeSectionRef.current, { force: true });
    }, 300000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!canSynchronizeAuthenticatedData()) return;
      if (Date.now() - lastCoreSyncRef.current > 60000) refresh(false);
      if (Date.now() - lastSectionSyncRef.current > 180000) ensureSection(activeSectionRef.current, { force: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [token, apiBase]);

  // 真·实时行情：SSE 逐笔推送，合并进 data.markets/activeMarket（节流 1s，避免过度重渲染）。
  // 已登录时先领 stream ticket（EventSource 带不了 Authorization 头），鉴权连接才会收到
  // portfolio 实时浮盈亏推送；领票失败退回匿名流（只有公开行情）。
  useEffect(() => {
    let source;
    let pending = {};
    let timer = null;
    let reconnectTimer = null;
    let invalidationTimer = null;
    let disposed = false;
    const scheduleInvalidationSync = (forceSection = false, immediate = false) => {
      if (!canSynchronizeAuthenticatedData()) return;
      if (invalidationTimer) clearTimeout(invalidationTimer);
      const coreDelay = immediate ? 0 : Math.max(1000, 15000 - (Date.now() - lastCoreSyncRef.current));
      invalidationTimer = setTimeout(() => {
        invalidationTimer = null;
        if (!canSynchronizeAuthenticatedData()) return;
        refresh(false);
        if (forceSection || Date.now() - lastSectionSyncRef.current > 60000) {
          ensureSection(activeSectionRef.current, { force: true });
        }
      }, coreDelay);
    };
    const openStream = (url) => {
      if (disposed) return;
      try { source = new EventSource(url); } catch { source = null; return; }
      wireStream();
    };
    const connect = async () => {
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
    };
    connect();
    const responseField = (record, field) => {
      if (!hasJsonResponseProvenance(record) || Array.isArray(record)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(record, field);
      return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    };
    const patch = (market, ups) => {
      const symbol = responseField(market, "symbol");
      if (!symbol) return null;
      const u = ups[symbol];
      if (!u) return market;
      const next = projectJsonResponseRecord(market);
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
      const core = snapshotStoreRef.current.core;
      if (core) {
        const markets = createJsonProjectionArray();
        for (const market of jsonResponseArrayValues(responseField(core, "markets")) || []) {
          const nextMarket = patch(market, ups);
          if (nextMarket) markets.push(nextMarket);
        }
        const currentActiveMarket = responseField(core, "activeMarket");
        const activeMarketSymbol = responseField(currentActiveMarket, "symbol");
        const activeMarket = activeMarketSymbol && ups[activeMarketSymbol]
          ? patch(currentActiveMarket, ups)
          : currentActiveMarket;
        const next = projectJsonResponseRecord(core);
        next.markets = markets;
        next.activeMarket = activeMarket;
        if (pf) {
          // 实时组合浮盈亏 + 逐仓 PnL 合并（不等 15s 轮询）。
          const portfolioPatch = responseField(pf, "portfolio");
          if (hasJsonResponseProvenance(portfolioPatch)) {
            next.portfolio = projectJsonResponseRecord(responseField(core, "portfolio"), portfolioPatch);
          }
          const positionPatches = jsonResponseArrayValues(responseField(pf, "positions")) || [];
          const currentPositions = jsonResponseArrayValues(responseField(core, "positions")) || [];
          if (positionPatches.length && currentPositions.length) {
            const byId = new Map();
            for (const position of positionPatches) {
              const id = responseField(position, "id");
              if (id != null) byId.set(id, position);
            }
            next.positions = createJsonProjectionArray();
            for (const position of currentPositions) {
              const update = byId.get(responseField(position, "id"));
              next.positions.push(update ? projectJsonResponseRecord(position, update) : position);
            }
          }
        }
        snapshotStoreRef.current.core = next;
        publishSnapshot();
      }
    };
    function wireStream() {
      if (!source) return;
      source.onmessage = (event) => {
        try {
          const u = parseJsonResponseText(event.data);
          if (u?.type === "core_invalidated") {
            if (!observeSnapshotInvalidation(snapshotStoreRef.current, u)) return;
            scheduleInvalidationSync(false);
            return;
          }
          if (u?.type === "knowledge_updated") {
            if (!observeSnapshotInvalidation(snapshotStoreRef.current, u)) return;
            scheduleInvalidationSync(activeSectionRef.current === "researchCenter");
            return;
          }
          if (u && u.type === "portfolio") { pendingPortfolio = u; if (!timer) timer = setTimeout(flush, 300); return; }
          if (!u || !u.symbol) return;
          // 逐 tick 直推图表（不节流），让 K 线跟上 OKX 每秒多次的变化。
          if (u.price !== undefined) emitLivePrice(u.symbol, u.price);
          pending[u.symbol] = projectJsonResponseRecord(pending[u.symbol], u);
          // React 状态（标题/快照）轻度节流到 250ms（约 4 次/秒），避免整页高频重渲染。
          if (!timer) timer = setTimeout(flush, 250);
        } catch { /* 忽略解析失败 */ }
      };
      source.onerror = () => {
        if (disposed) return;
        try { source.close(); } catch { /* noop */ }
        source = null;
        if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1500);
      };
    }
    return () => { disposed = true; if (source) source.close(); if (timer) clearTimeout(timer); if (reconnectTimer) clearTimeout(reconnectTimer); if (invalidationTimer) clearTimeout(invalidationTimer); };
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
            const markets = await parseJsonResponse(res);
            if (Array.isArray(markets)) {
              for (const m of markets) if (m && m.symbol && m.price != null) emitLivePrice(m.symbol, m.price);
              const byId = Object.fromEntries(markets.map((m) => [m.symbol, m]));
              const merge = (mk) => {
                if (!hasJsonResponseProvenance(mk) || Array.isArray(mk)) return null;
                const symbolDescriptor = Object.getOwnPropertyDescriptor(mk, "symbol");
                const symbol = symbolDescriptor && Object.hasOwn(symbolDescriptor, "value") ? symbolDescriptor.value : null;
                const u = symbol ? byId[symbol] : null;
                if (!u) return mk;
                const merged = projectJsonResponseRecord(mk);
                merged.price = u.price;
                merged.changePct = u.changePct;
                merged.high24h = u.high24h;
                merged.low24h = u.low24h;
                merged.fundingRate = u.fundingRate ?? merged.fundingRate;
                merged.openInterest = u.openInterest ?? merged.openInterest;
                merged.volume24h = u.volume24h ?? merged.volume24h;
                merged.lastRealtimeAt = new Date().toISOString();
                return merged;
              };
              const core = snapshotStoreRef.current.core;
              if (core) {
                const next = projectJsonResponseRecord(core);
                const currentMarkets = jsonResponseArrayValues(core.markets) || [];
                next.markets = createJsonProjectionArray();
                for (const market of currentMarkets) {
                  const merged = merge(market);
                  if (merged) next.markets.push(merged);
                }
                next.activeMarket = core.activeMarket ? merge(core.activeMarket) : core.activeMarket;
                snapshotStoreRef.current.core = next;
                publishSnapshot();
              }
            }
          }
        } catch { /* 网络抖动，下次再拉 */ }
      }
      if (!stop) t = setTimeout(poll, okxLive ? 4000 : 500);
    };
    t = setTimeout(poll, 800);
    return () => { stop = true; if (t) clearTimeout(t); };
  }, [token, apiBase]);

  return { data, loading, action, toast, authRequired, login, registerAccount, notify, download, refresh, ensureSection, apiBase, setApiBase, connectionError, busy: busyCount > 0, isNativeApp: isNativeApp(), publicInfo };
}

// 提示解读卡已按需求全站移除；保留空组件以兼容现有调用点。
export function InsightNote() {
  return null;
}

const KLINE_TF = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d", "1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", D: "1d" };
const KLINE_SECONDS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const OKX_BAR = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };
const loadTradingChartLibrary = () => import("lightweight-charts");
// K 线图：lightweight-charts + 【直连 OKX 公有 WebSocket 的 candle 频道】。
// 图表价格不再经我们后端中转（少一跳、少延迟），而是客户端直接订阅 OKX candle{bar}，
// 拿到的就是 OKX 正在形成的这根蜡烛的实时 OHLC——与 OKX 自家图表同源同速。
// 若客户端直连 OKX 被网络限制，退回后端 SSE 实时价（onLivePrice）驱动。导出名保持 TradingViewChart。
export function TradingViewChart({ symbol = "BTC/USDT", interval = "60", livePrice = null, showVolume = false, chartLibraryLoader = loadTradingChartLibrary }) {
  const holder = useRef(null);
  const seriesRef = useRef(null);
  const lastBarRef = useRef(null);
  const lastOkxRef = useRef(0);
  const failChartRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [volumeStatus, setVolumeStatus] = useState(showVolume ? "loading" : "disabled");
  const tf = KLINE_TF[interval] || "1h";
  const barSeconds = KLINE_SECONDS[tf] || 3600;

  useEffect(() => {
    let disposed = false;
    let chart = null;
    let ws = null;
    let pingTimer = null;
    let reconnectTimer = null;
    let refetchTimer = null;
    let failed = false;
    setStatus("loading");
    setVolumeStatus(showVolume ? "loading" : "disabled");
    seriesRef.current = null;
    lastBarRef.current = null;
    const okxBar = OKX_BAR[tf] || "1H";
    const instId = `${String(symbol).replace("/", "-").toUpperCase()}-SWAP`;

    const teardownChart = () => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (refetchTimer) clearInterval(refetchTimer);
      refetchTimer = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try { ws.close(); } catch { /* noop */ }
      }
      ws = null;
      if (chart) { try { chart.remove(); } catch { /* noop */ } }
      chart = null;
      seriesRef.current = null;
      lastBarRef.current = null;
      if (holder.current) { try { holder.current.replaceChildren(); } catch { /* noop */ } }
    };
    const failChart = () => {
      if (disposed || failed) return;
      failed = true;
      teardownChart();
      setStatus("error");
      setVolumeStatus(showVolume ? "error" : "disabled");
    };
    failChartRef.current = failChart;

    const fetchRows = async () => {
      try {
        const res = await fetch(apiUrl(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=200`));
        if (!res.ok) throw new Error(`K-line API ${res.status}`);
        const json = await res.json();
        const candles = Array.isArray(json.candles) ? json.candles : [];
        const rows = candles
          .map((c) => ({ time: Math.floor(Number(c.time) / 1000), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: c.volume == null || c.volume === "" || (typeof c.volume === "string" && c.volume.trim() === "") ? null : Number(c.volume) }))
          .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
          .sort((a, b) => a.time - b.time);
        return { rows, error: null };
      } catch (error) { return { rows: [], error }; }
    };
    const applyOkxCandle = (arr) => {
      const series = seriesRef.current;
      if (!series || !arr) return;
      const time = Math.floor(Number(arr[0]) / 1000);
      const bar = { time, open: Number(arr[1]), high: Number(arr[2]), low: Number(arr[3]), close: Number(arr[4]) };
      if (!Number.isFinite(time) || !Number.isFinite(bar.close)) return;
      const last = lastBarRef.current;
      if (last && time < last.time) return; // 防回退
      try {
        series.update(bar);
        lastBarRef.current = bar;
        lastOkxRef.current = Date.now();
      } catch { failChart(); }
    };
    // tickers 频道 ~100ms 推一次最新价（OKX 自家价格显示同源），驱动当前蜡烛收/高/低逐 tick 动。
    const applyTickerPrice = (lastPx) => {
      const series = seriesRef.current;
      const bar = lastBarRef.current;
      const p = Number(lastPx);
      if (!series || !bar || !Number.isFinite(p) || p <= 0) return;
      const next = { time: bar.time, open: bar.open, high: Math.max(bar.high, p), low: Math.min(bar.low, p), close: p };
      try {
        series.update(next);
        lastBarRef.current = next;
        lastOkxRef.current = Date.now();
      } catch { failChart(); }
    };
    const scheduleReconnect = () => {
      if (reconnectTimer || disposed || failed) return;
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connectOkx(); }, 3000);
    };
    function connectOkx() {
      if (disposed || failed) return;
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
      const initial = await fetchRows();
      const rows = initial.rows;
      if (disposed || !holder.current) return;
      if (initial.error) { setStatus("error"); setVolumeStatus(showVolume ? "error" : "disabled"); return; }
      if (!rows.length) { setStatus("empty"); setVolumeStatus(showVolume ? "empty" : "disabled"); return; }
      try {
        const canvasContext = document.createElement("canvas").getContext("2d");
        if (!canvasContext) throw new Error("Canvas 2D context unavailable");
        const lc = await chartLibraryLoader();
        if (disposed || !holder.current) return;
        holder.current.innerHTML = "";
        chart = lc.createChart(holder.current, {
          autoSize: true,
          layout: { background: { color: "#FBF9F5" }, textColor: "#8a8172", fontFamily: "SFMono-Regular, Roboto Mono, Space Mono, ui-monospace, monospace" },
          grid: { vertLines: { color: "#EDE7DB" }, horzLines: { color: "#EDE7DB" } },
          rightPriceScale: { borderColor: "#E3DCCE" },
          timeScale: { borderColor: "#E3DCCE", timeVisible: true },
          crosshair: { mode: 0 }
        });
        const series = chart.addSeries(lc.CandlestickSeries, {
          upColor: "#1F7A50", downColor: "#C43F28", borderUpColor: "#1F7A50", borderDownColor: "#C43F28", wickUpColor: "#1F7A50", wickDownColor: "#C43F28"
        });
        const candleRows = rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
        series.setData(candleRows);
        let volumeSeries = null;
        if (showVolume) {
          const volumeRows = rows.filter((row) => Number.isFinite(row.volume)).map((row) => ({
            time: row.time,
            value: row.volume,
            color: row.close >= row.open ? "rgba(31, 122, 80, .26)" : "rgba(196, 63, 40, .24)"
          }));
          if (volumeRows.length) {
            volumeSeries = chart.addSeries(lc.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" });
            chart.priceScale("volume").applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
            volumeSeries.setData(volumeRows);
            setVolumeStatus("ready");
          } else setVolumeStatus("empty");
        }
        chart.timeScale().fitContent();
        seriesRef.current = series;
        lastBarRef.current = candleRows[candleRows.length - 1];
        setStatus("ok");
        connectOkx(); // 直连 OKX 实时 candle（App 端也试；连不上时由 onLivePrice 兜底驱动）
        // 兜底：每 30s 拉一次真实 K 线纠正历史（直连挂了也不至于冻结）。
        const refetch = async () => {
          try {
            const result = await fetchRows();
            const fresh = result.rows;
            if (disposed || failed || !seriesRef.current) return;
            if (result.error) throw result.error;
            if (!fresh.length) return;
            const freshCandles = fresh.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
            const live = lastBarRef.current;
            if (live && freshCandles[freshCandles.length - 1].time <= live.time) {
              seriesRef.current.setData(freshCandles.filter((b) => b.time < live.time).concat([live]));
            } else {
              seriesRef.current.setData(freshCandles);
              lastBarRef.current = freshCandles[freshCandles.length - 1];
            }
            if (volumeSeries) {
              const freshVolume = fresh.filter((row) => Number.isFinite(row.volume)).map((row) => ({ time: row.time, value: row.volume, color: row.close >= row.open ? "rgba(31, 122, 80, .26)" : "rgba(196, 63, 40, .24)" }));
              if (freshVolume.length) volumeSeries.setData(freshVolume);
            }
          } catch { failChart(); }
        };
        refetchTimer = setInterval(() => { void refetch(); }, 30000);
      } catch { failChart(); }
    })();
    return () => {
      disposed = true;
      if (failChartRef.current === failChart) failChartRef.current = null;
      teardownChart();
    };
  }, [symbol, interval, showVolume, chartLibraryLoader]);

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
      try { series.update(bar); lastBarRef.current = bar; }
      catch { failChartRef.current?.(); }
    };
    if (livePrice != null) applyPrice(symbol, livePrice);
    return onLivePrice(applyPrice);
  }, [symbol, barSeconds]);

  return (
    <div className="tvChart" data-chart-status={status} data-volume-series={volumeStatus} style={{ position: "relative" }}>
      <div ref={holder} style={{ width: "100%", height: "100%" }} />
      {status !== "ok" && <div className="chartEmpty tvOverlay" role={status === "error" ? "alert" : "status"}>{status === "empty" ? t("当前周期没有 K 线历史", "No candle history is available for this interval") : status === "error" ? t("K 线历史加载失败", "Candlestick history failed to load") : t("加载 K 线…", "Loading candlesticks…")}</div>}
    </div>
  );
}

// 轻量自绘 K 线（纯 SVG，不加载 lightweight-charts）：给 App 端用——拉真实 OKX 历史 K 线，
// 最后一根蜡烛吃直连 OKX / SSE / 轮询的实时价逐 tick 动。比嵌 lightweight-charts 轻、启动快。
export function StatusBadge({ children, tone = "ok" }) {
  return <span className={`statusBadge ${tone}`}>{children}</span>;
}

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
      {progress !== undefined && <div className="progressBar green"><span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>}
    </div>
  );
}
