import { AlertTriangle, ArrowRight, Ban, CheckCircle2, ShieldCheck } from "lucide-react";
import { ReadinessChain } from "./ReadinessChain.jsx";

const displayMode = (value) => ({ full_auto: "自动交易", full_auto_small: "自动交易", auto: "自动交易", semi_auto: "半自动", observe: "暂停新开仓", halted: "紧急停止" }[value] || value || "Unavailable");

export function MobileBoundaryScreen({ model = {}, onNavigate = () => {}, onSelect = () => {} }) {
  const boundary = model.boundary || {};
  const blocker = boundary.blockers?.[0];
  return (
    <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="overview">
      <header><h2>系统治理</h2><p>当前边界决定系统此刻能做什么</p></header>
      <section className="kordynV2MobileBoundaryTruth">
        <div><small>保存目标</small><strong>{displayMode(boundary.selectedMode)}</strong></div><ArrowRight size={18} /><div><small>当前生效</small><strong>{displayMode(boundary.effectiveMode)}</strong></div>
        <p><AlertTriangle size={16} /><span><strong>{blocker?.label || "当前目标已生效"}</strong><small>{blocker?.recovery || boundary.runtimeStatus || "以服务端事实为准"}</small></span></p>
      </section>
      <section className="kordynV2MobileActionBoundary"><header><ShieldCheck size={19} /><strong>动作边界</strong></header><p data-tone="healthy"><CheckCircle2 size={15} />允许取消、平仓、保护与对账</p><p data-tone="critical"><Ban size={15} />禁止新增风险、加仓与提升杠杆</p></section>
      <ReadinessChain rows={boundary.readiness || []} blockers={boundary.blockers || []} onNavigate={onNavigate} />
      {boundary.mandate?.id && <button className="kordynV2MobileObjectAction" type="button" data-kordyn-v2-object-type="Mandate" data-kordyn-v2-object-id={boundary.mandate.id} onClick={() => onSelect({ id: boundary.mandate.id, type: "Mandate", workspaceId: "governance" })}>查看当前授权证据 <ArrowRight size={18} /></button>}
      <button className="kordynV2MobilePrimary" type="button" data-kordyn-v2-navigate="governance:configuration" onClick={() => onNavigate("governance", "configuration")}>打开权威配置 <ArrowRight size={18} /></button>
    </section>
  );
}

