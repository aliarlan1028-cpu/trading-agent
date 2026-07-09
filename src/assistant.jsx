import React, { useState } from "react";
import { Sparkles, X, RefreshCw, Bot } from "lucide-react";
import { displayMoney } from "./lib.jsx";

// 悬浮 AI 助手：随时总结账户状态、自主运行、今日行为、待办与风险。
export function AssistantWidget({ data, action }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const pf = data.portfolio || {};
  const sys = data.system || {};
  const positions = data.positions || [];
  const awaiting = (data.tradePlans || []).filter((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status)).length;
  const pending = (data.pendingActions || []).filter((a) => !a.status || a.status === "pending").length;
  const incidents = (data.riskIncidents || []).filter((i) => i.status === "open").length;
  const autonomyLabel = sys.killSwitch ? "已熔断" : sys.autonomyEnabled ? "自主运行中" : "已暂停";
  const todoTotal = awaiting + pending;
  const digestRows = [
    ["账户", pf.totalEquityUsdt != null ? `${displayMoney(pf.totalEquityUsdt, 0)} USDT · 持仓 ${positions.length}` : "未同步"],
    ["今日盈亏", pf.todayPnl != null ? `${pf.todayPnl >= 0 ? "+" : ""}${displayMoney(pf.todayPnl, 2)} USDT` : "未同步"],
    ["自主状态", `${autonomyLabel} · 实盘${sys.liveTradingEnabled ? "开" : "关"}`],
    ["待办", `待批准 ${awaiting} · 待确认 ${pending}`],
    ["风险", incidents ? `${incidents} 条未处理告警` : "无未处理告警"]
  ];
  async function summarize() {
    setLoading(true);
    try {
      const result = await action("/api/assistant/summarize", {});
      setSummary(result?.summary || "");
    } finally {
      setLoading(false);
    }
  }
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
            <div className="asstHeadText"><b>AI 助手</b><small>账户 · 行为 · 待办 总览</small></div>
            <button className="asstClose" onClick={() => setOpen(false)} aria-label="关闭"><X size={16} /></button>
          </div>
          <div className="asstDigest">
            {digestRows.map(([k, v]) => (
              <div className="asstRow" key={k}><span>{k}</span><b className="mono">{v}</b></div>
            ))}
          </div>
          <button className="asstSumBtn" onClick={summarize} disabled={loading}>
            <RefreshCw size={13} className={loading ? "spin" : ""} /> {loading ? "总结中…" : "让 AI 总结当前状态"}
          </button>
          {summary && (
            <div className="asstSummary">
              {summary.split("\n").filter((line) => line.trim()).map((line, i) => <p key={i}>{line}</p>)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
