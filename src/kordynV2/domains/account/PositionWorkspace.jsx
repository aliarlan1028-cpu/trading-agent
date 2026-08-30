import { Activity, Bot, CircleAlert, Gauge, ShieldCheck, UserRound } from "lucide-react";
import { resourceTone, validatedTruthMode } from "./AccountWorkspace.jsx";
import { executionSelectionCandidate, PositionInspector } from "./PositionInspector.jsx";
import { PositionRegistry, selectedPositionFor } from "./PositionRegistry.jsx";

export { positionSelectionCandidate } from "./PositionRegistry.jsx";

const unavailable = "Unavailable";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value, digits = 2) => finite(value)
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 8) }).format(value)
  : unavailable;
const text = (value) => typeof value === "string" && value ? value : unavailable;
const directionLabel = (value) => /short|sell|空/iu.test(String(value || "")) ? "空" : /long|buy|多/iu.test(String(value || "")) ? "多" : unavailable;

function PositionFact({ label, value, tone }) {
  return <div><dt>{label}</dt><dd data-fact-tone={tone}>{value}</dd></div>;
}

function PriceRail({ position }) {
  const entry = position?.entry;
  const mark = position?.mark;
  const liquidation = position?.liquidationPrice;
  const values = [entry, mark, liquidation].filter(finite);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const offset = (value) => finite(value) && finite(min) && finite(max) && max > min
    ? `${Math.max(4, Math.min(96, (value - min) / (max - min) * 92 + 4))}%`
    : null;
  return (
    <section className="kordynV2PositionPriceRail" aria-label="入场、标记与强平价格">
      <header><h3>价格边界</h3><span>只显示当前权威事实</span></header>
      <div data-price-rail-available={values.length >= 2 ? "true" : "false"}>
        {[{ label: "强平", value: liquidation, tone: "critical" }, { label: "开仓", value: entry, tone: "entry" }, { label: "标记", value: mark, tone: "mark" }].map((fact) => (
          finite(fact.value) ? <i key={fact.label} data-price-tone={fact.tone} style={{ "--position-price-offset": offset(fact.value) }}><span>{fact.label}</span><b>{number(fact.value)}</b></i> : null
        ))}
      </div>
      {values.length < 2 && <p>{unavailable}</p>}
    </section>
  );
}

function PositionTruthField({ position, state, headingRef = null, mobile = false, canonical = true }) {
  if (!position) return (
    <main className="kordynV2PositionTruth is-empty">
      <CircleAlert size={24} aria-hidden="true" />
      <span><h2>选择持仓</h2><p>从持仓列表选择一个当前可用的 Position 对象。</p></span>
    </main>
  );
  const OwnershipIcon = position.ownership === "ai_managed" ? Bot : UserRound;
  const pnlTone = finite(position.unrealizedPnl) && position.unrealizedPnl < 0 ? "critical" : finite(position.unrealizedPnl) ? "healthy" : "unavailable";
  return (
    <main
      className={`kordynV2PositionTruth${mobile ? " is-mobile" : ""}`}
      data-kordyn-v2-object-id={canonical ? position.id : undefined}
      data-kordyn-v2-object-type={canonical ? "Position" : undefined}
      data-kordyn-v2-related-position-id={canonical ? undefined : position.id}
    >
      <header>
        <span><Activity size={19} aria-hidden="true" /><h2 ref={headingRef} tabIndex={mobile ? -1 : undefined}>{text(position.symbol)}</h2><em data-position-direction={directionLabel(position.direction)}>{directionLabel(position.direction)}</em></span>
        <span className="kordynV2PositionOwnership"><OwnershipIcon size={14} aria-hidden="true" />{position.ownership === "ai_managed" ? "AI 托管" : position.ownership === "manual_external" ? "手动 / 外部" : unavailable}</span>
      </header>
      <dl className="kordynV2PositionPrimaryFacts">
        <PositionFact label="持仓数量" value={number(position.quantity)} />
        <PositionFact label="开仓均价" value={number(position.entry)} />
        <PositionFact label="标记价格" value={number(position.mark)} />
        <PositionFact label="未实现盈亏" value={number(position.unrealizedPnl)} tone={pnlTone} />
        <PositionFact label="杠杆" value={finite(position.leverage) ? `${number(position.leverage, 0)}x` : unavailable} />
        <PositionFact label="强平距离" value={finite(position.liqDistancePct) ? `${number(position.liqDistancePct)}%` : unavailable} />
      </dl>
      <PriceRail position={position} />
      <dl className="kordynV2PositionSecondaryFacts">
        <PositionFact label="名义敞口" value={number(position.notional)} />
        <PositionFact label="占用保证金" value={number(position.margin)} />
        <PositionFact label="止损" value={number(position.stopLoss)} />
        <PositionFact label="止盈目标" value={position.takeProfits?.length ? position.takeProfits.map((value) => number(value)).join(" · ") : unavailable} />
      </dl>
      <footer>
        <span><ShieldCheck size={14} aria-hidden="true" /><small>保护状态</small><strong data-protection-tone={position.protection?.state || "unavailable"}>{text(position.protection?.state)}</strong></span>
        <span><Gauge size={14} aria-hidden="true" /><small>事实来源</small><strong>{text(position.source || state?.source)}</strong></span>
        <time dateTime={position.observedAt || undefined}>{text(position.observedAt || state?.lastValidAt)}</time>
      </footer>
    </main>
  );
}

