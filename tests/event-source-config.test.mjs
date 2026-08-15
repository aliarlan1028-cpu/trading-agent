import assert from "node:assert/strict";
import test from "node:test";
import { safeExternalItemLink, sourceFetchProvenance } from "../server/eventSources.mjs";
import { newsSourcePolicy } from "../server/newsIntelligence.mjs";
import { registerEventSourceRoutes } from "../server/routes/eventSources.mjs";

function harness(initial = []) {
  const routes = new Map();
  const app = {
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
    patch(path, ...handlers) { routes.set(`PATCH ${path}`, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set(`DELETE ${path}`, handlers.at(-1)); },
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); }
  };
  const db = { user: { name: "Owner" }, eventSources: initial, auditLogs: [], traces: [], meta: {} };
  registerEventSourceRoutes(app, {
    db,
    persist(res, payload) { res.payload = payload; },
    requirePermission() { return (_req, _res, next) => next(); },
    id: () => "source_new",
    nowIso: () => "2026-08-13T00:00:00.000Z",
    appendAudit() {},
    assertSafeExternalUrl: async () => true,
    refreshEventSources: async () => ({}),
    refreshOnchainSignals: async () => ({}),
    testEventSource: async () => ({ status: "ok" })
  });
  return { db, routes };
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

test("事件源创建拒绝空 URL、非法可信度和重复 URL", async () => {
  const { db, routes } = harness([{ id: "existing", name: "Existing", type: "rss", url: "https://example.com/feed", trustScore: 80 }]);
  const create = routes.get("POST /api/event-sources");

  let res = response();
  await create({ body: { name: "bad", type: "rss", url: "", trustScore: 80 } }, res);
  assert.equal(res.statusCode, 400);

  res = response();
  await create({ body: { name: "bad", type: "rss", url: "https://valid.example/feed", trustScore: 101 } }, res);
  assert.equal(res.statusCode, 400);

  res = response();
  await create({ body: { name: "dupe", type: "rss", url: "https://example.com/feed#ignored", trustScore: 80 } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(db.eventSources.length, 1);
});

test("自定义事件源会以规范化 URL 落库且客户端可信度不能提权", async () => {
  const { db, routes } = harness();
  const res = response();
  await routes.get("POST /api/event-sources")({ body: { name: "Feed", type: "rss", url: "https://example.com/feed#fragment", trustScore: 88 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.eventSources[0].url, "https://example.com/feed");
  assert.equal(db.eventSources[0].trustScore, 20);
  assert.equal(db.eventSources[0].trustTier, "unverified_custom");
  assert.equal(db.eventSources[0].verifiedOrigin, false);
});

test("事件源在保存时执行 SSRF 安全校验", async () => {
  const { routes } = harness();
  const res = response();
  // 覆盖默认 mock，让本机/内网类目标在落库前被拒绝。
  // registrar 捕获的是 ctx 中的函数，因此另建最小 harness。
  const routeMap = new Map();
  const app = { post(path, ...handlers) { routeMap.set(`POST ${path}`, handlers.at(-1)); }, patch() {}, delete() {}, get() {} };
  registerEventSourceRoutes(app, {
    db: { user: { name: "Owner" }, eventSources: [] }, persist(_res, payload) { _res.payload = payload; }, requirePermission: () => (_req, _res, next) => next(),
    id: () => "x", nowIso: () => "2026-08-13T00:00:00.000Z", appendAudit() {}, refreshEventSources: async () => ({}), refreshOnchainSignals: async () => ({}), testEventSource: async () => ({}),
    assertSafeExternalUrl: async () => { throw new Error("外部 URL 解析到私有或保留地址"); }
  });
  await routeMap.get("POST /api/event-sources")({ body: { name: "Local", type: "rss", url: "http://127.0.0.1/feed", trustScore: 80 } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /安全校验失败/);
});

test("trusted source cross-origin redirects are downgraded and item links are safe", () => {
  const trusted = {
    id: "src_fed_press",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    systemManaged: true,
    verifiedOrigin: true,
    trustTier: "verified_official"
  };
  const redirected = sourceFetchProvenance(trusted, "https://attacker.example/feed.xml");
  assert.equal(redirected.crossOrigin, true);
  assert.equal(redirected.verifiedOrigin, false);
  assert.equal(redirected.trustTier, "unverified_fetch");

  const policy = newsSourcePolicy({
    ...trusted,
    lastFetchedFinalUrl: redirected.finalUrl,
    lastFetchVerifiedOrigin: redirected.verifiedOrigin
  });
  assert.equal(policy.verified, false);
  assert.equal(policy.credibility, 0.2);

  assert.equal(safeExternalItemLink("javascript:alert(1)", redirected.finalUrl), null);
  assert.equal(safeExternalItemLink("https://user:pass@example.com/story", redirected.finalUrl), null);
  assert.equal(safeExternalItemLink("/story", redirected.finalUrl), "https://attacker.example/story");
});
