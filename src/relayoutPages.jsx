import React from "react";
import { displayMoney, formatTime, humanize } from "./lib.jsx";
import { AnalysisRoomPage, AuditSystemPage } from "./pages.jsx";
import { StrategyWorkbenchPage, LiveOperationsPage } from "./professionalPages.jsx";
import "./professional.css";

// IA 重构 W1:纯前端搬家/新页,零后端逻辑改动。
// 信号中心=计划看板(读 tradePlans);交易日志=成交流水(读 fills);
// 策略与分析=策略研究+分析作战室合并;审计=审计+实盘运营合并。

const AWAIT = ["awaiting_approval"];
const AUTO = ["approved", "executing", "monitoring"];
const DONE = ["completed"];
const DEAD = ["risk_rejected", "failed", "protection_failed", "setup_rejected", "expired", "cancelled", "dry_run"];

const isShort = (d) => d === "short" || d === "空";
const dirCn = (d) => (isShort(d) ? "空" : "多");
const dirColor = (d) => (isShort(d) ? "var(--rl-short,#cf3560)" : "var(--rl-long,#0a8f56)");
const planLine = (p) => {
  const lo = p.entryLow ?? p.entry_range?.[0];
  const hi = p.entryHigh ?? p.entry_range?.[1] ?? lo;
  const stop = p.stopLoss ?? p.stop_loss;
  return `入场 ${lo ?? "?"}${hi && hi !== lo ? `–${hi}` : ""} · 止损 ${stop ?? "?"}${p.leverage ? ` · ${p.leverage}x` : ""}`;
};

// —— 信号中心:交易计划看板 ——
export function SignalHubPage({ data, ui }) {
  const plans = data.tradePlans || [];
  const bucket = (arr) => plans.filter((p) => arr.includes(p.status));
  const awaiting = bucket(AWAIT);
  const auto = bucket(AUTO);
  const done = bucket(DONE).slice(0, 8);
  const dead = bucket(DEAD).slice(0, 8);
  return (
    <div className="proPage">
      <div className="proHead"><div><h1>信号中心 <span>PLAN BOARD</span></h1><p>AI 生成的交易计划按状态归类:一眼看清哪些已自动下单、哪些在等你批准、哪些被拦。批准仍走「AI 交易员」原逻辑。</p></div></div>

      <div className="proGrid four">
        <div className="metric"><span>待你批准</span><b style={{ color: "#f0b04e" }}>{awaiting.length}</b></div>
        <div className="metric"><span>自动 / 执行中</span><b style={{ color: "#2f8f4f" }}>{auto.length}</b></div>
        <div className="metric"><span>已完成</span><b>{done.length}</b></div>
        <div className="metric"><span>被拒 / 失败</span><b style={{ color: "#cf3560" }}>{dead.length}</b></div>
      </div>

      <div className="proGrid two">
        <section className="proCard">
          <div className="proTitle"><b>⏳ 待你批准</b><span>需人工</span></div>
          {awaiting.map((p) => (
            <div className="proRow rlPlan" key={p.id}>
              <div className="rlPlanTop">
                <b style={{ color: dirColor(p.direction) }}>{p.symbol} {dirCn(p.direction)}</b>
                <span className="rlTime">{formatTime(p.createdAt)}</span>
              </div>
              <small className="rlSub">{planLine(p)}</small>
              <button className="rlGo" onClick={() => ui.setActive("chat")}>去 AI 交易员批准 ›</button>
            </div>
          ))}
          {!awaiting.length && <div className="proEmpty">当前没有待批准的计划(全自动模式下够格即自动下单)。</div>}
        </section>

        <section className="proCard">
          <div className="proTitle"><b>✅ 已自动 / ▶ 执行中</b></div>
          {auto.map((p) => (
            <div className="proRow" key={p.id}><span style={{ color: dirColor(p.direction) }}>{p.symbol} {dirCn(p.direction)}</span><b>{humanize(p.status)}</b></div>
          ))}
          {!auto.length && <div className="proEmpty">暂无自动执行 / 在途计划。</div>}
        </section>
      </div>

      <div className="proGrid two">
        <section className="proCard">
          <div className="proTitle"><b>✔ 已完成</b></div>
          {done.map((p) => <div className="proRow" key={p.id}><span>{p.symbol} {dirCn(p.direction)}</span><b>{humanize(p.status)}</b></div>)}
          {!done.length && <div className="proEmpty">暂无已完成计划。</div>}
        </section>
        <section className="proCard">
          <div className="proTitle"><b>✕ 被拒 / 失败</b><span>如实标原因</span></div>
          {dead.map((p) => <div className="proRow" key={p.id}><span>{p.symbol} {dirCn(p.direction)}</span><b style={{ color: "#cf3560" }}>{humanize(p.status)}{p.failedReason ? ` · ${String(p.failedReason).slice(0, 24)}` : ""}</b></div>)}
          {!dead.length && <div className="proEmpty">暂无被拒 / 失败计划。</div>}
        </section>
      </div>
    </div>
  );
}

