import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  PlugZap,
  Shield,
  Wrench,
  XCircle
} from "lucide-react";
import { displayMoney, displayPct, formatTime, humanize, StatusBadge } from "./lib.jsx";

function authHeaders(extra = {}) {
  const token = localStorage.getItem("agent_token") || "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// 极简 Markdown：**加粗** 与换行，其余原样输出。
function renderText(text = "") {
  return String(text).split("\n").map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={partIndex}>{part.slice(2, -2)}</strong>
        : <React.Fragment key={partIndex}>{part}</React.Fragment>
    );
    return <p key={lineIndex}>{parts}</p>;
  });
}

const EXECUTION_LABELS = {
  dry_run: "干跑完成（实盘关闭）",
  entry_pending: "入场单挂单中",
  entry_filled: "入场已成交",
  protecting: "止盈止损已布置",
  closed: "已平仓",
  cancelled: "已取消",
  blocked: "被安全闸拦截",
  failed: "提交失败"
};

function PlanCard({ plan, executionOrder, action, ui }) {
  if (!plan) return null;
  const risk = plan.lastRiskCheck || {};
  const checks = risk.checks || [];
  const passedCount = checks.filter((check) => check.passed).length;
  const [showChecks, setShowChecks] = useState(false);
  const awaiting = plan.status === "awaiting_approval";
  return (
    <div className={`chatPlanCard ${risk.passed ? "" : "rejected"}`}>
      <header>
        <b>{plan.symbol}</b>
        <span className={plan.direction === "short" ? "negative" : "positive"}>{plan.direction === "short" ? "做空" : "做多"}</span>
        <StatusBadge tone={plan.status === "risk_rejected" ? "danger" : awaiting ? "warning" : "ok"}>{humanize(plan.status)}</StatusBadge>
        <small>{plan.strategy ? humanize(plan.strategy) : ""} {plan.leverage ? `· ${plan.leverage}x` : ""}</small>
      </header>
      <div className="planNumbers">
        <span><small>入场区间</small><b>{plan.entry?.range || "-"}</b></span>
        <span><small>止损</small><b className="negative">{displayMoney(plan.stopLoss)}</b></span>
        <span><small>止盈</small><b className="positive">{(plan.takeProfit || []).map((tp) => displayMoney(tp)).join(" / ") || "-"}</b></span>
        <span><small>单笔风险</small><b>{plan.entry?.riskPercent ?? plan.max_loss_pct ?? "-"}%</b></span>
      </div>
      <button className="riskSummaryRow" onClick={() => setShowChecks((current) => !current)}>
        {risk.passed
          ? <CheckCircle2 size={15} className="positive" />
          : <XCircle size={15} className="negative" />}
        <span>风控 {passedCount}/{checks.length} 通过 · {risk.summary || "未检查"}</span>
        <ChevronDown size={14} style={{ transform: showChecks ? "rotate(180deg)" : "none" }} />
      </button>
      {showChecks && (
        <div className="riskCheckList">
          {checks.map((check) => (
            <div key={check.name} className={check.passed ? "" : "failed"}>
              {check.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              <span>{check.name}</span>
              <small>{check.detail}</small>
            </div>
          ))}
        </div>
      )}
      <footer>
        {awaiting && <button className="approveButton" onClick={() => action(`/api/trade-plans/${plan.id}/approve`, {})}>批准计划</button>}
        {awaiting && <button onClick={() => action(`/api/trade-plans/${plan.id}/cancel`, { reason: "user_rejected" })}>拒绝</button>}
        <button className="ghostButton" onClick={() => ui.openPanel("auditChain")}>审计链 <ChevronRight size={13} /></button>
      </footer>
      {awaiting && <small className="planHint">批准后立即进入执行引擎：按净值与止损距离计算数量、提交入场单并附带保护性止损；实盘写入关闭时只做干跑计算。</small>}
      {executionOrder && (
        <div className="executionStrip">
          <span className={`execDot ${["entry_filled", "protecting"].includes(executionOrder.status) ? "on" : executionOrder.status === "closed" ? "done" : ""}`} />
          <b>{EXECUTION_LABELS[executionOrder.status] || executionOrder.status}</b>
          <small>
            数量 {executionOrder.quantity} · 名义 {displayMoney(executionOrder.notionalUsdt)} USDT
            {executionOrder.filledPrice ? ` · 成交 ${displayMoney(executionOrder.filledPrice)}` : ""}
            {Number.isFinite(Number(executionOrder.realizedPnl)) ? ` · 盈亏 ${displayMoney(executionOrder.realizedPnl)}` : ""}
          </small>
          {["entry_pending", "entry_filled", "protecting"].includes(executionOrder.status) && (
            <button onClick={() => action(`/api/execution-orders/${executionOrder.id}/close`, { reason: "manual_ui" })}>撤单/平仓</button>
          )}
        </div>
      )}
    </div>
  );
}

function MandateCard({ mandate, action }) {
  if (!mandate) return null;
  const pending = mandate.status === "pending_confirmation";
  return (
    <div className="chatMandateCard">
      <header><Shield size={15} /><b>授权委托{pending ? "草案" : ""}</b><StatusBadge tone={pending ? "warning" : "ok"}>{humanize(mandate.status)}</StatusBadge></header>
      <div className="mandateGridMini">
        <span><small>交易对</small><b>{(mandate.allowedSymbols || []).join("、") || "-"}</b></span>
        <span><small>最大杠杆</small><b>{mandate.max_leverage || 1}x</b></span>
        <span><small>单笔风险</small><b>{mandate.maxSingleTradeRiskPct}%</b></span>
        <span><small>日亏上限</small><b>{mandate.maxDailyLossPct}%</b></span>
      </div>
      {pending && <footer><button className="approveButton" onClick={() => action(`/api/mandates/${mandate.id}/activate`, {})}>确认激活</button><small>激活后 Agent 才能在此边界内提出可执行计划</small></footer>}
    </div>
  );
}

function ToolTrace({ trace = [] }) {
  const [open, setOpen] = useState(false);
  if (!trace.length) return null;
  return (
    <div className="toolTrace">
      <button onClick={() => setOpen((current) => !current)}>
        <Wrench size={12} /> {trace.length} 次工具调用 <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && trace.map((item, index) => (
        <div key={index}><b>{item.name}</b><span>{item.summary}</span><small>{item.latencyMs}ms</small></div>
      ))}
    </div>
  );
}

