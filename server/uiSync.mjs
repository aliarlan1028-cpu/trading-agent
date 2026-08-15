let revision = Date.now();

export function currentUiRevision() {
  return revision;
}

export function nextUiRevision() {
  const now = Date.now();
  revision = Math.max(revision + 1, now);
  return revision;
}

export function uiSyncEvent(type, payload = {}) {
  return {
    ...payload,
    type,
    revision: nextUiRevision(),
    emittedAt: new Date().toISOString()
  };
}
