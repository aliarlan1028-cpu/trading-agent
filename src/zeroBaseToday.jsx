import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Layers3,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { t } from "./i18n.js";
import { automationPresentation, displayMoney, localizeText } from "./lib.jsx";

const unavailable = "Unavailable";
const asList = (value) => Array.isArray(value) ? value : null;

function countLists(...values) {
  const present = values.filter(Array.isArray);
  return present.length ? present.reduce((sum, rows) => sum + rows.length, 0) : unavailable;
}

function money(value, { signed = false } = {}) {
  if (value === undefined || value === null || value === "" || !Number.isFinite(Number(value))) return unavailable;
  const amount = Number(value);
  return `${signed && amount > 0 ? "+" : ""}${displayMoney(amount, 2, unavailable)} USDT`;
}

function roleFor(data) {
  const role = String(data?.user?.role || "").toLowerCase();
  return data?.user?.isOwner === true || role === "owner" || role === "admin" ? "owner" : "trader";
}

function attentionRows(data) {
  const rows = [];
  for (const item of asList(data.tradePlans) || []) {
    if (["awaiting_approval", "risk_checked", "draft"].includes(String(item.status || "").toLowerCase())) {
      rows.push({ id: item.id, type: "plan", title: item.title || item.symbol || item.id, detail: item.status, route: "executionReview", tone: "action" });
    }
  }
  for (const item of asList(data.pendingActions) || []) {
    if (!item.status || ["pending", "awaiting_confirmation"].includes(String(item.status).toLowerCase())) {
      rows.push({ id: item.id, type: "action", title: item.title || item.type || item.action || item.id, detail: item.status || "pending", route: item.route || "chat", tone: "action" });
    }
  }
  for (const item of asList(data.riskIncidents) || []) {
    if (String(item.status || "").toLowerCase() === "open") {
      rows.push({ id: item.id, type: "risk", title: item.title || item.source || item.id, detail: item.severity || item.status, route: "riskCenter", tone: "danger" });
    }
  }
  for (const item of asList(data.reviews) || []) {
    if (["pending", "waiting", "required"].includes(String(item.status || "").toLowerCase())) {
      rows.push({ id: item.id, type: "review", title: item.title || item.summary || item.symbol || item.id, detail: item.status, route: "labReviews", tone: "review" });
    }
  }
  return rows;
}

export function buildZeroBaseTodayModel(data = {}) {
  const portfolio = data.portfolio || {};
  const runtime = automationPresentation(data);
  const runs = asList(data.agentRuns);
  const latestRun = runs?.[0] || null;
  const nextActions = asList(data.agentStatus?.nextActions) || asList(latestRun?.nextActions) || [];
  const strategies = data.strategyCatalog || {};
  const role = roleFor(data);
  return {
    role,
    greetingName: localizeText(data.user?.name || (role === "owner" ? "Owner" : "Trader"), role === "owner" ? "Owner" : "Trader"),
    account: {
      totalEquity: money(portfolio.totalEquityUsdt),
      todayPnl: money(portfolio.todayPnl, { signed: true }),
      availableMargin: money(portfolio.availableMarginUsdt),
      positions: asList(data.positions)?.length ?? unavailable
    },
    ai: {
      state: String(data.agentStatus?.state || latestRun?.status || runtime.label || unavailable),
      entryPolicy: runtime.entryPolicy || unavailable,
      target: runtime.targetLabel || unavailable,
      latestTitle: localizeText(latestRun?.title || latestRun?.name || latestRun?.agentName || latestRun?.id, unavailable),
      latestSummary: localizeText(latestRun?.summary || latestRun?.resultSummary || data.agentStatus?.summary, unavailable),
      nextActions
    },
    assets: {
      strategy: countLists(strategies.products, strategies.strategies),
      knowledge: countLists(data.knowledge?.sources),
      capability: countLists(data.analysisEngine?.tools, data.knowledge?.tradingSkills, data.skills),
      reviews: countLists(data.reviews)
    },
    live: {
      watches: asList(data.watchTriggers)?.length ?? (asList(data.watches)?.length ?? unavailable),
      events: asList(data.events)?.length ?? unavailable,
      tasks: asList(data.tasks)?.length ?? unavailable
    },
    attention: attentionRows(data),
    boundary: {
      state: runtime.tone || unavailable,
      label: runtime.label || unavailable,
      detail: runtime.detail || unavailable,
      entryPolicy: runtime.entryPolicy || unavailable
    }
  };
}

function TodayLink({ route, onNavigate, children, className = "" }) {
  return <button type="button" className={`zbTodayLink ${className}`.trim()} onClick={() => onNavigate(route)}>{children}<ArrowUpRight aria-hidden="true" /></button>;
}

