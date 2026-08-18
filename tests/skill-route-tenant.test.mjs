import assert from "node:assert/strict";
import test from "node:test";

import { registerSkillRoutes } from "../server/routes/skills.mjs";

function harness() {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers);
  const db = {
    user: { id: "owner-1", tenantId: "tenant-owner", name: "Owner", isOwner: true },
    auditLogs: [],
    skills: [
      { id: "native-tool", native: true, platformScope: "platform", status: "已启用" },
      { id: "own-tool", tenantId: "tenant-a", ownerUserId: "user-a", status: "已启用" },
      { id: "same-tenant-other", tenantId: "tenant-a", ownerUserId: "user-b", status: "已启用" },
      { id: "foreign-tool", tenantId: "tenant-b", ownerUserId: "user-c", status: "已启用" }
    ]
  };
  registerSkillRoutes(app, {
    db,
    requirePermission: () => (_req, _res, next) => next(),
    persist: (res, payload) => res.json(payload),
    id: (prefix) => `${prefix}-1`,
    nowIso: () => "2026-08-18T00:00:00.000Z",
    appendAudit: () => {},
    runSkillSandbox: async () => ({ ok: true })
  });
  return { routes, db };
}

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

async function invoke(routes, method, path, req) {
  const handlers = routes.get(`${method} ${path}`);
  const res = response();
  await new Promise((resolve, reject) => handlers[0](req, res, () => Promise.resolve(handlers[1](req, res)).then(resolve, reject)));
  return res;
}

test("skill catalog exposes platform plus exact-user rows but never another user's private skill", async () => {
  const { routes } = harness();
  const req = { tenantId: "tenant-a", user: { id: "user-a", tenantId: "tenant-a", isOwner: false } };
  const res = await invoke(routes, "GET", "/api/skills", req);
  assert.deepEqual(res.body.map((row) => row.id), ["native-tool", "own-tool"]);
});

test("a trader cannot mutate platform, same-tenant-other, or foreign skills but can manage an exact-owned import", async () => {
  const { routes, db } = harness();
  const base = { tenantId: "tenant-a", user: { id: "user-a", tenantId: "tenant-a", name: "User A", isOwner: false }, body: {} };
  for (const id of ["native-tool", "same-tenant-other", "foreign-tool"]) {
    const res = await invoke(routes, "POST", "/api/skills/:id/disable", { ...base, params: { id } });
    assert.equal(res.statusCode, 404, id);
    assert.equal(db.skills.find((row) => row.id === id).status, "已启用", id);
  }
  const own = await invoke(routes, "POST", "/api/skills/:id/disable", { ...base, params: { id: "own-tool" } });
  assert.equal(own.statusCode, 200);
  assert.equal(db.skills.find((row) => row.id === "own-tool").status, "已禁用");
});

test("only the configured Owner may mutate a platform-native skill", async () => {
  const { routes, db } = harness();
  const foreignOwner = await invoke(routes, "POST", "/api/skills/:id/disable", {
    tenantId: "tenant-b", user: { id: "foreign-owner", tenantId: "tenant-b", isOwner: true }, params: { id: "native-tool" }, body: {}
  });
  assert.equal(foreignOwner.statusCode, 404);
  const configuredOwner = await invoke(routes, "POST", "/api/skills/:id/disable", {
    tenantId: "tenant-owner", user: db.user, params: { id: "native-tool" }, body: {}
  });
  assert.equal(configuredOwner.statusCode, 200);
  assert.equal(db.skills.find((row) => row.id === "native-tool").status, "已禁用");
});