function PositionRelatedLedger({ position, onSelect = () => {} }) {
  const order = position?.relatedExecution;
  const executionCandidate = executionSelectionCandidate(order);
  const protection = position?.protection;
  return (
    <section className="kordynV2PositionLedger" data-kordyn-v2-position-ledger="true" aria-label="相关执行与保护记录">
      <header><h2>相关执行与保护记录</h2><span>仅显示当前 Position 的来源证据</span></header>
      <div>
        <table>
          <thead><tr><th>记录</th><th>身份</th><th>状态</th><th>来源</th><th>数量 / 价格</th><th>证据时间</th></tr></thead>
          <tbody>
            {executionCandidate && <tr>
              <td>Execution</td>
              <td><button type="button" data-kordyn-v2-object-id={executionCandidate.id} data-kordyn-v2-object-type="Execution" onClick={() => onSelect(executionCandidate)}>{executionCandidate.id}</button></td>
              <td>{text(order.status)}</td>
              <td>{text(order.exchange)}</td>
              <td>{number(order.filledQuantity ?? order.quantity)}</td>
              <td>{text(order.updatedAt || order.createdAt)}</td>
            </tr>}
            {position && <tr>
              <td>保护快照</td>
              <td>{text(protection?.snapshotId)}</td>
              <td data-protection-tone={protection?.state || "unavailable"}>{text(protection?.state)}</td>
              <td>{text(protection?.source)}</td>
              <td>{number(protection?.stopPrice)}</td>
              <td>{text(protection?.asOf)}</td>
            </tr>}
            {!position && <tr><td colSpan="6">选择持仓后显示相关记录。</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PositionWorkspace({ model, truth, state, selection, actionsDisabled = false, actionOutcome = null, onSelect = () => {}, onExit = () => {} }) {
  const selected = selectedPositionFor(model, selection);
  return (
    <div className="kordynV2PositionWorkspace" data-kordyn-v2-position-desktop="true" data-kordyn-v2-destination="account/positions" data-kordyn-v2-truth-mode={validatedTruthMode(truth?.mode)}>
      <header className="kordynV2AccountWorkspaceTitle">
        <span><h1 data-kordyn-v2-destination-title>持仓</h1><small>敞口、保护与交易所最终性</small></span>
        <em role="status" data-resource-tone={resourceTone(state?.kind)}>{text(state?.kind)}</em>
      </header>
      <div className="kordynV2PositionWorkbench" data-kordyn-v2-layout="position-registry-truth-evidence">
        <PositionRegistry model={model} selection={selection} onSelect={onSelect} />
        <PositionTruthField position={selected} state={state} canonical={selection?.object?.type === "Position" && selection.object.id === selected?.id} />
        <PositionInspector position={selected} reconciliation={model?.reconciliation} actionsDisabled={actionsDisabled} actionOutcome={actionOutcome} onSelect={onSelect} onExit={onExit} />
        <PositionRelatedLedger position={selected} onSelect={onSelect} />
      </div>
    </div>
  );
}

export { PositionRelatedLedger, PositionTruthField };
