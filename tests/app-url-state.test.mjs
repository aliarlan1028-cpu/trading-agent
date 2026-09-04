import assert from "node:assert/strict";
import test from "node:test";
import {
  appHrefForRoute,
  appPathForRoute,
  appRouteFromPath,
  syncAppHistory
} from "../src/appUrlState.js";

const visibleRoutes = [
  ["chat", "/app/ai/dialog"],
  ["chat:intelligence", "/app/ai/intelligence"],
  ["watch", "/app/ai/watch"],
  ["cockpit", "/app/trade/overview"],
  ["market", "/app/trade/market"],
  ["positions", "/app/trade/positions"],
  ["tradeJournal", "/app/trade/execution-review"],
  ["tradeLedger", "/app/trade/orders-fills"],
  ["tradeOrders", "/app/trade/orders"],
  ["tradeFills", "/app/trade/fills"],
  ["labReviews", "/app/trade/reviews"],
  ["knowledgeBase", "/app/research/knowledge"],
  ["strategyLib", "/app/research/strategies"],
  ["strategyStudio", "/app/research/strategies/studio"],
  ["strategyMarket", "/app/research/strategies/market"],
  ["strategyResearch", "/app/research/strategies/backtests"],
  ["capabilities", "/app/research/capabilities"],
  ["riskOverview", "/app/risk/overview"],
  ["eventRisk", "/app/risk/events"],
  ["riskMandate", "/app/risk/boundaries"],
  ["riskSettings", "/app/risk/rules"],
  ["riskKeys", "/app/risk/key-security"],
  ["operationsCenter", "/app/operations/overview"],
  ["eventsTasks:events", "/app/operations/events"],
  ["eventsTasks:tasks", "/app/operations/tasks"],
  ["auditSystem", "/app/operations/audit"],
  ["notifications", "/app/operations/notifications"],
  ["systemSettings", "/app/settings/overview"],
  ["systemSettings:base", "/app/settings/basics"],
  ["systemSettings:runtime", "/app/settings/runtime"],
  ["systemSettings:notifications", "/app/settings/notifications"],
  ["systemSettings:event-sources", "/app/settings/event-sources"],
  ["systemSettings:exchange", "/app/settings/exchanges"],
  ["systemSettings:models", "/app/settings/models"],
  ["systemSettings:agents", "/app/settings/agents"],
  ["systemSettings:users", "/app/settings/users"]
];

test("visible authenticated destinations have stable, reversible URLs", () => {
  for (const [route, path] of visibleRoutes) {
    assert.equal(appPathForRoute(route), path, route);
    assert.equal(appRouteFromPath(path), route, path);
  }
});

test("app root remains a backwards-compatible deep link to AI Trader", () => {
  assert.equal(appRouteFromPath("/app"), "chat");
  assert.equal(appRouteFromPath("/app/"), "chat");
  assert.equal(appRouteFromPath("/outside"), null);
});

test("review object deep links preserve the full object identity", () => {
  const route = "tradeReviewDetail:REV:389/alpha";
  const path = "/app/trade/reviews/REV%3A389%2Falpha";
  assert.equal(appPathForRoute(route), path);
  assert.equal(appRouteFromPath(path), route);
});

test("history href keeps existing search and hash state", () => {
  assert.equal(
    appHrefForRoute("positions", { search: "?tenant=owner", hash: "#context" }),
    "/app/trade/positions?tenant=owner#context"
  );
});

test("history synchronization pushes, replaces, and skips duplicate paths", () => {
  const calls = [];
  const history = {
    state: { retained: true },
    pushState: (...args) => calls.push(["push", ...args]),
    replaceState: (...args) => calls.push(["replace", ...args])
  };
  const location = { pathname: "/app", search: "", hash: "" };

  assert.equal(syncAppHistory("market", { history, location }), true);
  assert.deepEqual(calls[0], ["push", { retained: true, kordynRoute: "market" }, "", "/app/trade/market"]);

  location.pathname = "/app/trade/market";
  assert.equal(syncAppHistory("market", { history, location }), false);
  assert.equal(calls.length, 1);

  assert.equal(syncAppHistory("chat", { history, location, mode: "replace" }), true);
  assert.deepEqual(calls[1], ["replace", { retained: true, kordynRoute: "chat" }, "", "/app/ai/dialog"]);
});
