import { Bot, CircleAlert, UserRound } from "lucide-react";
import { protectionPresentation } from "./PositionInspector.jsx";

const unavailable = "Unavailable";
const validIdentity = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= 240
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  && !["unavailable", "unknown", "n/a", "—"].includes(value.toLowerCase());
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value, digits = 2) => finite(value)
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 8) }).format(value)
  : unavailable;
const text = (value) => typeof value === "string" && value ? value : unavailable;
const directionLabel = (value) => /short|sell|空/iu.test(String(value || "")) ? "空" : /long|buy|多/iu.test(String(value || "")) ? "多" : unavailable;

export function positionSelectionCandidate(position) {
  return validIdentity(position?.id)
    ? { id: position.id, type: "Position", workspaceId: "account", route: "positions", sourceSection: "cockpit" }
    : null;
}

export function selectedPositionFor(model, selection) {
  if (!validIdentity(selection?.object?.id)) return null;
  const positions = Array.isArray(model?.positions) ? model.positions : [];
  const matches = selection.object.type === "Position"
    ? positions.filter((position) => position.id === selection.object.id)
    : selection.object.type === "Execution"
      ? positions.filter((position) => position.relatedExecution?.id === selection.object.id)
      : [];
  return matches.length === 1 ? matches[0] : null;
}

export function PositionRegistry({ model, selection, onSelect = () => {}, returnFocusRef = null, mobile = false }) {
  const positions = Array.isArray(model?.positions) ? model.positions : [];
  const state = model?.availability?.positions?.state || "absent";
  const selected = selectedPositionFor(model, selection);
  const counts = new Map();
  for (const position of positions) {
    const candidate = positionSelectionCandidate(position);
    if (candidate) counts.set(candidate.id, (counts.get(candidate.id) || 0) + 1);
  }
  const emptyCopy = state === "loaded" ? "当前没有持仓" : state === "invalid" ? "持仓事实不可用" : "持仓事实明确未加载";
  return (
    <section className={`kordynV2PositionRegistry${mobile ? " is-mobile" : ""}`} aria-label="持仓列表">
      <header><h2>持仓列表</h2><span>{state === "loaded" ? positions.length : unavailable}</span></header>
      <div className="kordynV2PositionRegistryRows">
        {positions.map((position, index) => {
          const baseCandidate = positionSelectionCandidate(position);
          const candidate = baseCandidate && counts.get(baseCandidate.id) === 1 ? baseCandidate : null;
          const directSelection = candidate && selection?.object?.type === "Position" && selected?.id === candidate.id;
          const relatedContext = candidate && selection?.object?.type === "Execution" && selected?.id === candidate.id;
          if (!candidate) return (
            <article className="kordynV2PositionRow is-unavailable" key={`position-unavailable-${index}`}>
              <CircleAlert size={17} aria-hidden="true" />
              <span><strong>{text(position?.symbol)}</strong><small>对象身份不可用</small></span>
            </article>
          );
          const OwnershipIcon = position.ownership === "ai_managed" ? Bot : UserRound;
          const protection = protectionPresentation(position.protection);
          const ProtectionIcon = protection.icon;
          return (
            <button
              key={candidate.id}
              ref={directSelection || relatedContext || (!selected && positions.length === 1) ? returnFocusRef : null}
              type="button"
              className="kordynV2PositionRow"
              data-kordyn-v2-object-id={candidate.id}
              data-kordyn-v2-object-type="Position"
              data-selected={directSelection ? "true" : relatedContext ? "context" : "false"}
              aria-pressed={directSelection || false}
              onClick={(event) => onSelect(candidate, event)}
            >
              <span className="kordynV2PositionRowTitle"><strong>{text(position.symbol)}</strong><em data-position-direction={directionLabel(position.direction)}>{directionLabel(position.direction)}</em></span>
              <span className="kordynV2PositionRowMeta"><OwnershipIcon size={13} aria-hidden="true" />{position.ownership === "ai_managed" ? "AI 托管" : position.ownership === "manual_external" ? "手动 / 外部" : unavailable}<b>{finite(position.leverage) ? `${number(position.leverage, 0)}x` : unavailable}</b></span>
              <span className="kordynV2PositionRowFacts"><small>未实现盈亏</small><strong data-pnl-tone={finite(position.unrealizedPnl) && position.unrealizedPnl < 0 ? "negative" : finite(position.unrealizedPnl) ? "positive" : "unavailable"}>{number(position.unrealizedPnl)}</strong><small>敞口</small><b>{number(position.notional)}</b></span>
              <span className="kordynV2PositionRowProtection" data-protection-surface="registry" data-protection-state={protection.state} data-protection-tone={protection.tone}><ProtectionIcon size={14} aria-hidden="true" />{protection.label}</span>
            </button>
          );
        })}
        {!positions.length && <p role="status">{emptyCopy}</p>}
      </div>
    </section>
  );
}
