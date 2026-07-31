import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Menu,
  PieChart,
  ShieldCheck,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Gauge,
  Globe2,
  Inbox,
  Info,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  UserCog,
  WalletCards,
  Zap,
  CheckCircle2,
  Rocket,
  Sparkles,
  Trash2
} from "lucide-react";
import { apiUrl, authHeaders, displayMoney, marginUsage, SKILL_STATE, SKILL_STATE_HELP, OPEN_EXECUTION_STATES, countOpenExecutions, displayPrice, displayPct, formatDate, formatDateTime, formatTime, humanize, humanizePhase, smartMoneyBias, TradingViewChart, LivePrice, StatusBadge, statusTone, systemStatus } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { ConceptGraph } from "./pages.jsx";
import { SignalHubPage, TradeJournalPage } from "./relayoutPages.jsx";
import { ConfigPanel, LiveGrayPanel, SystemConfigPanel, TaskManagerPanel } from "./panels.jsx";

export function KillConfirmDialog({ enable, action, onClose }) {
  const [reason, setReason] = useState("");
  async function confirm() {
    await action("/api/risk/kill-switch", { enabled: enable, reason });
    onClose();
  }
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="confirmDialog" onClick={(event) => event.stopPropagation()}>
        <strong>{enable ? "确认触发一键熔断？" : "确认解除熔断？"}</strong>
        <p>{enable ? "将立即阻断所有新交易，并请求撤销全部在途委托。" : "解除后系统恢复正常风控运行，重新允许新交易。"}</p>
        {enable && <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="熔断原因（可选，写入审计链）" autoFocus />}
        <div className="confirmActions">
          <button type="button" className="ghostButton" onClick={onClose}>取消</button>
          <button type="button" className={enable ? "confirmDanger" : "primaryButton"} onClick={confirm}>{enable ? "确认熔断" : "确认解除"}</button>
        </div>
      </div>
    </div>
  );
}

const settingsSections = [
  { id: "llm", label: "模型" },
  { id: "exchange", label: "交易所" },
  { id: "integrations", label: "外部服务" },
  { id: "runtime", label: "运行参数" }
];

const positionSegments = ["持仓", "在途委托", "执行单"];

