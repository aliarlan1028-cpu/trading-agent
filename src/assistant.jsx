import React, { useEffect, useRef, useState } from "react";
import { Sparkles, X, Bot, Send, Radar, ShieldCheck, ListChecks, ClipboardList, Gauge, RefreshCw } from "lucide-react";
import { apiUrl, authHeaders, displayMoney } from "./lib.jsx";

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
  if (!list.length) return `**全市场异动**（截至 ${(mv.scannedAt || "").slice(11, 16) || "?"}）\n\n本轮未筛出达标异动币（涨跌幅/成交额未过门槛）。${mv.error ? `\n\n> 扫描提示：${mv.error}` : ""}`;
  const rows = list.slice(0, 8).map((t) => {
    const dir = t.changePct >= 0 ? "+" : "";
    const vol = t.quoteVolUsdt >= 1e8 ? `${(t.quoteVolUsdt / 1e8).toFixed(1)}亿U` : `${Math.round(t.quoteVolUsdt / 1e6)}百万U`;
    const narr = t.narrative?.narrative ? ` — ${t.narrative.narrative}` : "";
    return `- **${t.symbol}** ${dir}${t.changePct}% · 成交 ${vol}${narr}`;
  }).join("\n");
  return `**全市场异动**（截至 ${(mv.scannedAt || "").slice(11, 16) || "?"}，仅供理解大盘情绪与轮动，不是追涨信号）\n\n${rows}\n\n> 只在你的授权白名单内交易；异动仅作环境感知。`;
}

function escortBroadcast(data) {
  const e = data.positionEscort;
  if (!e) return "**持仓护航**\n\n护航尚未运行（有持仓时系统巡检会自动做实时新闻+防守复检）。";
  if (e.note && !(e.positions || []).length) return `**持仓护航**\n\n${e.note}。`;
  const alerts = e.alerts || [];
  const head = e.overall
    ? `**持仓护航**（${e.source === "gemini" ? "含消息面" : "纯行情"}，截至 ${(e.at || "").slice(11, 16)}）\n\n${e.overall}\n`
    : `**持仓护航**（截至 ${(e.at || "").slice(11, 16)}）\n`;
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

// 悬浮 AI 助手：自由问答（走真实工具链 Agent）+ 一键摘要/异动/护航/待办播报。
export function AssistantWidget({ data }) {
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
  const autonomyLabel = sys.killSwitch ? "已熔断" : sys.autonomyEnabled ? "自主运行中" : "已暂停";

  const digestRows = [
    ["账户", pf.totalEquityUsdt != null ? `${displayMoney(pf.totalEquityUsdt, 0)} U · 持仓 ${positions.length}` : "未同步"],
    ["今日盈亏", pf.todayPnl != null ? `${pf.todayPnl >= 0 ? "+" : ""}${displayMoney(pf.todayPnl, 2)} U` : "未同步"],
    ["自主", `${autonomyLabel} · 实盘${sys.liveTradingEnabled ? "开" : "关"}`],
    ["待办", `批准 ${awaiting} · 确认 ${pending} · 告警 ${incidents}`]
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
      review: ["复盘与优化", reviewBroadcast(data)],
      movers: ["今日全市场异动", moversBroadcast(data)],
      escort: ["持仓护航播报", escortBroadcast(data)],
      todos: ["待办清单", todosBroadcast(data)]
    };
    const [q, md] = map[kind];
    pushUser(q);
    pushBot(md);
  }

  async function summarize() {
    if (sending) return;
    pushUser("总结一下当前系统状态");
    setSending(true);
    try {
      const res = await fetch(apiUrl("/api/assistant/summarize"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      const json = await res.json().catch(() => ({}));
      pushBot(json.summary || "未能生成摘要，请稍后再试。");
    } catch {
      pushBot("摘要服务暂时不可用，请稍后再试。");
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
        body: JSON.stringify({ message: q }),
        signal: controller.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { pushBot(`抱歉，出错了：${json.error || res.status}`); return; }
      const cite = json.citations?.length ? `\n\n> 参考知识：${json.citations.slice(0, 3).join("、")}` : "";
      pushBot((json.reply || "（未返回内容）") + cite);
    } catch (err) {
      pushBot(err.name === "AbortError" ? "这次思考超时了，请重试或换个更聚焦的问题。" : "网络异常，请稍后重试。");
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }

  const quick = [
    { k: "summary", label: "总结状态", icon: Gauge, on: summarize },
    { k: "review", label: "复盘", icon: ClipboardList, on: () => broadcast("review") },
    { k: "movers", label: "今日异动", icon: Radar, on: () => broadcast("movers") },
    { k: "escort", label: "持仓护航", icon: ShieldCheck, on: () => broadcast("escort") },
    { k: "todos", label: "待办", icon: ListChecks, on: () => broadcast("todos") }
  ];

  return (
    <>
      <button className={`asstFab ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)} title="AI 助手" aria-label="AI 助手">
        {open ? <X size={20} /> : <Sparkles size={20} />}
        {!open && todoTotal > 0 && <span className="asstBadge">{todoTotal}</span>}
      </button>
      {open && (
        <div className="asstDrawer" role="dialog" aria-label="AI 助手">
          <div className="asstHead">
            <span className="asstAvatar"><Bot size={16} /></span>
            <div className="asstHeadText"><b>AI 助手</b><small>只读 · 解读账户/行情/知识（不下单）</small></div>
            <button className="asstIconBtn" onClick={() => setDigestOpen((v) => !v)} title={digestOpen ? "收起概览" : "展开概览"}><Gauge size={15} /></button>
            <button className="asstClose" onClick={() => setOpen(false)} aria-label="关闭"><X size={16} /></button>
          </div>

          {digestOpen && (
            <div className="asstDigest">
              {digestRows.map(([k, v]) => <div className="asstRow" key={k}><span>{k}</span><b className="mono">{v}</b></div>)}
            </div>
          )}

          <div className="asstQuick">
            {quick.map((q) => <button key={q.k} className="asstChip" disabled={sending} onClick={q.on}><q.icon size={12} /> {q.label}</button>)}
          </div>

          <div className="asstScroll" ref={scrollRef}>
            {!messages.length && (
              <div className="asstWelcome">
                <b>我是你的只读助手，帮你看懂系统</b>
                <p>例如「现在该不该减仓？」「BTC 现在的结构怎么样？」「知识库里关于 CPI 怎么控仓？」——我会读真实账户、行情和知识库来解读。</p>
                <p className="asstHint">我只做解读与建议，<b>不下单、不改配置</b>；要执行交易/改授权，请去主页的「AI 交易员」对话。</p>
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
              placeholder={sending ? "思考中…" : "问我关于账户 / 行情 / 知识的问题"}
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