function SetupChecklist({ data, llmConfigured, ui, onExample }) {
  const exchangeReady = (data.exchangeAccounts || []).some((account) => account.readEnabled);
  const mandateReady = (data.mandates || []).some((mandate) => ["active", "running"].includes(mandate.status));
  const items = [
    { done: llmConfigured, icon: BrainCircuit, label: "配置 LLM API Key", hint: "在系统设置里填写 Anthropic / OpenAI / DeepSeek / Gemini API Key", action: () => ui.setActive("systemSettings") },
    { done: exchangeReady, icon: KeyRound, label: "连接交易所（只读）", hint: "配置只读 API 后可同步账户与持仓；不配置也能用公开行情", action: () => ui.setActive("systemSettings") },
    { done: mandateReady, icon: Shield, label: "激活授权委托", hint: "在下方说出目标，我会生成授权草案", action: null }
  ];
  const examples = [
    "看看 BTC 现在的走势，说说你的判断",
    "稳健做 BTC/ETH：单笔风险 0.3%，日亏损上限 1%，最大 3 倍杠杆，重大事件前 30 分钟停止开仓",
    "现在有哪些高影响事件？对我的持仓有什么风险？"
  ];
  return (
    <div className="setupChecklist">
      <h2>把目标告诉你的 AI 交易员</h2>
      <p>它会同步真实行情、检索知识库、生成交易计划，并在硬风控通过后交给你批准。</p>
      <div className="checkItems">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.label} className={item.done ? "done" : ""} onClick={item.action || undefined} disabled={!item.action}>
              <Icon size={16} />
              <span>{item.label}</span>
              {item.done ? <CheckCircle2 size={15} className="positive" /> : <small>{item.hint}</small>}
            </button>
          );
        })}
      </div>
      <div className="examplePrompts">
        {examples.map((example) => <button key={example} onClick={() => onExample(example)}>{example}</button>)}
      </div>
    </div>
  );
}

