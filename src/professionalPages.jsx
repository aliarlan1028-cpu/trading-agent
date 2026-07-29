import React from "react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, FlaskConical, Gauge, GitBranch, Layers, Play, ShieldCheck, Target, TrendingUp } from "lucide-react";
import { displayMoney, formatDateTime, humanize } from "./lib.jsx";
import "./professional.css";

const tone = (status) => status === "met" || status === "allowed" ? "ok" : status === "unknown" ? "warn" : "bad";

function Header({ title, code, children }) {
  return <div className="proHead"><div><h1>{title} <span>{code}</span></h1><p>{children}</p></div></div>;
}

export function StrategyWorkbenchPage({ data, action, ui }) {
  const profiles = data.strategyProfiles || [];
  const backtests = data.backtests || [];
  const skills = data.knowledge?.tradingSkills || [];
  const paper = data.paperReport?.sessions || data.paperReport || [];
  return <div className="proPage">
    <Header title="策略研究工作台" code="RESEARCH WORKBENCH">从研究假设、样本外验证、纯前向模拟到人工批准的唯一研究路径</Header>
    <div className="proFlow">
      {[['研究假设', profiles.length, FlaskConical], ['样本外回测', backtests.length, BarChart3], ['纯前向验证', Array.isArray(paper) ? paper.length : 0, Play], ['待批准技能', skills.filter(s => s.status === 'paper_validated').length, ShieldCheck]].map(([label, value, Icon], i) => <React.Fragment key={label}><div className="proStage"><Icon size={18}/><b>{label}</b><strong>{value}</strong></div>{i < 3 && <span>→</span>}</React.Fragment>)}
    </div>
    <div className="proGrid two">
      <section className="proCard"><div className="proTitle"><b>策略组合</b><button onClick={() => action('/api/strategy/research', {}, 'POST')}>启动研究</button></div>{profiles.slice(0,8).map(p => <div className="proRow" key={p.id}><span>{p.symbol || p.name}</span><b>{p.timeframe || '—'} · {humanize(p.status, '研究中')}</b></div>)}{!profiles.length && <div className="proEmpty">暂无策略研究结果</div>}</section>
      <section className="proCard"><div className="proTitle"><b>验证队列</b><button onClick={() => ui.setActive('knowledgeSkills')}>管理技能</button></div>{skills.filter(s => !['retired','superseded'].includes(s.status)).slice(0,10).map(s => <div className="proRow" key={s.id}><span>{s.name}</span><b>{humanize(s.status)}</b></div>)}{!skills.length && <div className="proEmpty">暂无可验证技能</div>}</section>
    </div>
  </div>;
}

export function LiveOperationsPage({ data, action, ui }) {
  const pro = data.professional || {};
  const permit = pro.permissionEvidence || { checks: [] };
  const slo = pro.slo || { checks: [] };
  const risk = pro.portfolioRisk || data.portfolioRisk || {};
  const eq = pro.executionQuality || {};
  return <div className="proPage">
    <Header title="实盘运营中心" code="LIVE OPERATIONS">交易许可、组合风险、执行质量、SLO 和端到端证据在同一屏完成值守</Header>
    <section className={`permitBanner ${tone(permit.decision)}`}><div><ShieldCheck size={24}/><span><small>当前交易许可</small><b>{permit.decision === 'allowed' ? '允许进入逐单风控' : '禁止新开仓'}</b></span></div><p>{permit.summary || '等待系统证据'}</p></section>
    <div className="proGrid four">
      <div className="metric"><Gauge/><span>组合波动利用率</span><b>{risk.utilizationPct == null ? '—' : `${risk.utilizationPct}%`}</b></div>
      <div className="metric"><TrendingUp/><span>平均滑点</span><b>{eq.avgSlippageBps == null ? '—' : `${eq.avgSlippageBps} bps`}</b></div>
      <div className="metric"><Layers/><span>保护覆盖率</span><b>{slo.metrics?.protectionCoveragePct == null ? '—' : `${slo.metrics.protectionCoveragePct}%`}</b></div>
      <div className="metric"><Clock3/><span>对账延迟</span><b>{slo.metrics?.reconciliationFreshnessMs == null ? '—' : `${Math.round(slo.metrics.reconciliationFreshnessMs/1000)}s`}</b></div>
    </div>
    <div className="proGrid two">
      <section className="proCard"><div className="proTitle"><b>为何允许 / 不允许交易</b><span>逐项可审计</span></div>{permit.checks.map(c => <div className="evidence" key={c.key}>{c.passed ? <CheckCircle2 className="green"/> : <AlertTriangle className="red"/>}<span><b>{c.label}</b><small>{c.evidence}</small></span></div>)}</section>
      <section className="proCard"><div className="proTitle"><b>SLO 状态</b><span className={`tag ${tone(slo.status)}`}>{humanize(slo.status)}</span></div>{slo.checks.map(c => <div className="proRow" key={c.key}><span>{({marketFreshnessMs:'行情新鲜度',orderAckP95Ms:'订单 ACK P95',protectionCoveragePct:'保护覆盖率',reconciliationFreshnessMs:'对账新鲜度'})[c.key]}</span><b className={tone(c.status)}>{c.value == null ? '未知' : c.key.includes('Pct') ? `${c.value}%` : `${Math.round(c.value)}ms`}</b></div>)}</section>
      <section className="proCard"><div className="proTitle"><b>组合暴露与相关性</b><span>{risk.positions?.length || 0} 个持仓</span></div>{(risk.correlations || []).map(c => <div className="proRow" key={c.pair}><span>{c.pair}</span><b>ρ {c.rho}</b></div>)}{!(risk.correlations || []).length && <div className="proEmpty">持仓或K线不足，无法计算相关性</div>}</section>
      <section className="proCard"><div className="proTitle"><b>可回放 Trace</b><button onClick={() => ui.setActive('auditSystem')}>查看审计</button></div>{(pro.replayBundles || []).slice(0,6).map(r => <div className="traceRow" key={r.traceId}><GitBranch size={14}/><span><b>{r.traceId}</b><small>{formatDateTime(r.createdAt)} · 计划 {r.tradePlanId || '无'}</small></span><em>{r.executionOrderIds?.length || 0} 单 / {r.fillIds?.length || 0} 成交</em></div>)}{!(pro.replayBundles || []).length && <div className="proEmpty">暂无 Agent 决策链</div>}</section>
    </div>
  </div>;
}
