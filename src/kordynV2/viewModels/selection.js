import {
  buildShellContext,
  buildShellTrace,
  resolveShellObjectSelection,
  selectionForNavigation
} from "../../productShell.jsx";

const V2_PRESENTATION_SCOPES = new Set(["account", "assets", "governance"]);

function canonicalCandidate(candidate) {
  if (!candidate || !V2_PRESENTATION_SCOPES.has(candidate.workspaceId)) return candidate;
  const { workspaceId: _presentationScope, ...identity } = candidate;
  return identity;
}

export function createV2Selection({ data = {}, candidate = null } = {}) {
  const resolved = resolveShellObjectSelection(data, canonicalCandidate(candidate));
  if (!resolved) return null;
  const object = selectionForNavigation(resolved, resolved.workspaceId, data);
  if (!object) return null;
  const context = buildShellContext({ data, workspaceId: object.workspaceId, selectedObject: object });
  const stages = buildShellTrace(data, object.workspaceId, object);
  return Object.freeze({
    object,
    context: Object.freeze({ ...context, objectId: object.id }),
    trace: Object.freeze({ objectId: object.id, stages: Object.freeze(stages) })
  });
}
