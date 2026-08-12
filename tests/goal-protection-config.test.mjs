import assert from "node:assert/strict";
import test from "node:test";
import { registerSystemRoutes } from "../server/routes/system.mjs";

function setup(system = {}) {
  const db = { user: { name: "Owner" }, system: { dailyGoalUsdt: null, dailyGoalBreakevenEnabled: false, ...system } };
  const routes = new Map();
  const app = { get() {}, post(route, ...handlers) { routes.set(route, handlers.at(-1)); } };
  registerSystemRoutes(app, {
    db,
    requirePermission: () => (_req, _res, next) => next(),
    userHasPermission: () => true,
    nowIso: () => "2026-08-12T00:00:00.000Z",
    appendAudit() {}, appendTrace() {},
    persist(res, payload) { res.json(payload); }
  });
  return { db, handler: routes.get("/api/system/goals") };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test("每日目标保本必须依赖明确保存的正数目标", () => {
  const { db, handler } = setup();
  const res = response();
  handler({ body: { dailyGoalBreakevenEnabled: true }, user: { name: "Owner" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.system.dailyGoalUsdt, null);
  assert.equal(db.system.dailyGoalBreakevenEnabled, false);
});

test("明确保存 150U 后可开启；开启期间不能把目标清空", () => {
  const { db, handler } = setup();
  let res = response();
  handler({ body: { dailyGoalUsdt: 150, dailyGoalBreakevenEnabled: true }, user: { name: "Owner" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.system.dailyGoalUsdt, 150);
  assert.equal(db.system.monthlyGoalUsdt, 4650);
  assert.equal(db.system.monthlyGoalDays, 31);
  assert.equal(db.system.monthlyGoalDerived, true);
  assert.equal(db.system.dailyGoalBreakevenEnabled, true);

  res = response();
  handler({ body: { dailyGoalUsdt: null }, user: { name: "Owner" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.system.dailyGoalUsdt, 150, "校验失败不能留下部分内存修改");
  assert.equal(db.system.dailyGoalBreakevenEnabled, true);
});

test("月目标只能由日目标乘当月天数派生，旧客户端传值也不能覆盖", () => {
  const { db, handler } = setup();
  const res = response();
  handler({ body: { dailyGoalUsdt: 100, monthlyGoalUsdt: 999999 }, user: { name: "Owner" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.system.monthlyGoalUsdt, 3100);
  assert.equal(db.system.monthlyGoalPeriod, "2026-08");
});