// —— 交易日志:成交流水 + 复盘 ——
export function TradeJournalPage({ data }) {
  const fills = data.fills || [];
  const closes = fills.filter((f) => f.kind === "close");
  const totalPnl = closes.reduce((s, f) => s + (Number(f.realizedPnl) || 0), 0);
  const wins = closes.filter((f) => Number(f.realizedPnl) > 0).length;
  const winRate = closes.length ? Math.round((wins / closes.length) * 100) : null;
  const sideCn = (f) => {
    const close = /close|exit|平/.test(String(f.kind || ""));
    const long = /long|做多|多/.test(String(f.direction || ""));
    const buy = /buy|sell/i.test(String(f.side || "")) ? /buy/i.test(String(f.side)) : (close ? !long : long);
    return buy ? "买" : "卖";
  };
  return (
    <div className="proPage">
      <div className="proHead"><div><h1>交易日志 <span>TRADE JOURNAL</span></h1><p>每笔自主交易的进出场、盈亏、方向,全自动记录(无需手记)。</p></div></div>

      <div className="proGrid four">
        <div className="metric"><span>累计已实现盈亏</span><b style={{ color: totalPnl >= 0 ? "#2f8f4f" : "#cf3560" }}>{closes.length ? `${totalPnl.toFixed(2)} U` : "—"}</b></div>
        <div className="metric"><span>平仓笔数</span><b>{closes.length}</b></div>
        <div className="metric"><span>胜率</span><b>{winRate == null ? "—" : `${winRate}%`}</b></div>
        <div className="metric"><span>成交总数</span><b>{fills.length}</b></div>
      </div>

      <section className="proCard">
        <div className="proTitle"><b>成交流水</b><span>全自动记录</span></div>
        {fills.length ? (
          <div className="rlTableWrap">
            <table className="rlTable">
              <thead><tr><th>时间</th><th>交易对</th><th>方向</th><th>类型</th><th>价格</th><th>盈亏</th></tr></thead>
              <tbody>
                {fills.slice(0, 50).map((f, i) => (
                  <tr key={f.id || i}>
                    <td className="mono">{formatTime(f.createdAt)}</td>
                    <td>{f.symbol}</td>
                    <td style={{ color: dirColor(f.direction) }}>{sideCn(f)} {dirCn(f.direction)}</td>
                    <td>{humanize(f.kind)}</td>
                    <td className="mono">{f.price != null ? displayMoney(f.price, 2) : "—"}</td>
                    <td className="mono" style={{ color: f.realizedPnl > 0 ? "#2f8f4f" : f.realizedPnl < 0 ? "#cf3560" : "" }}>{f.realizedPnl != null ? `${Number(f.realizedPnl).toFixed(2)} U` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="proEmpty">暂无成交记录。自主交易成交后会在此自动登记。</div>}
      </section>
    </div>
  );
}

// —— 策略与分析:策略研究工作台 + 分析作战室 合并 ——
export function StrategyAnalysisPage({ data, action, ui }) {
  return (
    <div>
      <StrategyWorkbenchPage data={data} action={action} ui={ui} />
      <AnalysisRoomPage data={data} embedded />
    </div>
  );
}

// —— 审计:审计 + 实盘运营 合并 ——
export function AuditOpsPage({ data, action, ui }) {
  return (
    <div>
      <LiveOperationsPage data={data} action={action} ui={ui} />
      <AuditSystemPage data={data} action={action} ui={ui} embedded />
    </div>
  );
}
