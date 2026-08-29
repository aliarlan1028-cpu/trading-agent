import { useCallback, useRef, useState } from "react";

const IDLE = Object.freeze({ kind: "idle", result: null, error: null });
const text = (value) => typeof value === "string" ? value.trim() : "";
const bounded = (value, limit) => text(value).slice(0, limit);

function currentCanonical(selection, row, type) {
  return row?.selectable === true
    && text(row?.id)
    && selection?.object?.id === row.id
    && selection?.object?.type === type;
}

function boundaryEnabled({ selection, actionsDisabled }) {
  return actionsDisabled !== true && selection?.context?.actionsDisabled !== true;
}

export function memoryPayloadForFact(row) {
  if (row?.selectable !== true || !text(row?.id)) return null;
  const title = bounded(row.title || row.shortTitle || row.name || row.symbol || row.identity, 160);
  const content = bounded(row.summary || row.description || row.narrative?.summary || title, 800);
  if (!title || !content) return null;
  const rawKind = text(row.kind).toLowerCase();
  const kind = /^[a-z0-9_-]{1,40}$/u.test(rawKind) ? rawKind : "signal";
  return {
    layer: "episodic",
    title,
    content,
    tags: ["情报", kind],
    source: "v2_ai_intelligence"
  };
}

export function canRememberIntelligence({ row, type, selection, actions, actionsDisabled }) {
  return type === "Signal"
    && boundaryEnabled({ selection, actionsDisabled })
    && currentCanonical(selection, row, type)
    && memoryPayloadForFact(row) !== null
    && typeof actions?.rememberIntelligence === "function";
}

export function canCancelWatch({ row, selection, actions, actionsDisabled }) {
  return boundaryEnabled({ selection, actionsDisabled })
    && currentCanonical(selection, row, "Watch")
    && text(row?.status).toLowerCase() === "active"
    && typeof actions?.cancelWatch === "function";
}

export function canRefreshEvents({ selection, actions, actionsDisabled }) {
  return boundaryEnabled({ selection, actionsDisabled }) && typeof actions?.refreshEvents === "function";
}

export function classifyAiContextActionResult(kind, result, expectedId) {
  try {
    if (!result || typeof result !== "object" || result.error || result.cancelled === true) return "failed";
    if (kind === "memory") return text(result.id) ? "succeeded" : "failed";
    if (kind === "watch") {
      const status = text(result.watch?.status).toLowerCase();
      return result.watch?.id === expectedId && ["cancelled", "canceled"].includes(status) ? "succeeded" : "failed";
    }
    if (kind === "events") {
      const status = text(result.status).toLowerCase();
      if (status === "ok") return "succeeded";
      if (["partial", "skipped"].includes(status)) return "partial";
      return "failed";
    }
  } catch {
    return "failed";
  }
  return "failed";
}

export async function runAuthoritativeAiContextAction({ kind, expectedId, action, onState = () => {}, isCurrent = () => true }) {
  if (typeof action !== "function") {
    onState({ kind: "failed", result: null, error: new Error("action_unavailable") });
    return null;
  }
  onState({ kind: "processing", result: null, error: null });
  try {
    const result = await action();
    if (isCurrent()) onState({ kind: classifyAiContextActionResult(kind, result, expectedId), result, error: null });
    return result;
  } catch (error) {
    if (isCurrent()) onState({ kind: "failed", result: null, error });
    return null;
  }
}

export function useAiContextAction(kind, expectedId) {
  const [state, setState] = useState(IDLE);
  const processing = useRef(false);
  const currentExpectedId = useRef(expectedId);
  currentExpectedId.current = expectedId;
  const visibleState = state.expectedId === expectedId ? state : IDLE;
  const run = useCallback(async (action) => {
    if (processing.current) return null;
    processing.current = true;
    const actionExpectedId = expectedId;
    try {
      return await runAuthoritativeAiContextAction({
        kind,
        expectedId: actionExpectedId,
        action,
        isCurrent: () => currentExpectedId.current === actionExpectedId,
        onState: (next) => setState({ ...next, expectedId: actionExpectedId })
      });
    } finally {
      processing.current = false;
    }
  }, [expectedId, kind]);
  return Object.freeze({ state: visibleState, run });
}

export function aiContextActionLabel(state, labels) {
  if (state?.kind === "processing") return labels.processing;
  if (state?.kind === "succeeded") return labels.succeeded;
  if (state?.kind === "partial") return labels.partial;
  if (state?.kind === "failed") return labels.failed;
  return labels.idle;
}

const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function aiContextActionDetail(kind, result) {
  try {
    if (!result || typeof result !== "object") return "Unavailable";
    if (kind === "memory") {
      const id = bounded(result.id, 120);
      return id ? `记忆 ID ${id}` : "Unavailable";
    }
    if (kind === "watch") {
      const id = bounded(result.watch?.id, 120);
      const status = bounded(result.watch?.status, 24).toLowerCase();
      return id && ["cancelled", "canceled"].includes(status) ? `${id} · ${status}` : "Unavailable";
    }
    if (kind === "events") {
      const status = bounded(result.status, 24).toLowerCase();
      if (!["ok", "partial", "skipped", "failed"].includes(status)) return "Unavailable";
      const attempted = safeCount(result.attempted);
      const succeeded = safeCount(result.succeeded);
      const failed = safeCount(result.failed);
      const ingested = safeCount(result.ingested);
      const reason = bounded(result.reason, 80);
      const fields = [status];
      if (succeeded !== null && attempted !== null) fields.push(`成功 ${succeeded}/${attempted}`);
      if (failed !== null) fields.push(`失败 ${failed}`);
      if (ingested !== null) fields.push(`新增 ${ingested}`);
      if (/^[a-z0-9_-]{1,80}$/u.test(reason)) fields.push(reason);
      return fields.join(" · ").slice(0, 160);
    }
  } catch {
    return "Unavailable";
  }
  return "Unavailable";
}
