import React, { useEffect, useRef, useState } from "react";
import { Sparkles, X, Bot, Send, Radar, ShieldCheck, ListChecks, ClipboardList, Gauge, RefreshCw, AlertTriangle, ChevronRight } from "lucide-react";
import { apiUrl, authHeaders, displayMoney, hhmmCn } from "./lib.jsx";
import { getLang, t } from "./i18n.js";

/* ————— 轻量 Markdown 渲染（自包含，无第三方依赖）—————
   支持：标题(# / 【】)、加粗、行内代码、无序/有序列表、引用、键值、分隔线、段落。
   连续列表项会合并成一个 <ul>/<ol>，避免每条都单独成块。 */
function renderInline(text = "") {
  const nodes = [];
  let rest = String(text);
  let key = 0;
  const re = /(\*\*[^*]+\*\*)|(`[^`]+`)/;
  let m = rest.match(re);
  while (m) {
    if (m.index > 0) nodes.push(<React.Fragment key={key++}>{rest.slice(0, m.index)}</React.Fragment>);
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else nodes.push(<code key={key++} className="asstCode">{tok.slice(1, -1)}</code>);
    rest = rest.slice(m.index + tok.length);
    m = rest.match(re);
  }
  if (rest) nodes.push(<React.Fragment key={key++}>{rest}</React.Fragment>);
  return nodes;
}

function renderMarkdown(text = "") {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const blocks = [];
  let list = null; // { ordered, items: [] }
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flush(); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flush(); blocks.push({ hr: true }); continue; }
    if (/^\s*`{3,}[a-zA-Z0-9_-]*\s*$/.test(line)) { continue; } // 吞掉裸代码围栏 ```
    const head = line.match(/^\s*#{1,4}\s+(.+)$/) || line.match(/^\s*【(.+?)】[:：]?\s*$/);
    if (head) { flush(); blocks.push({ h: head[1] }); continue; }
    const ol = line.match(/^\s*\d+[.)、]\s+(.+)$/);
    if (ol) { if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; } list.items.push(ol[1]); continue; }
    const ul = line.match(/^\s*[-*•·]\s+(.+)$/);
    if (ul) { if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; } list.items.push(ul[1]); continue; }
    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) { flush(); blocks.push({ quote: quote[1] }); continue; }
    const kv = line.match(/^\s*([^：:*`#]{1,10})[：:]\s+(.+)$/);
    if (kv) { flush(); blocks.push({ k: kv[1], v: kv[2] }); continue; }
    flush(); blocks.push({ p: line.trim() });
  }
  flush();
  return blocks.map((b, i) => {
    if (b.hr) return <hr key={i} className="asstHr" />;
    if (b.h != null) return <div className="asstH" key={i}>{renderInline(b.h)}</div>;
    if (b.quote != null) return <blockquote className="asstQuote" key={i}>{renderInline(b.quote)}</blockquote>;
    if (b.k != null) return <div className="asstKvRow" key={i}><b>{b.k}</b><span>{renderInline(b.v)}</span></div>;
    if (b.items) {
      const Tag = b.ordered ? "ol" : "ul";
      return <Tag className="asstList" key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</Tag>;
    }
    return <p key={i}>{renderInline(b.p)}</p>;
  });
}

// 打字机：仅对最新一条 assistant 消息启用，逐段揭示，给"流式"观感（后端返回是整段）。
function useTypewriter(text, enabled, onTick) {
  const [shown, setShown] = useState(enabled ? 0 : text.length);
  useEffect(() => {
    if (!enabled) { setShown(text.length); return undefined; }
    setShown(0);
    let n = 0;
    const step = Math.max(2, Math.round(text.length / 90)); // 总时长约 1.5s 上限
    const timer = setInterval(() => {
      n = Math.min(text.length, n + step);
      setShown(n);
      onTick?.();
      if (n >= text.length) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [text, enabled]);
  return enabled ? text.slice(0, shown) : text;
}

function AssistantBubble({ msg, streaming, onTick }) {
  const shown = useTypewriter(msg.content, streaming, onTick);
  if (msg.role === "user") return <div className="asstMsg user"><div className="asstBubble user">{msg.content}</div></div>;
  return (
    <div className="asstMsg bot">
      <span className="asstMsgAvatar"><Bot size={13} /></span>
      <div className="asstBubble bot asstSummary">
        {renderMarkdown(shown)}
        {streaming && shown.length < msg.content.length && <span className="asstCaret" />}
      </div>
    </div>
  );
}

// 本地把真实异动数据拼成播报（不经 LLM，杜绝编造；无数据如实说未同步）。
function moversBroadcast(data) {
  const mv = data.marketMovers;
  const list = mv?.movers || [];
  if (!mv) return "**全市场异动**\n\n暂无扫描数据。系统巡检时会自动扫描 OKX 全量永续（按当日涨幅+成交额），稍后再来看。";
  if (!list.length) return `**全市场异动**（截至 ${hhmmCn(mv.scannedAt)}）\n\n本轮未筛出达标异动币（涨跌幅/成交额未过门槛）。${mv.error ? `\n\n> 扫描提示：${mv.error}` : ""}`;
  const rows = list.slice(0, 8).map((t) => {
    const dir = t.changePct >= 0 ? "+" : "";
    const vol = t.quoteVolUsdt >= 1e8 ? `${(t.quoteVolUsdt / 1e8).toFixed(1)}亿U` : `${Math.round(t.quoteVolUsdt / 1e6)}百万U`;
    const narr = t.narrative?.narrative ? ` — ${t.narrative.narrative}` : "";
    return `- **${t.symbol}** ${dir}${t.changePct}% · 成交 ${vol}${narr}`;
  }).join("\n");
  return `**全市场异动**（截至 ${hhmmCn(mv.scannedAt)}，仅供理解大盘情绪与轮动，不是追涨信号）\n\n${rows}\n\n> 只在你的授权白名单内交易；异动仅作环境感知。`;
}

function escortBroadcast(data) {
  const e = data.positionEscort;
  if (!e) return "**持仓护航**\n\n护航尚未运行（有持仓时系统巡检会自动做实时新闻+防守复检）。";
  if (e.note && !(e.positions || []).length) return `**持仓护航**\n\n${e.note}。`;
  const alerts = e.alerts || [];
  const head = e.overall
    ? `**持仓护航**（${e.source === "gemini" ? "含消息面" : "纯行情"}，截至 ${hhmmCn(e.at)}）\n\n${e.overall}\n`
    : `**持仓护航**（截至 ${hhmmCn(e.at)}）\n`;
  if (e.error) return `${head}\n> 消息面归因暂不可用：${e.error}`;
  if (!alerts.length) return `${head}\n当前 ${(e.positions || []).length} 个持仓，暂无护航告警。`;
  const rows = alerts.map((a) => {
    const tag = a.level === "danger" ? "🔴" : a.level === "warn" ? "🟠" : "🟢";
    const news = a.newsImpact && a.newsImpact !== "无" ? ` · 消息面：${a.newsImpact}` : "";
    return `- ${tag} **${a.symbol}**：${a.advice}${news}`;
  }).join("\n");
  return `${head}\n${rows}\n\n> 护航只给建议与告警，任何减仓/平仓仍走风控与授权流程，绝不自动裸下单。`;
}

// 复盘播报(原「复盘与优化」页下架后由助手承接;全部真实数据,缺数据如实说)。
function reviewBroadcast(data) {
  const perf = data.performance || {};
  const reviews = data.reviews || [];
  const riskChecks = data.riskChecks || [];
  const agentRuns = data.agentRuns || [];
  const paper = data.paperReport || {};
  const blocked = riskChecks.filter((c) => ["blocked", "rejected", "risk_rejected"].includes(String(c.decision || c.result || c.status || "").toLowerCase())).length;
  const failedRuns = agentRuns.filter((r) => ["failed", "error"].includes(String(r.status || "").toLowerCase())).length;
  const lines = ["**复盘与优化**", ""];
  lines.push("### 收益质量");
  lines.push(perf.trades
    ? `- 已平仓 **${perf.trades}** 笔 · 胜率 **${perf.winRatePct}%** · 盈亏比 **${perf.profitFactor ?? "未计算"}**`
    : "- 暂无已平仓交易,先完成最小交易闭环(模拟盘或小额灰度)");
  if (perf.openExecutions) lines.push(`- 在途执行 ${perf.openExecutions} 个`);
  const sessions = paper.sessions || [];
  if (sessions.length) lines.push(`- 模拟盘会话 ${sessions.length} 个(纯前向,技能上岗的必经关卡)`);
  lines.push("", "### 优化建议(按真实数据生成)");
  lines.push(blocked ? `- 近期 **${blocked}** 次风控阻断:优先复盘入场、止损与授权边界` : "- 近期无明显风控阻断 ✅");
  lines.push(failedRuns ? `- **${failedRuns}** 次 Agent 运行失败:检查模型/工具/网络配置` : "- Agent 运行链路无失败集中点 ✅");
  if (perf.trades) lines.push("- 可继续按策略/品种拆分表现,定位优势场景");
  if (reviews.length) {
    lines.push("", `### 最近复盘(${reviews.length} 条)`);
    reviews.slice(0, 3).forEach((r) => lines.push(`- ${String(r.summary || r.note || "复盘记录").slice(0, 60)}`));
  }
  lines.push("", "> 每次平仓系统会自动复盘并沉淀进改进闭环;想深挖某笔交易直接问我。");
  return lines.join("\n");
}

function todosBroadcast(data) {
  const awaiting = (data.tradePlans || []).filter((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status));
  const pending = (data.pendingActions || []).filter((a) => !a.status || a.status === "pending" || a.status === "awaiting_confirmation");
  const incidents = (data.riskIncidents || []).filter((i) => i.status === "open");
  if (!awaiting.length && !pending.length && !incidents.length) return "**待办清单**\n\n当前没有待处理事项 ✅";
  const lines = ["**待办清单**", ""];
  if (awaiting.length) { lines.push(`### 待批准计划（${awaiting.length}）`); awaiting.slice(0, 6).forEach((p) => lines.push(`- ${p.symbol || "?"} · ${p.direction === "short" ? "做空" : "做多"} · ${p.status}`)); lines.push(""); }
  if (pending.length) { lines.push(`### 待确认操作（${pending.length}）`); pending.slice(0, 6).forEach((a) => lines.push(`- ${a.title || a.type || a.action || "操作"}`)); lines.push(""); }
  if (incidents.length) { lines.push(`### 未处理风险告警（${incidents.length}）`); incidents.slice(0, 6).forEach((i) => lines.push(`- ${i.title || i.source || "告警"}`)); }
  return lines.join("\n");
}

// 悬浮系统客服：版本化产品知识 + 当前页面上下文 + 只读诊断证据。
export function AssistantWidget({ data, ui, currentPage = "" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);       // { id, role, content }
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [digestOpen, setDigestOpen] = useState(true);
  const [streamId, setStreamId] = useState(null);      // 正在打字机揭示的消息 id
  const scrollRef = useRef(null);
  const idRef = useRef(0);

  const pf = data.portfolio || {};
  const sys = data.system || {};
  const positions = data.positions || [];
  const awaiting = (data.tradePlans || []).filter((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status)).length;
  const pending = (data.pendingActions || []).filter((a) => !a.status || a.status === "pending" || a.status === "awaiting_confirmation").length;
  const incidents = (data.riskIncidents || []).filter((i) => i.status === "open").length;
  const todoTotal = awaiting + pending + incidents;
  const autonomyLabel = sys.killSwitch ? t("紧急停止中", "Emergency stop active") : sys.autonomyEnabled ? t("自主运行中", "Autonomous") : t("已暂停", "Paused");
  // 主动提醒:未处理的高危/严重风险事件(逼近强平/缺止损/对账不符等)。按标题折叠去重,避免同类刷屏。
  const criticalIncidents = (data.riskIncidents || []).filter((i) => i.status === "open" && ["critical", "high"].includes(String(i.severity || "").toLowerCase()));
  const criticalGroups = [];
  for (const i of criticalIncidents) { const k = i.title || i.source || "风险告警"; const g = criticalGroups.find((x) => x.key === k); if (g) g.count += 1; else criticalGroups.push({ key: k, count: 1 }); }
  // 新鲜度:取最新账户快照/组合同步时间,如实反映数据"截至"何时
  const asOf = data.accountSnapshots?.[0]?.createdAt || pf.updatedAt || data.marketMovers?.scannedAt || null;
  const go = (page) => { ui?.setActive?.(page); setOpen(false); };
  const goIncidents = () => { ui?.openPanel?.("riskIncidents"); setOpen(false); };

  const digestRows = [
    [t("账户", "Account"), pf.totalEquityUsdt != null ? `${displayMoney(pf.totalEquityUsdt, 0)} U · ${t("持仓", "Pos")} ${positions.length}` : t("未同步", "Not synced"), () => go("cockpit")],
    [t("今日盈亏", "Today PnL"), pf.todayPnl != null ? `${pf.todayPnl >= 0 ? "+" : ""}${displayMoney(pf.todayPnl, 2)} U` : t("未同步", "Not synced"), null],
    [t("自主", "Autonomy"), `${autonomyLabel} · ${t("实盘", "Live")}${sys.liveTradingEnabled ? t("开", " on") : t("关", " off")}`, () => go("riskCenter")],
    [t("待办", "To-do"), `${t("批准", "Approve")} ${awaiting} · ${t("确认", "Confirm")} ${pending} · ${t("告警", "Alerts")} ${incidents}`, todoTotal ? () => go("cockpit") : null]
  ];

  const scrollToBottom = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { if (open) scrollToBottom(); }, [messages, open]);

  function pushBot(content, { stream = true } = {}) {
    const id = `a${idRef.current++}`;
    setMessages((prev) => [...prev, { id, role: "assistant", content }]);
    setStreamId(stream ? id : null);
    return id;
  }
  function pushUser(content) {
    const id = `u${idRef.current++}`;
    setMessages((prev) => [...prev, { id, role: "user", content }]);
    return id;
  }

  // 本地播报：真实数据即时渲染，不占 LLM 额度、不会编造。
  function broadcast(kind) {
    if (sending) return;
    const map = {
      review: [t("复盘与优化", "Review & optimize"), reviewBroadcast(data)],
      movers: [t("今日全市场异动", "Today's movers"), moversBroadcast(data)],
      escort: [t("持仓护航播报", "Position escort"), escortBroadcast(data)],
      todos: [t("待办清单", "To-do list"), todosBroadcast(data)]
    };
    const [q, md] = map[kind];
    pushUser(q);
    pushBot(md);
  }

  async function summarize() {
    if (sending) return;
    pushUser(t("总结一下当前系统状态","Summarize the current system status"));
    setSending(true);
    try {
      const res = await fetch(apiUrl("/api/assistant/summarize"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      const json = await res.json().catch(() => ({}));
      pushBot(json.summary || t("未能生成摘要，请稍后再试。","Could not generate a summary, please try again later."));
    } catch {
      pushBot(t("摘要服务暂时不可用，请稍后再试。","Summary service is temporarily unavailable, please try again later."));
    } finally {
      setSending(false);
    }
  }

  // 自由问答：走【只读助手】专属端点——只读账户/行情/知识回答，不下单、不写入 AI 交易员的会话历史。
  async function ask(text) {
    const q = String(text || "").trim();
    if (!q || sending) return;
    pushUser(q);
    setInput("");
    setSending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(apiUrl("/api/assistant/chat"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: q, pageContext: { page: currentPage, language: getLang() } }),
        signal: controller.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { pushBot(`${t("抱歉，出错了","Sorry, an error occurred")}：${json.error || res.status}`); return; }
      const cite = json.citations?.length ? `\n\n> ${t("回答依据","Evidence")}：${json.citations.slice(0, 4).join("、")}` : "";
      pushBot((json.reply || t("（未返回内容）","(no content returned)")) + cite);
    } catch (err) {
      pushBot(err.name === "AbortError" ? t("这次思考超时了，请重试或换个更聚焦的问题。","This took too long — please retry or ask a more focused question.") : t("网络异常，请稍后重试。","Network error, please try again later."));
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }

  const quick = [
    { k: "summary", label: t("总结状态","Status"), icon: Gauge, on: summarize },
    { k: "review", label: t("复盘","Review"), icon: ClipboardList, on: () => broadcast("review") },
    { k: "movers", label: t("今日异动","Movers"), icon: Radar, on: () => broadcast("movers") },
    { k: "escort", label: t("持仓护航","Escort"), icon: ShieldCheck, on: () => broadcast("escort") },
    { k: "todos", label: t("待办","To-do"), icon: ListChecks, on: () => broadcast("todos") }
  ];

  return (
    <>
      <button className={`asstFab ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)} title={t("系统客服", "Product Support")} aria-label={t("系统客服", "Product Support")}>
        {open ? <X size={20} /> : <Sparkles size={20} />}
        {!open && todoTotal > 0 && <span className="asstBadge">{todoTotal}</span>}
      </button>
      {open && (
        <div className="asstDrawer" role="dialog" aria-label={t("系统客服", "Product Support")}>
          <div className="asstHead">
            <span className="asstAvatar"><Bot size={16} /></span>
            <div className="asstHeadText"><b>{t("系统客服","Product Support")}</b><small>{t("懂功能 · 会排障 · 只读不操作 · 数据截至","Product help · diagnostics · read-only · data as of")} {asOf ? hhmmCn(asOf) : t("未同步","N/A")}</small></div>
            <button className="asstIconBtn" onClick={() => setDigestOpen((v) => !v)} title={digestOpen ? t("收起概览","Collapse") : t("展开概览","Expand")}><Gauge size={15} /></button>
            <button className="asstClose" onClick={() => setOpen(false)} aria-label="关闭"><X size={16} /></button>
          </div>

          {digestOpen && (
            <div className="asstDigest">
              {digestRows.map(([k, v, onClick]) => <div className={`asstRow ${onClick ? "clickable" : ""}`} key={k} onClick={onClick || undefined}><span>{k}</span><b className="mono">{v}</b>{onClick && <ChevronRight size={12} className="asstRowGo" />}</div>)}
            </div>
          )}

          {criticalIncidents.length > 0 && (
            <div className="asstAlerts">
              <div className="asstAlertHead"><AlertTriangle size={13} /> {criticalIncidents.length} {t("项待处理风险","open risks")}</div>
              {criticalGroups.slice(0, 1).map((g) => <button key={g.key} className="asstAlertRow" onClick={goIncidents}><span>{g.key}{g.count > 1 ? ` ×${g.count}` : ""}</span><ChevronRight size={13} /></button>)}
              <button className="asstAlertMore" onClick={goIncidents}>{t("去处理","Resolve")} {criticalIncidents.length} ›</button>
            </div>
          )}

          <div className="asstQuick">
            {quick.map((q) => <button key={q.k} className="asstChip" disabled={sending} onClick={q.on}><q.icon size={12} /> {q.label}</button>)}
          </div>

          <div className="asstScroll" ref={scrollRef}>
            {!messages.length && (
              <div className="asstWelcome">
                <b>{t("我是系统内置客服，帮你理解功能和排查问题", "I'm the built-in product support assistant for features and troubleshooting")}</b>
                <p>{t("可以问我：这个状态是什么意思、某项设置在哪里、为什么被风控阻止、OKX 是否真的有委托、某个数据截至什么时候。", "Ask what a status means, where a setting lives, why a risk check blocked, whether an OKX order really exists, or how fresh a data point is.")}</p>
                <p className="asstHint">{t("我的回答基于当前版本说明和只读诊断证据；", "Answers are grounded in the current release and read-only diagnostics. ")}<b>{t("不下单、不改授权、不读取密钥原文", "I never trade, change mandates, or read secret values")}</b>{t("。", ".")}</p>
              </div>
            )}
            {messages.map((m) => (
              <AssistantBubble key={m.id} msg={m} streaming={m.id === streamId && m.role === "assistant"} onTick={scrollToBottom} />
            ))}
            {sending && <div className="asstMsg bot"><span className="asstMsgAvatar"><Bot size={13} /></span><div className="asstBubble bot asstTyping"><i /><i /><i /></div></div>}
          </div>

          <form className="asstInputBar" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={sending ? t("正在查证…","Checking…") : t("询问功能、状态、设置或故障","Ask about a feature, status, setting, or issue")}
              disabled={sending}
            />
            <button type="submit" className="asstSend" disabled={sending || !input.trim()} aria-label="发送">
              {sending ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