function MobilePositions({ data, action, ui }) {
  const [segment, setSegment] = useState("持仓");
  const positions = data.positions || [];
  const orders = data.orders || [];
  const executions = data.executionOrders || [];
  const reduceOnly = Boolean(data.system?.reduceOnlyMode);
  const activeExec = OPEN_EXECUTION_STATES; // 单一来源(lib),与后端对齐
  const activeExecutions = executions.filter((order) => activeExec.includes(String(order.status || "").toLowerCase())).length;
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((account) => account.readEnabled);
  const exposure = positions.reduce((sum, position) => sum + Math.abs(Number(position.size || 0) * Number(position.mark || position.entry || 0)), 0);
  const totalPnl = positions.reduce((sum, position) => sum + Number(position.pnl || 0), 0);
  const availableMargin = portfolio.availableMarginUsdt ?? portfolio.availableMargin ?? null;
  const marginRate = configured ? marginUsage(portfolio).marginRatePct : null;
  return (
    <div className="mPositions">
      <div className="mPageStats">
        <div><span>总敞口</span><strong>{configured ? displayMoney(exposure, 0) : "未同步"}</strong></div>
        <div><span>未实现盈亏</span><strong className={totalPnl >= 0 ? "positive" : "negative"}>{configured ? `${totalPnl >= 0 ? "+" : ""}${displayMoney(totalPnl)}` : "未同步"}</strong></div>
        <div><span>保证金率</span><strong>{marginRate === null ? "未同步" : `${marginRate.toFixed(1)}%`}</strong></div>
      </div>
      <div className="mMiniStats">
        <div><span>持仓数</span><strong>{positions.length}</strong></div>
        <div><span>在途委托</span><strong>{orders.length}</strong></div>
        <div><span>活跃执行</span><strong>{activeExecutions}</strong></div>
        <div><span>可用保证金</span><strong>{configured ? displayMoney(availableMargin, 0) : "未同步"}</strong></div>
      </div>
      <div className="mChips">
        {positionSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{name}</button>
        ))}
      </div>

      {segment === "持仓" && (
        <>
          {!positions.length && <p className="mInboxEmpty">暂无真实持仓。配置只读 API 并完成同步后展示。</p>}
          {positions.map((position) => {
            const pnl = Number(position.pnl || 0);
            return (
              <div className="mPosCard" key={position.id || position.symbol}>
                <header>
                  <strong>{position.symbol}</strong>
                  <StatusBadge tone={position.direction === "short" ? "danger" : "ok"}>{position.direction === "short" ? "空" : "多"}</StatusBadge>
                </header>
                <div className={`mPosPnl ${pnl >= 0 ? "positive" : "negative"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(position.pnl, 2, "--")} <small>未实现盈亏</small></div>
                <div className="mPosMeta">
                  <span>数量<b>{position.size ?? "-"}</b></span>
                  <span>开仓均价<b>{position.entry ? displayMoney(position.entry) : "-"}</b></span>
                  <span>标记价格<b>{position.mark ? displayMoney(position.mark) : "-"}</b></span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {segment === "在途委托" && (
        <>
          {!orders.length && <p className="mInboxEmpty">暂无在途委托。</p>}
          {orders.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>方向<b>{order.side || order.direction || "-"}</b></span>
                <span>价格<b>{order.price ? displayMoney(order.price) : "市价"}</b></span>
                <span>数量<b>{order.quantity ?? order.size ?? "-"}</b></span>
              </div>
            </div>
          ))}
        </>
      )}

      {segment === "执行单" && (
        <>
          {!executions.length && <p className="mInboxEmpty">暂无执行单。批准交易计划后由执行引擎生成。</p>}
          {executions.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>方向<b>{order.direction || "-"}</b></span>
                <span>入场<b>{order.entryPrice ? displayMoney(order.entryPrice) : "-"}</b></span>
                <span>止损<b>{order.stopLoss ? displayMoney(order.stopLoss) : "-"}</b></span>
              </div>
              {activeExec.includes(String(order.status || "").toLowerCase()) && (
                <div className="mInboxActions">
                  <button onClick={() => action(`/api/execution-orders/${order.id}/close`, { reason: "manual_mobile" })}>市价平仓</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <button className={`mToggleRow ${reduceOnly ? "on" : ""}`} onClick={() => action("/api/risk/reduce-only", { enabled: !reduceOnly })}>
        <span>
          <strong>只减仓模式</strong>
          <small>{reduceOnly ? "已开启：禁止新开仓，仅允许减仓" : "关闭中：开启后 Agent 只能减仓"}</small>
        </span>
        <i className={reduceOnly ? "on" : ""} />
      </button>

      <div className="mList">
        <button onClick={() => ui.setActive("marketAccount")}>
          <Activity size={17} />
          <span>账户健康与对账</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// 屏 S5 — 系统设置：账户卡 + 交易所列表 + 系统配置分区 + 订阅卡。
function MobileSettingsIndex({ data, onOpen }) {
  const config = data.config || {};
  const exchange = config.exchange || {};
  const integrations = config.integrations || {};
  const runtime = config.runtime || {};
  const user = data.user || {};
  const sub = (data.subscriptions || [])[0] || {};
  const subs = {
    llm: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : "未配置",
    exchange: [exchange.binance?.hasKey && "Binance", exchange.okx?.hasKey && "OKX"].filter(Boolean).join("、") || "未配置",
    integrations: integrations.telegram?.configured ? "TG 已接入" : integrations.lark?.hasWebhook ? "飞书已接入" : "未配置",
    runtime: runtime.authRequired === false ? "免登录" : "鉴权开启"
  };
  const exchanges = [
    { id: "binance", name: "Binance", letter: "B", cls: "binance", connected: exchange.binance?.hasKey },
    { id: "okx", name: "OKX", letter: "O", cls: "okx", connected: exchange.okx?.hasKey }
  ];
  return (
    <div className="mScreen">
      <div className="mCard mAcctCard">
        <span className="mAcctAvatar">{String(user.name || user.email || "U").charAt(0).toUpperCase()}</span>
        <div className="mAcctInfo"><b>{user.name || "量化交易员"}</b><small>{user.email || "—"}</small></div>
        <span className="mAcctPlan">{user.isOwner ? "OWNER" : sub.status ? "PRO" : "—"}</span>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>交易所与 API 密钥</b><small>{exchanges.filter((e) => e.connected).length} 已连接</small></div>
        {exchanges.map((e) => (
          <button className="mExRow" key={e.id} onClick={() => onOpen("settings:exchange")}>
            <span className={`mExLogo ${e.cls}`}>{e.letter}</span>
            <div className="mExInfo"><b>{e.name}</b><small>{e.connected ? "已配置密钥" : "未配置"}</small></div>
            <StatusBadge tone={e.connected ? "ok" : "neutral"}>{e.connected ? "已连接" : "未连接"}</StatusBadge>
            <ChevronRight size={15} />
          </button>
        ))}
        <div className="mSecNote"><Shield size={13} /> 密钥加密存储；只勾读写交易，绝不勾选提币权限</div>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>系统配置</b></div>
        {settingsSections.map((item) => (
          <button className="mCfgRow" key={item.id} onClick={() => onOpen(`settings:${item.id}`)}>
            <span>{item.label}</span>
            <small className="mono">{subs[item.id]}</small>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>

      {sub.status && (
        <div className="mCard mPlanCard">
          <div className="mPlanTop">
            <div><b>{sub.planName || "专业版"}</b><small>{sub.source === "owner_grant" ? "Owner 免费授权" : humanize(sub.status)}</small></div>
            <span className="mPlanBadge">生效中</span>
          </div>
          <div className="mPlanFoot mono">到期 {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "长期有效"}</div>
        </div>
      )}
    </div>
  );
}

function MobileRisk({ data, action, ui, view = "all" }) {
  const showOverview = view === "all" || view === "overview";
  const showSettings = view === "all" || view === "settings";
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const sys = data.system || {};
  const portfolio = data.portfolio || {};
  const rules = data.riskRules || [];
  const maxLeverage = mandate.max_leverage || (mandate.maxLeverageBySymbol ? Math.max(1, ...Object.values(mandate.maxLeverageBySymbol)) : null);
  const approvalThreshold = mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt;
  const validUntil = mandate.validUntil || mandate.valid_until;
  const budgetRemain = sys.remainingDailyLossUsdt;
  const budgetCap = sys.dailyLossCapUsdt;
  const budgetPct = budgetCap ? Math.max(0, Math.min(100, (Number(budgetRemain) / Number(budgetCap)) * 100)) : null;
  const killed = sys.killSwitch;
  const active = ["running", "active"].includes(mandate.status);
  // 授权≠低风险：有真实风险等级就用它，否则显示"已授权·风险待评估"，不写死"低风险"。
  const rLabel = /高|中|低/.test(portfolio.riskLabel || "") ? portfolio.riskLabel : null;
  const wall = killed ? { label: "熔断停机 · 已阻断开仓", tone: "critical" }
    : active ? { label: rLabel ? `${rLabel} · 运行中` : "已授权 · 风险待评估", tone: rLabel === "高风险" ? "critical" : rLabel === "中风险" ? "warning" : rLabel ? "ok" : "warning" }
    : { label: "未授权 · 观察模式", tone: "warning" };
  const mandateTone = active ? "ok" : statusTone(mandate.status);
  const mandRows = [
    ["授权范围", (mandate.exchanges || []).length ? "已授权交易" : "未授权", ""],
    ["交易所", (mandate.exchanges || []).join("、") || "—", ""],
    ["最大杠杆", maxLeverage ? `${maxLeverage}x` : "—", ""],
    ["单日最大亏损", mandate.maxDailyLossPct ? `${mandate.maxDailyLossPct}%` : "—", "neg"],
    ["审批阈值", approvalThreshold != null && mandate.id ? `${displayMoney(approvalThreshold, 0)} U` : "—", ""],
    ["有效期", validUntil ? formatDate(validUntil) : "长期有效", ""]
  ];
  const groups = [["账户", "#2A6FDB", "#EAF0FB"], ["交易", "#1F7A50", "#E6F1EA"], ["事件", "#D06A22", "#FBEDDF"], ["系统", "#7A4FD0", "#F0EAFB"]];
  // scope 真实取值是英文(trade/account/event/knowledge),此前中文 includes 恒 0 → 永远"无规则"(审计 M3)
  const scopeOf = (r) => { const t = String(r.scope || r.category || r.name || "").toLowerCase(); if (/account|portfolio|loss|margin|equity|账户/.test(t)) return "账户"; if (/event|事件/.test(t)) return "事件"; if (/system|knowledge|kill|api|系统/.test(t)) return "系统"; return "交易"; };
  const scopeCount = (name) => rules.filter((r) => scopeOf(r) === name).length;
  return (
    <div className="mScreen">
      {showOverview && <div className={`mRiskWall ${wall.tone}`}>
        <ShieldCheck size={22} />
        <div><b>{wall.label}</b><small>{active ? "授权与硬风控生效中" : "配置授权后进入自主"}</small></div>
      </div>}
      {showOverview && <div className="mCard mBudgetCard">
        <div className="mBudgetTop"><span>剩余亏损预算</span><b className="mono">{budgetRemain != null ? `${displayMoney(budgetRemain, 2)} USDT` : "未授权"}</b></div>
        <div className="mBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
      </div>}
      {showOverview && (() => {
        // 风险事件处理:按标题折叠去重、显条数,逐组/一键标记已处理(接 close / close-all)。移动版此前完全没有。
        const openInc = (data.riskIncidents || []).filter((i) => i.status === "open");
        const incGroups = [];
        for (const inc of openInc) { const k = inc.title || inc.source || "风险事件"; const g = incGroups.find((x) => x.key === k); if (g) { g.count += 1; g.items.push(inc); } else incGroups.push({ key: k, count: 1, items: [inc] }); }
        return <div className="mCard">
          <div className="mCardHead"><b>风险事件</b><span className={openInc.length ? "mIncCount on" : "mIncCount"}>{openInc.length ? `${openInc.length} 项未处理` : "全部已处理"}</span></div>
          {!openInc.length && <div className="mEmpty">当前没有未处理的风险事件。</div>}
          {incGroups.map((g) => (
            <div className="mIncRow" key={g.key}>
              <div className="mIncL"><b>{g.key}</b>{g.count > 1 && <span className="mIncX">×{g.count}</span>}</div>
              <button className="mIncBtn" onClick={async () => { for (const inc of g.items) await action(`/api/risk/incidents/${inc.id}/close`, {}); ui.notify?.("已处理"); }}>{g.count > 1 ? `处理 ${g.count} 项` : "标记已处理"}</button>
            </div>
          ))}
          {openInc.length > 1 && <button className="mLink2" onClick={() => action("/api/risk/incidents/close-all", {})}>全部标记已处理 ›</button>}
        </div>;
      })()}
      {showSettings && <div className="mCard">
        <div className="mCardHead"><b>授权委托 MANDATE</b><StatusBadge tone={mandateTone}>{humanize(mandate.status, "未授权")}</StatusBadge></div>
        <div className="mMandList">{mandRows.map(([k, v, tone]) => <div className="mMandRow" key={k}><span>{k}</span><b className={`mono ${tone}`}>{v}</b></div>)}</div>
        <button className="mLink2" onClick={() => ui.openPanel("mandate")}>编辑授权 ›</button>
      </div>}
      {showOverview && <div className="mCard">
        <div className="mCardHead"><b>风险规则</b></div>
        <div className="mRuleGrid2">{groups.map(([name, c, bg]) => { const n = scopeCount(name); return <div className="mRuleCard2" key={name} style={{ background: bg }}><b style={{ color: c }}>{name}</b><small>{n ? `${n} 条已启用` : "无规则"}</small><i style={{ background: c }} /></div>; })}</div>
      </div>}
      {showSettings && <div className="mCard">
        <div className="mCardHead"><b>实盘写入与灰度</b><StatusBadge tone={data.config?.liveTrading?.effective ? "danger" : "neutral"}>{data.config?.liveTrading?.effective ? "实盘已开启" : "实盘关闭"}</StatusBadge></div>
        <LiveGrayPanel data={data} action={action} ui={ui} />
      </div>}

      {showOverview && <div className="mRiskBtns">
        <button className="mRbPause" onClick={() => action("/api/system/autonomy", { enabled: false })}>暂停自主</button>
        <button className="mRbReduce" onClick={() => { const on = Boolean(data.system?.reduceOnlyMode); if (window.confirm(on ? "关闭只减仓模式?" : "开启只减仓模式?将禁止新开仓,仅允许减仓/平仓/撤单。")) action("/api/risk/reduce-only", { enabled: !on }); }}>{data.system?.reduceOnlyMode ? "退出只减仓" : "只减仓"}</button> {/* 此前只是打开规则面板,不减仓(审计 M2) */}
        <button className="mRbKill" onClick={() => action("/api/risk/kill-switch", { enabled: !killed, reason: "" })}>{killed ? "解除熔断" : "一键熔断"}</button>
      </div>}
    </div>
  );
}

const KNOW_SEGMENTS = ["上手", "方法", "技能", "规则", "图谱"];
function MobileKnowledge({ data, action, ui, view = "all" }) {
  // 与桌面对齐:知识库(view=knowledge)只留 上手/方法/规则/图谱;能力与工具(view=capabilities)只留 技能。
  const segs = view === "capabilities" ? ["技能"] : view === "knowledge" ? ["上手", "方法", "规则", "图谱"] : KNOW_SEGMENTS;
  const [segState, setSeg] = useState(view === "capabilities" ? "技能" : "上手");
  const seg = segs.includes(segState) ? segState : segs[0];
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const knowledge = data.knowledge || {};
  const sources = knowledge.sources || [];
  const methods = knowledge.tradingMethods || [];
  const skills = knowledge.tradingSkills || [];
  const rules = knowledge.ruleProposals || [];
  const compiledIds = new Set(skills.filter((s) => !["retired", "superseded"].includes(s.status)).map((s) => s.sourceMethodId));
  const active = skills.filter((s) => s.status === "active").length;
  const inPipe = skills.filter((s) => !["retired", "superseded", "compile_failed", "active"].includes(s.status)).length;
  // 当前该做哪一步：没知识源→喂料；有草案没进流水线→编译验证；进了流水线没上岗→批准；已上岗→完成。
  const step = sources.length === 0 ? 1 : (active === 0 && inPipe === 0) ? 2 : active === 0 ? 3 : 4;
  const guide = [
    { n: 1, Icon: BookOpen, title: "喂知识", desc: "导入交易书籍或文章，自动蒸馏出方法与风控纪律。", cta: "导入知识源", on: () => ui.openPanel("knowledgeImport") },
    { n: 2, Icon: Rocket, title: "编译 + 验证", desc: "把方法编译成技能，跑历史回测 + 纯前向模拟盘。", cta: "去方法", on: () => setSeg("方法") },
    { n: 3, Icon: ShieldCheck, title: "人工批准上岗", desc: "只有你亲自批准的技能才进入实盘决策。", cta: "去技能", on: () => setSeg("技能") }
  ];

  async function search() {
    if (!query.trim()) return;
    const result = await action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 });
    // 后端返回 analysisBundle{summary,retrievedRefs[]},没有 hits/results/chunks(此前永远"没有命中",审计 H6)
    const refs = (result.retrievedRefs || []).map((r) => ({ text: r.citationLocator, score: r.score }));
    setHits(result.id ? [{ text: result.summary, score: null }, ...refs] : []);
  }

  return (
    <div className="mSubPage">
      <div className="mChips">
        {segs.map((name) => <button key={name} className={seg === name ? "active" : ""} onClick={() => setSeg(name)}>{name}{name === "方法" && methods.length ? ` ${methods.length}` : ""}{name === "技能" && skills.length ? ` ${skills.filter((k) => !["compile_failed", "superseded", "retired"].includes(k.status)).length}` : ""}{name === "规则" && rules.length ? ` ${rules.length}` : ""}{name === "图谱" && knowledge.conceptCards?.length ? ` ${knowledge.conceptCards.length}` : ""}</button>)}
      </div>

      {seg === "上手" && (
        <>
          <div className="mKGuide">
            <div className="mKGuideTitle"><Sparkles size={14} /> 知识库怎么用？三步让 AI 交易员变强</div>
            {guide.map((s) => {
              const state = s.n < step ? "done" : s.n === step ? "active" : "todo";
              const Icon = state === "done" ? CheckCircle2 : s.Icon;
              return (
                <div className={`mKStep ${state}`} key={s.n}>
                  <span className="mKStepIcon"><Icon size={16} /></span>
                  <div className="mKStepBody">
                    <b>{s.title}{state === "active" && <em> · 现在做这步</em>}{state === "done" && <em className="ok"> · 已完成</em>}</b>
                    <p>{s.desc}</p>
                    <button className={state === "active" ? "mMiniPrimary" : "mMiniGhost"} onClick={s.on}>{s.cta} ›</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mPageStats">
            <div><span>知识源</span><strong>{sources.length}</strong></div>
            <div><span>交易方法</span><strong>{methods.length}</strong></div>
            <div><span>已上岗技能</span><strong>{active}</strong></div>
          </div>

          <div className="mSearchBar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="检索知识库，如：CPI 前如何控仓" onKeyDown={(event) => { if (event.key === "Enter") search(); }} />
            <button onClick={search} aria-label="检索"><Search size={16} /></button>
          </div>
          {hits !== null && (
            <div className="mSectionCard">
              <header><span>检索结果（{hits.length}）</span></header>
              {!hits.length && <p className="mInboxEmpty">没有命中的知识片段。</p>}
              {hits.slice(0, 5).map((hit, index) => <p className="mLeadLine" key={index}>{String(hit.text || "").slice(0, 120)}{hit.score != null ? ` · ${hit.score}` : ""}</p>)}
            </div>
          )}

          <div className="mSectionCard">
            <header><span>知识源（{sources.length}）</span><button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>全部 <ChevronRight size={12} /></button></header>
            {!sources.length && <p className="mInboxEmpty">还没有导入知识。点下方「导入知识」开始。</p>}
            {sources.slice(0, 8).map((source) => (
              <div className="mRowItem" key={source.id || source.title}>
                <b>{source.title || source.name || "未命名"}</b>
                <StatusBadge tone={statusTone(source.status)}>{humanize(source.status, "已导入")}</StatusBadge>
              </div>
            ))}
          </div>
          <button className="mPrimaryAction" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={15} /> 导入知识</button>
        </>
      )}

      {seg === "方法" && (
        <div className="mSectionCard">
          <header><span>交易方法草案（{methods.length}）</span><small>需走验证才上岗</small></header>
          {!methods.length && <p className="mInboxEmpty">导入书籍后自动蒸馏交易方法草案。</p>}
          {methods.map((m) => {
            const compiled = compiledIds.has(m.id);
            const open = openId === m.id;
            return (
              <div className={`mKRow ${open ? "open" : ""}`} key={m.id}>
                <button className="mKRowHead" onClick={() => setOpenId(open ? null : m.id)}>
                  <span className={`mDir ${m.direction}`}>{m.direction === "short" ? "空" : m.direction === "long" ? "多" : "多空"}</span>
                  <b>{m.name}</b>
                  <StatusBadge tone={compiled ? "ok" : "neutral"}>{compiled ? "已编译" : "草案"}</StatusBadge>
                </button>
                {open && (
                  <div className="mKRowBody">
                    <p><i>进场</i>{m.entry || "-"}</p>
                    <p><i>止损</i>{m.stop || "-"}</p>
                    <p><i>止盈</i>{m.takeProfit || "-"}</p>
                    {m.source?.title && <p className="mKSrc">《{m.source.title}》</p>}
                    {!compiled && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${m.id}/compile`, {})}>编译为技能草案 ›</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {seg === "技能" && (
        <div className="mSectionCard">
          <header><span>技能流水线（{skills.length}）</span><span style={{ display: "flex", gap: 8 }}>{(() => { const n = skills.filter((k) => ["compiled", "historical_rejected"].includes(k.status)).length; return n > 0 && <button className="textButton" onClick={() => { if (window.confirm(`批量历史验证 ${n} 个技能?`)) action("/api/knowledge/skills/validate-all", {}); }}>一键验证({n})</button>; })()}<button className="textButton" onClick={() => action("/api/knowledge/skills/sync", {})}>同步</button></span></header>
          <div className="mKLegend">
            <button className="mKLegendHead" onClick={() => setLegendOpen((v) => !v)}><Info size={13} /> 这些状态是什么意思？<ChevronDown size={13} className={legendOpen ? "flip" : ""} /></button>
            {legendOpen && SKILL_STATE_HELP.map(([label, tone, desc]) => (
              <div className="mKLegendRow" key={label}><StatusBadge tone={tone}>{label}</StatusBadge><span>{desc}</span></div>
            ))}
          </div>
          {!skills.length && <p className="mInboxEmpty">还没有技能。到「方法」把方法编译成技能草案后在此推进验证。</p>}
          {(() => {
            const ARCHIVED = new Set(["compile_failed", "superseded", "retired"]);
            const STATUS_RANK = { paper_validated: 0, historical_validated: 1, paper_validating: 2, compiled: 3, degraded: 4, historical_rejected: 5, paper_rejected: 6 };
            const live = skills.filter((s) => !ARCHIVED.has(s.status))
              .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
            const archived = skills.filter((s) => ARCHIVED.has(s.status));
            const row = (skill) => {
              const st = SKILL_STATE[skill.status] || { label: skill.status, tone: "neutral" };
              const open = openId === skill.id;
              return (
                <div className={`mKRow ${open ? "open" : ""}`} key={skill.id}>
                  <button className="mKRowHead" onClick={() => setOpenId(open ? null : skill.id)}>
                    {skill.spec?.direction && <span className={`mDir ${skill.spec.direction}`}>{skill.spec.direction === "short" ? "空" : "多"}</span>}
                    <b>{skill.name} <span className="mono">v{skill.version}</span></b>
                    {skill.spec?.lowTrust && <StatusBadge tone="warning">低信任</StatusBadge>}
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </button>
                  {open && (
                    <div className="mKRowBody">
                      <p className="mKSrc">{skill.spec?.templateLabel || "未编译"} · {skill.spec?.timeframe || "-"}{skill.sourceTitle ? ` · 《${skill.sourceTitle}》` : ""}</p>
                      {skill.compileErrors?.length > 0 && <p className="mKErr">不能执行：{skill.compileErrors.join("；")}</p>}
                      {skill.status === "superseded" && <p className="mKSrc">已被更新版本替代，仅作追溯。</p>}
                      {skill.liveMetrics && <p><i>实盘</i>{skill.liveMetrics.trades} 笔 · 胜率 {skill.liveMetrics.winRatePct}%</p>}
                      {st.next && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/skills/${skill.id}/${st.next.action}`, {})}>{st.next.label} ›</button>}
                      {skill.status === "compile_failed" && skill.sourceMethodId && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${skill.sourceMethodId}/compile`, {})}>重新编译 ›</button>}
                    </div>
                  )}
                </div>
              );
            };
            return (
              <>
                {live.map(row)}
                {!live.length && skills.length > 0 && <p className="mInboxEmpty">当前没有在流水线中的活技能，只有归档技能。</p>}
                {archived.length > 0 && (
                  <>
                    <div className="mKArchiveHead">
                      <button onClick={() => setArchivedOpen((v) => !v)}><ChevronDown size={12} className={archivedOpen ? "flip" : ""} /> 已归档 {archived.length}</button>
                      <button className="mKArchivePurge" onClick={() => { if (window.confirm("清理归档：删除编译失败与已被替代的技能？（已退役保留）")) action("/api/knowledge/skills/purge-archived", {}); }}><Trash2 size={11} /> 清理</button>
                    </div>
                    {archivedOpen && archived.map(row)}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {seg === "规则" && (
        <div className="mSectionCard">
          <header><span>风控纪律（{rules.length}）</span><button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>管理/去重 <ChevronRight size={12} /></button></header>
          {!rules.length && <p className="mInboxEmpty">导入资料后自动抽取风控纪律。</p>}
          {rules.slice(0, 20).map((r) => (
            <div className="mRowItem" key={r.id}>
              <b>{r.name}</b>
              <StatusBadge tone={r.status === "已批准" ? "ok" : "warning"}>{humanize(r.status, "待审批")}</StatusBadge>
            </div>
          ))}
          {rules.length > 0 && <button className="mPrimaryAction" onClick={() => ui.openPanel("ruleLibrary")}>去规则库批准 / 去重 ›</button>}
        </div>
      )}

      {seg === "图谱" && (
        <div className="mSectionCard">
          <header><span>概念图谱（{knowledge.conceptCards?.length || 0}）</span><small>相关概念自动聚簇</small></header>
          <ConceptGraph concepts={knowledge.conceptCards || []} />
        </div>
      )}
    </div>
  );
}

const taskSegments = ["重要事件", "定时任务", "创建任务"];

function MobileTasks({ data, action }) {
  const [segment, setSegment] = useState("重要事件");
  const events = (data.events || []).slice(0, 10);
  const tasks = data.tasks || [];
  const activeTasks = tasks.filter((task) => task.enabled !== false);
  const todayEvents = (data.events || []).filter((event) => {
    if (!event.due) return false;
    return new Date(event.due).toDateString() === new Date().toDateString();
  });
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>今日事件</span><strong>{todayEvents.length}</strong></div>
        <div><span>活跃任务</span><strong>{activeTasks.length}</strong></div>
        <div><span>事件规则</span><strong>{(data.riskRules || []).filter((rule) => rule.scope === "event").length}</strong></div>
      </div>

      <div className="mChips">
        {taskSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{name}</button>
        ))}
      </div>

      {segment === "重要事件" && (
        <div className="mSectionCard">
          <header>
            <span>重要事件</span>
            <button className="textButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={12} /> 刷新</button>
          </header>
          {!events.length && <p className="mInboxEmpty">暂无事件。点击刷新拉取事件源。</p>}
          {events.map((event) => (
            <div className="mRowItem" key={event.id} title={event.rawTitle || event.title}>
              <span>{formatDateTime(event.due, "待定")}</span>
              <b>{event.shortTitle || event.title}</b>
              <StatusBadge tone={event.impact >= 80 ? "danger" : event.impact >= 50 ? "warning" : "neutral"}>{event.impactLabel || "待评估"}</StatusBadge>
            </div>
          ))}
        </div>
      )}

      {segment === "定时任务" && (
        <div className="mSectionCard">
          <header><span>定时任务（{tasks.length}）</span></header>
          {!tasks.length && <p className="mInboxEmpty">暂无定时任务。</p>}
          {tasks.map((task) => (
            <div className="mRuleRow" key={task.id}>
              <span>
                <b>{task.name}</b>
                <small>{task.schedule || "Every 1h"} · {humanize(task.status || "running")}</small>
              </span>
              <div className="mRowActions">
                <button onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button>
                <button onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {segment === "创建任务" && (
        <div className="mSectionCard">
          <TaskManagerPanel data={data} action={action} />
        </div>
      )}
    </div>
  );
}

function MobileAccountHealth({ data, action }) {
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const openExecutions = countOpenExecutions(data.executionOrders);
  const blockedChecks = (data.riskChecks || []).filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const rows = [
    ["交易所账户", `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "neutral"],
    ["私有账户快照", latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : "未同步", latestSnapshot ? "ok" : "neutral"],
    ["对账状态", configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置", latestReconcile?.status === "ok" ? "ok" : "neutral"],
    ["实盘写入", data.system?.liveTradingEnabled ? "已开启" : "关闭", data.system?.liveTradingEnabled ? "warning" : "neutral"], // 主动授权开关≠故障,与桌面口径一致用提醒色
    ["在途执行", `${openExecutions} 个`, openExecutions ? "warning" : "ok"],
    ["近期风控阻断", `${blockedChecks} 次`, blockedChecks ? "warning" : "ok"]
  ];
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>账户</span><strong>{configuredAccounts}/{totalAccounts}</strong></div>
        <div><span>快照</span><strong>{latestSnapshot ? formatTime(latestSnapshot.createdAt) : "未同步"}</strong></div>
        <div><span>对账</span><strong>{configuredAccounts ? humanize(latestReconcile?.status, "未对账") : "待配置"}</strong></div>
      </div>

      <div className="mSectionCard">
        <header><span>健康检查</span></header>
        {rows.map(([label, value, tone]) => (
          <div className="mRowItem" key={label}>
            <b>{label}</b>
            <em className="mRowValue">{value}</em>
            <StatusBadge tone={tone}>{tone === "ok" ? "正常" : tone === "danger" ? "注意" : tone === "warning" ? "待处理" : "待配置"}</StatusBadge>
          </div>
        ))}
      </div>

      <button className="mPrimaryAction" onClick={() => action("/api/reconciler/run", { mode: "manual_ui" })}><RefreshCw size={15} /> 手动对账</button>
    </div>
  );
}

// 全部 OKX/币安 USDT 永续合约清单(真实拉取),供移动版行情搜索选币用。
function useMobileInstruments() {
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/market/instruments"), { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { instruments: [] }))
      .then((d) => { if (alive) setList((d.instruments || []).map((i) => i.symbol || i).filter(Boolean)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return list;
}

// 移动版底部弹层选币器:搜索全部永续合约、点选切换、可加自选。替代原来只有 4 个硬编码的 pill。
function MobilePairSheet({ instruments, current, onPick, onClose, onAddWatch }) {
  const [q, setQ] = useState("");
  const qU = q.trim().toUpperCase();
  const list = (instruments || []).filter((s) => !qU || s.includes(qU)).slice(0, 200);
  return (
    <div className="mSheetOverlay" onClick={onClose}>
      <div className="mSheet" onClick={(e) => e.stopPropagation()}>
        <div className="mSheetHead"><b>选择币对</b><button className="mSheetClose" onClick={onClose} aria-label="关闭"><ChevronDown size={20} /></button></div>
        <div className="mSheetSearch"><Search size={15} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入币种，如 BTC / SOL" /></div>
        <div className="mSheetList">
          {list.map((s) => (
            <button key={s} className={`mSheetRow ${s === current ? "on" : ""}`} onClick={() => { onPick(s); onClose(); }}>
              <span>{s}</span>
              {onAddWatch && <span className="mSheetAdd" role="button" onClick={(e) => { e.stopPropagation(); onAddWatch(s); }}><Plus size={15} /></span>}
            </button>
          ))}
          {!list.length && <div className="mEmpty">{instruments && instruments.length ? "无匹配币对" : "合约清单加载中…"}</div>}
        </div>
      </div>
    </div>
  );
}

function MobileMarket({ data, action, ui }) {
  const [tf, setTf] = useState("1H");
  const [sym, setSym] = useState(null);
  const [sheet, setSheet] = useState(false);
  const instruments = useMobileInstruments();
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((a) => a.readEnabled);
  const markets = (data.markets || []).filter((m) => m && m.symbol);
  // 选中的币对可能不在已同步的 markets 里(从全量清单选的),用最小对象兜底让图表/标题正常切换。
  const market = markets.find((m) => m.symbol === sym) || (sym ? { symbol: sym, candles: [] } : markets[0]) || { symbol: "BTC/USDT", candles: [] };
  const positions = data.positions || [];
  const equity = portfolio.totalEquityUsdt;
  const avail = portfolio.availableMarginUsdt;
  // 保证金口径统一走 lib.marginUsage(含冻结保证金;缺数据=null,不造假)。
  const { usedMarginUsdt: used, marginRatePct: marginRate } = marginUsage(portfolio);
  const metrics = [
    ["总资产", configured && equity != null ? displayMoney(equity, 2) : "未同步", null],
    ["今日盈亏", configured && portfolio.todayPnl != null ? `${portfolio.todayPnl >= 0 ? "+" : ""}${displayMoney(portfolio.todayPnl, 2)}` : "未同步", configured ? portfolio.todayPnl : null],
    ["可用保证金", configured && avail != null ? displayMoney(avail, 2) : "未同步", null],
    ["未实现盈亏", configured && portfolio.unrealizedPnl != null ? `${portfolio.unrealizedPnl >= 0 ? "+" : ""}${displayMoney(portfolio.unrealizedPnl, 2)}` : "未同步", configured ? portfolio.unrealizedPnl : null]
  ];
  const chgPos = Number(market.changePct || 0) >= 0;
  const tvInterval = { "15m": "15", "1H": "60", "4H": "240", "1D": "D" }[tf] || "60";
  const circ = 2 * Math.PI * 24;
  const dash = `${((marginRate ?? 0) / 100) * circ} ${circ}`;
  return (
    <div className="mScreen">
      <div className="mMetric2x2">
        {metrics.map(([k, v, pn]) => <div className="mMetricCell" key={k}><span>{k}</span><b className={`mono ${pn != null ? (Number(pn) >= 0 ? "pos" : "neg") : ""}`}>{v}</b></div>)}
      </div>
      <div className="mCard">
        <LivePrice symbol={market.symbol} fallbackPrice={market.price} fallbackChange={market.changePct}>
          {(price, change) => (
            <>
              <div className="mMktHead">
                <div className="mMktSym"><span className="mCoinDot">{(market.symbol || "B").charAt(0)}</span><b className="mono">{market.symbol}</b></div>
                <div className={`mMktChg ${Number(change || 0) >= 0 ? "pos" : "neg"} mono`}>{displayPct(change)}</div>
              </div>
              <div className="mMktPrice mono">{displayPrice(price)}</div>
            </>
          )}
        </LivePrice>
        <div className="mSnapRow">
          <span>24h高<b className="mono">{market.high24h != null ? displayMoney(market.high24h, 2) : "—"}</b></span>
          <span>24h低<b className="mono">{market.low24h != null ? displayMoney(market.low24h, 2) : "—"}</b></span>
          <span>成交额<b className="mono">{market.volume24h ? String(market.volume24h) : "—"}</b></span>
          <span>资金费率<b className="mono">{market.fundingRate == null ? "—" : `${Number(market.fundingRate) >= 0 ? "+" : ""}${Number(market.fundingRate).toFixed(4)}%`}</b></span>
        </div>
        <div className="mSymPills">
          {markets.slice(0, 4).map((m) => <button key={m.symbol} className={m.symbol === market.symbol ? "active" : ""} onClick={() => setSym(m.symbol)}>{m.symbol.replace("/USDT", "")}</button>)}
          <button className="mSymMore" onClick={() => setSheet(true)}><Search size={13} /> 全部币对</button>
        </div>
        <div className="mTfPills">{["15m", "1H", "4H", "1D"].map((t) => <button key={t} className={tf === t ? "active" : ""} onClick={() => setTf(t)}>{t}</button>)}</div>
        <div className="mKline tv"><TradingViewChart symbol={market.symbol} interval={tvInterval} livePrice={market.price} /></div>
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>持仓</b><button className="mLink" onClick={() => ui.setActive("positions")}>全部 ›</button></div>
        {positions.length ? positions.slice(0, 3).map((p, i) => {
          const short = String(p.direction || p.side || p.posSide || "").toLowerCase().includes("short");
          const pnl = Number(p.pnl ?? p.upl ?? p.unrealizedPnl ?? 0);
          return (
            <div className="mPosRow" key={i}>
              <div className="mPosL"><b className="mono">{p.symbol || p.instId}</b><span className={`mPosDir ${short ? "short" : "long"}`}>{short ? "做空" : "做多"}</span></div>
              <div className="mPosR"><b className={`mono ${pnl >= 0 ? "pos" : "neg"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(pnl, 2)}</b><small className="mono">{displayMoney(p.size ?? p.qty ?? p.pos ?? 0, 2)} · {displayPct(p.roiPct ?? p.uplRatioPct)}</small></div>
            </div>
          );
        }) : <div className="mEmpty">连接交易所后显示真实持仓</div>}
      </div>
      <div className="mCard mMarginCard">
        <svg className="mDonut" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="24" fill="none" stroke="#EDE7DB" strokeWidth="6" />
          <circle cx="28" cy="28" r="24" fill="none" stroke="#D06A22" strokeWidth="6" strokeDasharray={dash} strokeLinecap="round" transform="rotate(-90 28 28)" />
          <text x="28" y="31" textAnchor="middle" className="mDonutTxt">{marginRate != null ? `${marginRate.toFixed(0)}%` : "—"}</text>
        </svg>
        <div className="mMarginInfo"><b>保证金率</b><small>{marginRate != null ? `已用保证金 ${marginRate.toFixed(1)}%` : "连接账户后显示"}</small></div>
      </div>
      {sheet && <MobilePairSheet instruments={instruments} current={market.symbol} onPick={setSym} onClose={() => setSheet(false)} onAddWatch={(s) => { action("/api/watchlist", { symbol: s }); ui.notify?.(`已加入自选 ${s}`); }} />}
    </div>
  );
}

// 屏 S4 — 审计与系统：系统卡 2×2 + 审计链 + 决策/工具日志。
function MobileAudit({ data, ui }) {
  const sys = data.system || {};
  const rt = data.realtimeConnections || [];
  const tasks = (data.tasks || []).filter((t) => t.enabled).length;
  const exSynced = (data.exchangeAccounts || []).filter((a) => a.readEnabled).length;
  const exTotal = data.exchangeAccounts?.length || 0;
  const sysCards = [
    ["API 健康", sys.apiHealth || "未知", "#2A6FDB", "#EAF0FB"],
    ["WebSocket", data.realtimeStarted ? `${rt.filter((c) => c.status === "connected").length}/${rt.length || 0}` : "未启动", "#7A4FD0", "#F0EAFB"],
    ["任务引擎", String(tasks), "#D06A22", "#FBEDDF"],
    ["交易所同步", exTotal ? `${exSynced}/${exTotal}` : "未接入", "#1F7A50", "#E6F1EA"]
  ];
  const chain = (data.traces || []).slice(0, 6);
  const logs = (data.auditLogs || []).slice(0, 5);
  return (
    <div className="mScreen">
      <div className="mMetric2x2">
        {sysCards.map(([k, v, c, bg]) => <div className="mMetricCell" key={k}><span style={{ color: c }}>{k}</span><b className="mono" style={{ color: c }}>{v}</b><i className="mSysDot" style={{ background: bg }} /></div>)}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>运行审计链</b><button className="mLink" onClick={() => ui.openPanel("auditChain")}>完整 ›</button></div>
        {chain.length ? chain.map((t, i) => (
          <div className="mChainRow" key={t.id || i}>
            <span className={`mChainDot ${statusTone(t.status)}`} />
            <div className="mChainMid"><b>{t.title || t.type}</b><small className="mono">{t.id ? String(t.id).slice(0, 14) : t.type}</small></div>
            <small className="mono mChainTime">{formatTime(t.createdAt)}</small>
          </div>
        )) : <div className="mEmpty">暂无审计链记录</div>}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>决策与工具日志</b></div>
        {logs.length ? logs.map((l, i) => (
          <div className="mLogRow" key={l.id || i}>
            <small className="mono">{formatTime(l.createdAt)}</small>
            <b>{l.action}</b>
            <StatusBadge tone={statusTone(l.severity)}>{humanize(l.severity || "ok")}</StatusBadge>
          </div>
        )) : <div className="mEmpty">暂无日志</div>}
      </div>
    </div>
  );
}

// 屏 S1 — AI 交易员：顶栏下 4 等分状态条。
function MobileChatStatus({ data }) {
  const sys = data.system || {};
  const pf = data.portfolio || {};
  const autoOn = sys.autonomyEnabled === true && !sys.killSwitch;
  const smMob = data.marketRegime?.smartMoney || {};
  // 与桌面端共用 smartMoneyBias（1.05/0.95 三档），不再用 >=1 二分导致两端结论矛盾。
  const bias = smMob.ok ? smartMoneyBias(smMob.topTraderLongShortRatio).label : "待同步";
  const mandate = data.mandates?.find((m) => ["active", "running"].includes(m.status));
  const cells = [
    ["状态", autoOn ? "运行中" : "已暂停", autoOn ? "pos" : ""],
    ["判断", bias, bias === "偏多" ? "pos" : bias === "偏空" ? "neg" : ""],
    ["今日", pf.todayPnlPct != null ? displayPct(pf.todayPnlPct) : "—", Number(pf.todayPnlPct || 0) >= 0 ? "pos" : "neg"],
    ["目标", mandate?.maxDailyLossPct ? `亏≤${mandate.maxDailyLossPct}%/日` : "—" /* targetMonthlyPct 是后端从未写入的死字段(审计 L1) */, ""]
  ];
  return (
    <div className="mChatStatus">
      {cells.map(([k, v, tone]) => <div className="mChatStatCell" key={k}><span>{k}</span><b className={`mono ${tone}`}>{v}</b></div>)}
    </div>
  );
}

// 移动端主导航（与桌面 IA 对齐:交易 / 能力 / 风控与运维），走顶部汉堡抽屉。
// W1b:新增 信号中心(计划看板) + 交易日志,顺序与桌面一致。
const mobileNav = [
  { id: "chat", label: "AI 交易员", code: "ALPHA-01", icon: Bot },
  { id: "signalHub", label: "信号中心", code: "SIGNALS · BOARD", icon: Zap },
  { id: "cockpit", label: "市场与账户", code: "MARKET · ACCOUNT", icon: PieChart },
  { id: "tradeJournal", label: "交易日志", code: "TRADE · JOURNAL", icon: ClipboardList },
  { id: "knowledgeBase", label: "知识库", code: "KNOWLEDGE", icon: BookOpen },
  { id: "capabilities", label: "能力与工具", code: "CAPABILITIES", icon: Sparkles },
  { id: "riskOverview", label: "风控总览", code: "RISK · VIEW", icon: ShieldCheck },
  { id: "riskSettings", label: "风控设置", code: "RISK · CFG", icon: SlidersHorizontal },
  { id: "eventsTasks", label: "事件与任务", code: "EVENTS · TASKS", icon: CalendarClock },
  { id: "auditSystem", label: "审计", code: "AUDIT · SYSTEM", icon: Activity },
  { id: "systemSettings", label: "系统设置", code: "SETTINGS · CONFIG", icon: Settings }
];

function MobileHeader({ route, onMenu, right, reconnecting }) {
  const item = mobileNav.find((n) => n.id === route) || mobileNav[0];
  return (
    <header className="mHeader2">
      <button className="mMenuBtn" onClick={onMenu} aria-label="打开菜单"><Menu size={20} /></button>
      <div className="mHeaderMid"><strong>{item.label}</strong><small className="mono">{item.code}</small></div>
      <div className="mHeaderRight">
        {reconnecting && <span className="mReconnect"><span className="pulseDot" />重连中</span>}
        {right}
      </div>
    </header>
  );
}

function NavDrawer({ open, route, onNavigate, onClose, data }) {
  if (!open) return null;
  const status = systemStatus(data);
  return (
    <div className="mDrawerOverlay" onClick={onClose}>
      <aside className="mDrawer" onClick={(event) => event.stopPropagation()}>
        <div className="mDrawerBrand"><span className="mDrawerLogo">◆</span><div className="mDrawerBrandText"><b>交易 Agent</b><small>AI · DIGITAL ASSET</small></div></div>
        <div className="mDrawerNav">
          {mobileNav.map((n) => {
            const Icon = n.icon;
            return <button key={n.id} className={`mDrawerItem ${route === n.id ? "active" : ""}`} onClick={() => onNavigate(n.id)}><Icon size={19} /><span>{n.label}</span></button>;
          })}
        </div>
        <div className="mDrawerFoot">
          <div className={`mDrawerStatus ${status.tone}`}><span />{status.label}</div>
          <button className="mDrawerClose" onClick={onClose}>关闭菜单</button>
        </div>
      </aside>
    </div>
  );
}

export function MobileApp({ api }) {
  const { data, action, toast, busy, notify, download, refresh, connectionError } = api;
  const [route, setRoute] = useState("chat");
  const [drawer, setDrawer] = useState(false);
  const [subPage, setSubPage] = useState("");
  const [panel, setPanel] = useState("");
  const [killConfirm, setKillConfirm] = useState(false);
  // 打开审计/动态即把未读通知标为已读
  useEffect(() => {
    if (route === "auditSystem" && (data.notifications || []).some((item) => !item.read)) action("/api/notifications/read", {});
  }, [route]);

  function navigate(next) {
    if (mobileNav.some((n) => n.id === next)) { setRoute(next); setSubPage(""); setDrawer(false); return; }
    if (next === "positions" || next === "marketAccount") { setRoute("cockpit"); setSubPage(next); setDrawer(false); return; }
    if (next === "systemSettings") { setRoute("systemSettings"); setSubPage(""); setDrawer(false); return; }
    if (String(next).startsWith("settings:")) { setRoute("systemSettings"); setSubPage(next); setDrawer(false); return; }
    setRoute("cockpit"); setSubPage(""); setDrawer(false);
  }

  const ui = { setActive: navigate, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const autoOn = data.system?.autonomyEnabled === true && !data.system?.killSwitch;
  const settingsSection = subPage.startsWith("settings:") ? subPage.slice(9) : "";

  let content = null;
  if (route === "chat") {
    content = <div className="content mChatContent"><MobileChatStatus data={data} /><ChatPage data={data} action={action} ui={ui} /></div>;
  } else if (route === "signalHub") {
    content = <div className="content mSubContent"><SignalHubPage data={data} action={action} ui={ui} /></div>;
  } else if (route === "tradeJournal") {
    content = <div className="content mSubContent"><TradeJournalPage data={data} /></div>;
  } else if (route === "cockpit") {
    content = subPage === "positions" ? <MobilePositions data={data} action={action} ui={ui} />
      : subPage === "marketAccount" ? <MobileAccountHealth data={data} action={action} />
        : <MobileMarket data={data} action={action} ui={ui} />;
  } else if (route === "eventsTasks") {
    content = <MobileTasks data={data} action={action} ui={ui} />;
  } else if (route === "knowledgeBase") {
    content = <MobileKnowledge data={data} action={action} ui={ui} view="knowledge" />;
  } else if (route === "capabilities") {
    content = <MobileKnowledge data={data} action={action} ui={ui} view="capabilities" />;
  } else if (route === "riskOverview") {
    content = <MobileRisk data={data} action={action} ui={ui} view="overview" />;
  } else if (route === "riskSettings") {
    content = <MobileRisk data={data} action={action} ui={ui} view="settings" />;
  } else if (route === "auditSystem") {
    content = <MobileAudit data={data} ui={ui} />;
  } else if (route === "systemSettings") {
    content = settingsSection ? <div className="content mSubContent"><div className="settingsPage"><SystemConfigPanel data={data} action={action} ui={ui} section={settingsSection} /></div></div>
        : <MobileSettingsIndex data={data} onOpen={setSubPage} />;
  } else {
    content = <MobileMarket data={data} action={action} ui={ui} />;
  }

  const headerRight = subPage
    ? <button className="mBack" onClick={() => setSubPage("")} aria-label="返回"><ChevronLeft size={19} /></button>
    : route === "chat"
      ? <span className={`mRunBadge ${autoOn ? "on" : "off"}`}><span className="pulseDot" />{autoOn ? "运行中" : "已暂停"}</span>
      : <button className="mKill" onClick={() => setKillConfirm(true)}><Zap size={13} /> {data.system?.killSwitch ? "解除熔断" : "熔断"}</button>;

  return (
    <div className="mShell2">
      <MobileHeader route={route} onMenu={() => setDrawer(true)} right={headerRight} reconnecting={Boolean(connectionError)} />
      <main className={`mMain2 ${route === "chat" && !subPage ? "mMainChat" : ""}`}>{content}</main>
      <NavDrawer open={drawer} route={route} onNavigate={navigate} onClose={() => setDrawer(false)} data={data} />
      {killConfirm && <KillConfirmDialog enable={!data.system?.killSwitch} action={action} onClose={() => setKillConfirm(false)} />} {/* 已熔断时应走解除流程(审计 L5) */}
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> 执行中</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
