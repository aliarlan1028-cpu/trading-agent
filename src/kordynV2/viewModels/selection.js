import {
  buildShellContext,
  buildShellTrace,
  resolveShellObjectSelection,
  selectionForNavigation
} from "../../productShell.jsx";
import { registerAiSupportSelection } from "./aiSupportProjection.js";

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
  const contextProjection = buildShellContext({ data, workspaceId: object.workspaceId, selectedObject: object });
  const stages = buildShellTrace(data, object.workspaceId, object);
  const context = Object.freeze({ ...contextProjection, objectId: object.id });
  const selection = Object.freeze({
    object,
    context,
    trace: Object.freeze({ objectId: object.id, stages: Object.freeze(stages) })
  });
  return registerAiSupportSelection(selection, object, context);
}