export function ZeroBaseToday({ data = {}, onNavigate = () => {}, viewId = "" }) {
  const model = buildZeroBaseTodayModel(data);
  const title = model.role === "owner" ? t("Owner 今日控制面", "Owner control surface") : t("交易今日控制面", "Trader control surface");
  return <section className="zbToday" data-zero-base-today={model.role} data-zero-base-view={viewId || model.role}>
    <header className="zbTodayWelcome">
      <div><span>{t("当前真实状态", "CURRENT REALITY")}</span><h2>{title}</h2><p>{t(`${model.greetingName}，先看 AI 交易员正在做什么，再决定是否介入。`, `${model.greetingName}, see what the AI trader is doing before deciding whether to intervene.`)}</p></div>
      <div className="zbTodayPulse"><i /><span><small>{t("自主系统", "AUTONOMY")}</small><b>{model.ai.state}</b></span></div>
    </header>

    <div className="zbTodayHero">
      <article className="zbTodayAi" data-today-zone="ai-primary" data-state={model.boundary.state}>
        <header><span><Bot aria-hidden="true" /><small>AI TRADER / PRIMARY WORKSITE</small></span><b>{model.ai.entryPolicy}</b></header>
        <div className="zbTodayAi__body">
          <span>{t("当前运行", "RUNNING NOW")}</span>
          <h3>{model.ai.latestTitle}</h3>
          <p>{model.ai.latestSummary}</p>
          <dl>
            <div><dt>{t("系统状态", "SYSTEM STATE")}</dt><dd>{model.ai.state}</dd></div>
            <div><dt>{t("长期目标", "SAVED TARGET")}</dt><dd>{model.ai.target}</dd></div>
            <div><dt>{t("下一步", "NEXT ACTION")}</dt><dd>{model.ai.nextActions[0] || unavailable}</dd></div>
          </dl>
        </div>
        <footer><TodayLink route="chat" onNavigate={onNavigate} className="primary">{t("进入 AI 交易员", "Open AI Trader")}</TodayLink><TodayLink route="watch" onNavigate={onNavigate}>{t("查看盯盘", "Open Watch")}</TodayLink></footer>
      </article>

      <article className="zbTodayAccount" data-today-zone="account">
        <header><span><WalletCards aria-hidden="true" /><small>ACCOUNT TRUTH</small></span><TodayLink route="cockpit" onNavigate={onNavigate}>{t("账户与交易", "Account & Trading")}</TodayLink></header>
        <strong>{model.account.totalEquity}</strong>
        <small>{t("账户实时净值", "Live account equity")}</small>
        <dl>
          <div><dt>{t("今日盈亏", "Today PnL")}</dt><dd>{model.account.todayPnl}</dd></div>
          <div><dt>{t("可用保证金", "Available margin")}</dt><dd>{model.account.availableMargin}</dd></div>
          <div><dt>{t("当前持仓", "Positions")}</dt><dd>{model.account.positions}</dd></div>
        </dl>
        <div className="zbTodayBoundary" data-state={model.boundary.state}><ShieldCheck aria-hidden="true" /><span><b>{model.boundary.label}</b><small>{model.boundary.detail}</small></span></div>
      </article>
    </div>

    <article className="zbTodayAssets" data-today-zone="intelligent-assets">
      <header><div><span>INTELLIGENT ASSET NETWORK</span><h3>{t("策略、知识与能力如何进入 AI 判断", "How strategy, knowledge, and capabilities enter AI decisions")}</h3></div><TodayLink route="researchCenter" onNavigate={onNavigate}>{t("查看全部智能资产", "Open intelligent assets")}</TodayLink></header>
      <div className="zbTodayAssetFlow">
        <button type="button" onClick={() => onNavigate("strategyLib")}><Layers3 /><span><small>{t("策略", "STRATEGY")}</small><b>{model.assets.strategy}</b></span></button>
        <i aria-hidden="true" />
        <button type="button" onClick={() => onNavigate("knowledgeBase")}><BookOpen /><span><small>{t("知识与证据", "KNOWLEDGE")}</small><b>{model.assets.knowledge}</b></span></button>
        <i aria-hidden="true" />
        <button type="button" onClick={() => onNavigate("capabilityLib")}><BrainCircuit /><span><small>{t("可执行能力", "CAPABILITY")}</small><b>{model.assets.capability}</b></span></button>
        <i aria-hidden="true" />
        <button type="button" onClick={() => onNavigate("labReviews")}><CheckCircle2 /><span><small>{t("复盘与学习", "REVIEWS")}</small><b>{model.assets.reviews}</b></span></button>
        <i aria-hidden="true" />
        <span className="zbTodayAssetFlow__ai"><Bot /><small>AI</small></span>
      </div>
    </article>

    <div className="zbTodayLower">
      <article className="zbTodayAttention">
        <header><div><span>ATTENTION QUEUE</span><h3>{model.role === "owner" ? t("需要 Owner 判断的事项", "Items needing Owner judgment") : t("需要你处理的事项", "Items needing your attention")}</h3></div><b>{model.attention.length}</b></header>
        <div>{model.attention.length ? model.attention.slice(0, 8).map((item) => <button type="button" key={`${item.type}:${item.id}`} data-tone={item.tone} onClick={() => onNavigate(item.route)}><i>{item.type === "risk" ? <AlertTriangle /> : item.type === "review" ? <CheckCircle2 /> : <Clock3 />}</i><span><b>{localizeText(item.title)}</b><small>{item.type} · {item.detail}</small></span><ArrowUpRight /></button>) : <p><CheckCircle2 />{t("当前没有待处理事项。", "There are no pending items right now.")}</p>}</div>
      </article>
      <aside className="zbTodayLive">
        <header><Activity /><span><small>LIVE CONTEXT</small><b>{t("正在影响 AI 的实时输入", "Live inputs affecting AI")}</b></span></header>
        <dl><div><dt>{t("盯盘", "Watches")}</dt><dd>{model.live.watches}</dd></div><div><dt>{t("事件", "Events")}</dt><dd>{model.live.events}</dd></div><div><dt>{t("运维任务", "Ops tasks")}</dt><dd>{model.live.tasks}</dd></div></dl>
        <TodayLink route="intelligence" onNavigate={onNavigate}>{t("打开情报", "Open Intelligence")}</TodayLink>
        <TodayLink route="operationsCenter" onNavigate={onNavigate}>{t("打开系统运维", "Open Operations")}</TodayLink>
      </aside>
    </div>
  </section>;
}
