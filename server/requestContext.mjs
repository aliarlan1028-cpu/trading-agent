import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function requestContextMiddleware(req, _res, next) {
  storage.run({
    userId: req.user?.id || null,
    actor: req.user?.name || null,
    tenantId: req.tenantId || null,
    requestId: req.headers["x-request-id"] || null
  }, next);
}

export function currentRequestContext() {
  return storage.getStore() || null;
}