export function ChatPage({ data, action, ui }) {
  const [messages, setMessages] = useState([]);
  const [llmConfigured, setLlmConfigured] = useState(true);
  const [provider, setProvider] = useState(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef(null);

  async function loadMessages() {
    try {
      const response = await fetch("/api/agent/chat", { headers: authHeaders() });
      if (!response.ok) return;
      const json = await response.json();
      setMessages(json.messages || []);
      setLlmConfigured(Boolean(json.llmConfigured));
      setProvider(json.provider);
    } catch {}
  }

  useEffect(() => { loadMessages(); }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending]);

  async function send(textOverride) {
    const text = String(textOverride ?? input).trim();
    if (!text || pending) return;
    setInput("");
    setPending(true);
    setMessages((current) => [...current, { id: `tmp_${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() }]);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: text })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `请求失败 ${response.status}`);
      await loadMessages();
      await ui.refresh(false);
    } catch (error) {
      setMessages((current) => [...current, { id: `err_${Date.now()}`, role: "agent", content: `请求失败：${error.message}`, createdAt: new Date().toISOString() }]);
    } finally {
      setPending(false);
    }
  }

  function findPlan(planId) {
    return (data.tradePlans || []).find((plan) => plan.id === planId);
  }
  function findMandate(mandateId) {
    return (data.mandates || []).find((mandate) => mandate.id === mandateId);
  }

  return (
    <div className="chatPage">
      {!llmConfigured && (
        <div className="llmBanner">
          <PlugZap size={15} />
          未配置 LLM API Key，Agent 以本地规则模式运行（只能同步数据与风控预检）。打开系统设置填写任一模型 API Key 后即可解锁完整决策能力。
        </div>
      )}
      <div className="chatScroll" ref={scrollRef}>
        {!messages.length && <SetupChecklist data={data} llmConfigured={llmConfigured} ui={ui} onExample={(example) => send(example)} />}
        {messages.map((message) => (
          <div className={`chatMessage ${message.role}`} key={message.id}>
            {message.role === "agent" && <div className="botAvatar"><BrainCircuit size={16} /></div>}
            <div className="chatBody">
              <div className="chatContent">{renderText(message.content)}</div>
              {message.mandateId && <MandateCard mandate={findMandate(message.mandateId)} action={action} />}
              {message.planId && (
                <PlanCard
                  plan={findPlan(message.planId)}
                  executionOrder={(data.executionOrders || []).find((item) => item.planId === message.planId)}
                  action={action}
                  ui={ui}
                />
              )}
              <ToolTrace trace={message.toolTrace || []} />
              <small className="chatMeta">
                {formatTime(message.createdAt)}{message.role === "agent" && message.model ? ` · ${message.model}` : ""}
              </small>
            </div>
          </div>
        ))}
        {pending && (
          <div className="chatMessage agent">
            <div className="botAvatar"><BrainCircuit size={16} /></div>
            <div className="chatBody"><div className="thinkingDots"><span /><span /><span /></div></div>
          </div>
        )}
      </div>
      <div className="chatInputBar">
        <textarea
          value={input}
          rows={1}
          placeholder={provider ? `下达目标或提问（${provider.name}/${provider.model}）` : "下达目标或提问，例如：稳健观察 BTC，单笔风险不超过 0.3%"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button className="sendButton" disabled={pending || !input.trim()} onClick={() => send()} aria-label="发送">
          <ArrowUp size={17} />
        </button>
      </div>
    </div>
  );
}
