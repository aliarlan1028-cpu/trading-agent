import {
  Activity,
  Bot,
  BrainCircuit,
  ChevronRight,
  CircleUserRound,
  Home,
  Layers3,
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
  WalletCards
} from "lucide-react";
import { t } from "./i18n.js";
import { localizeText } from "./lib.jsx";
import { buildZeroBaseTodayModel } from "./zeroBaseToday.jsx";
import { mobileFamily, mobileFamilyDestinations, mobileRootFamilies, MOBILE_PRIMARY_NAV } from "./mobileNavigation.js";
import "./zero-base-mobile.css";

const rootIcons = { today: Home, ai: Bot, assets: WalletCards, intelligent: Sparkles, more: MoreHorizontal };
const familyIcons = {
  strategy: Layers3,
  knowledge: Sparkles,
  capability: BrainCircuit,
  reviews: CircleUserRound,
  guard: ShieldCheck,
  operations: Activity,
  configuration: MoreHorizontal
};

const safeListCount = (...values) => {
  const lists = values.filter(Array.isArray);
  return lists.length ? lists.reduce((sum, rows) => sum + rows.length, 0) : "Unavailable";
};

const familyDescription = {
  strategy: ["策略目录、构建与验证证据", "Registry, construction, and validation evidence"],
  knowledge: ["来源、引用、关系与提取产物", "Sources, citations, relationships, and extracted artifacts"],
  capability: ["原生工具、工作流、MCP 与连接器", "Native tools, workflows, MCP, and connectors"],
  reviews: ["交易复盘、候选教训与 Owner 优化", "Trade reviews, candidate lessons, and Owner optimization"],
  guard: ["风险姿态、事件窗口、边界与规则", "Risk posture, event windows, boundaries, and rules"],
  operations: ["健康、任务、恢复、通知与审计", "Health, tasks, recovery, notices, and audit"],
  configuration: ["全部持久配置与权限入口", "Every durable setting and permission entry"]
};

function familyCount(familyId, data = {}) {
  if (familyId === "strategy") return safeListCount(data.strategyCatalog?.products, data.strategyCatalog?.strategies);
  if (familyId === "knowledge") return safeListCount(data.knowledge?.sources);
  if (familyId === "capability") return safeListCount(data.analysisEngine?.tools, data.knowledge?.tradingSkills, data.skills);
  if (familyId === "reviews") return safeListCount(data.reviews);
  if (familyId === "guard") return safeListCount(data.riskIncidents, data.eventRiskWindows);
  if (familyId === "operations") return safeListCount(data.tasks, data.operations?.tasks, data.notifications);
  if (familyId === "configuration") return data.user ? (data.user.isOwner === true ? t("Owner 可用", "Owner access") : t("受限", "Restricted")) : "Unavailable";
  return "Unavailable";
}

export function ZeroBaseMobileFamilyRail({ familyId, viewId, onNavigate }) {
  const family = mobileFamily(familyId);
  const destinations = mobileFamilyDestinations(familyId);
  if (!destinations.length || familyId === "today") return null;
  return <section className="zbMobileFamilyRail" data-zero-base-mobile-local-nav={familyId}>
    <header><small>{family.code} / {family.group}</small><b>{t(family.label, family.labelEn)}</b></header>
    <nav aria-label={`${t(family.label, family.labelEn)} ${t("子页面", "views")}`}>
      {destinations.map((item) => <button type="button" key={item.id} data-zero-base-mobile-view-target={item.id} aria-current={viewId === item.id ? "page" : undefined} onClick={() => onNavigate(familyId, item.id)}>{t(item.label, item.labelEn)}</button>)}
    </nav>
  </section>;
}

export function ZeroBaseMobileToday({ data = {}, onNavigate }) {
  const model = buildZeroBaseTodayModel(data);
  return <section className="zbMobileToday" data-zero-base-mobile-surface="today">
    <article className="zbMobileToday__ai" data-state={model.boundary.state}>
      <header><small>AI TRADER / PRIMARY</small><span>{model.ai.entryPolicy}</span></header>
      <h1>{model.ai.latestTitle}</h1>
      <p>{model.ai.latestSummary}</p>
      <dl><div><dt>{t("当前状态", "State")}</dt><dd>{model.ai.state}</dd></div><div><dt>{t("下一步", "Next")}</dt><dd>{model.ai.nextActions[0] || "Unavailable"}</dd></div></dl>
      <button type="button" onClick={() => onNavigate("ai", "dialog")}><Bot />{t("进入 AI 交易员", "Open AI Trader")}<ChevronRight /></button>
    </article>

    <article className="zbMobileToday__account">
      <header><span><WalletCards /><small>ACCOUNT TRUTH</small></span><button type="button" onClick={() => onNavigate("portfolio", "overview")}>{t("全部", "All")}<ChevronRight /></button></header>
      <strong>{model.account.totalEquity}</strong><small>{t("账户净值", "Account equity")}</small>
      <dl><div><dt>{t("今日盈亏", "Today PnL")}</dt><dd>{model.account.todayPnl}</dd></div><div><dt>{t("可用保证金", "Available")}</dt><dd>{model.account.availableMargin}</dd></div><div><dt>{t("持仓", "Positions")}</dt><dd>{model.account.positions}</dd></div></dl>
    </article>

    <article className="zbMobileToday__network">
      <header><small>INTELLIGENT ASSET NETWORK</small><b>{t("AI 正在使用的系统资产", "System assets available to AI")}</b></header>
      <div>{[["strategy",t("策略", "Strategy"),model.assets.strategy],["knowledge",t("知识", "Knowledge"),model.assets.knowledge],["capability",t("能力", "Capability"),model.assets.capability],["reviews",t("复盘", "Reviews"),model.assets.reviews]].map(([family,label,value]) => <button type="button" key={family} onClick={() => onNavigate(family)}><span><small>{label}</small><b>{value}</b></span><ChevronRight /></button>)}</div>
    </article>

    <article className="zbMobileToday__attention">
      <header><small>ATTENTION</small><b>{t("需要处理", "Needs attention")}</b><span>{model.attention.length}</span></header>
      {model.attention.length ? model.attention.slice(0, 5).map((item) => <button type="button" key={`${item.type}:${item.id}`} data-tone={item.tone} onClick={() => onNavigate(null, null, item.route)}><span><b>{localizeText(item.title)}</b><small>{item.type} · {item.detail}</small></span><ChevronRight /></button>) : <p>{t("当前没有待处理事项。", "There are no pending items right now.")}</p>}
    </article>
  </section>;
}

export function ZeroBaseMobileHub({ rootId, data = {}, onFamilyNavigate, lang, switchLang }) {
  const families = mobileRootFamilies(rootId);
  const title = rootId === "intelligent" ? t("智能资产网络", "Intelligent asset network") : t("系统治理与配置", "System governance & configuration");
  const subtitle = rootId === "intelligent"
    ? t("策略、知识、能力和复盘不是孤岛；它们共同成为 AI 判断与执行的上下文。", "Strategy, knowledge, capability, and reviews form the context for AI decisions and execution.")
    : t("风险边界、系统运行和持久配置各自独立，但共享同一真实状态。", "Risk boundaries, operations, and durable configuration stay distinct while sharing one source of truth.");
  return <section className={`zbMobileHub zbMobileHub--${rootId}`} data-zero-base-mobile-surface={`${rootId}-hub`}>
    <header><small>{rootId === "intelligent" ? "INTELLIGENT NETWORK" : "SYSTEM CONTROL"}</small><h1>{title}</h1><p>{subtitle}</p></header>
    <div className="zbMobileHub__families">
      {families.map((family) => { const Icon = familyIcons[family.id] || Layers3; const desc = familyDescription[family.id] || ["", ""]; return <button type="button" key={family.id} data-zero-base-mobile-family-target={family.id} onClick={() => onFamilyNavigate(family.id, family.defaultView)}><i><Icon /></i><span><small>{family.code} / {family.group}</small><b>{t(family.label, family.labelEn)}</b><em>{t(desc[0], desc[1])}</em></span><strong>{familyCount(family.id, data)}</strong><ChevronRight /></button>; })}
    </div>
    {rootId === "more" && switchLang && <footer><span>{t("界面语言", "Interface language")}</span><div role="group" aria-label={t("切换语言", "Switch language")}><button type="button" aria-pressed={lang === "zh"} onClick={() => switchLang("zh")}>中文</button><button type="button" aria-pressed={lang === "en"} onClick={() => switchLang("en")}>English</button></div></footer>}
  </section>;
}

export function ZeroBaseMobileShell({
  rootId,
  familyId,
  viewId,
  runtime,
  reconnecting = false,
  onRootNavigate,
  onOpenSafety,
  children,
  shellTools,
  selection = null,
  overlays = null
}) {
  const family = familyId ? mobileFamily(familyId) : null;
  const root = MOBILE_PRIMARY_NAV.find((item) => item.id === rootId) || MOBILE_PRIMARY_NAV[0];
  const title = family ? t(family.label, family.labelEn) : t(root.label[0], root.label[1]);
  return <div className="mShell2 kordynSystem zeroBaseProduct zeroBaseMobile" data-zero-base-shell="mobile" data-zero-base-mobile-root={rootId} data-zero-base-mobile-family={familyId || "hub"} data-zero-base-mobile-view={viewId || "hub"} data-shell-route={selection?.route || "none"} data-shell-subpage={selection?.subPage || "none"} data-shell-selected-object={selection?.object?.id || "none"} data-shell-selected-type={selection?.object?.type || "none"} data-shell-selected-workspace={selection?.object?.workspaceId || "none"} data-shell-selected-source={selection?.object?.sourceSection || "none"} data-shell-selected-route={selection?.object?.route || "none"} data-shell-selected-evidence={selection?.object?.evidence || "Unavailable"}>
    <header className="mHeader2 zbMobileHeader" data-shell-role="mobile-command">
      <button type="button" className="zbMobileHeader__brand" onClick={() => onRootNavigate("today")} aria-label={t("返回今日", "Open Today")}><img src="/kordyn-logo.svg" alt="" /></button>
      <div><small>{family ? `${family.code} / ${family.group}` : rootId.toUpperCase()}</small><b>{title}</b></div>
      <button type="button" className={`zbMobileHeader__runtime ${runtime?.tone || "neutral"}`} onClick={onOpenSafety}><i />{reconnecting ? t("重连中", "Reconnecting") : runtime?.label || "Unavailable"}</button>
    </header>
    {children}
    {shellTools}
    <nav className="mNativeTabbar zbMobileTabbar" aria-label={t("主导航", "Primary navigation")}>
      {MOBILE_PRIMARY_NAV.map((item) => { const Icon = rootIcons[item.id]; const active = item.id === rootId; return <button type="button" key={item.id} data-zero-base-mobile-root-target={item.id} aria-current={active ? "page" : undefined} className={active ? "active" : ""} onClick={() => onRootNavigate(item.id)}><Icon /><span>{t(item.label[0], item.label[1])}</span></button>; })}
    </nav>
    {overlays}
  </div>;
}
