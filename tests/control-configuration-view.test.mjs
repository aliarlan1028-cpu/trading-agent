import assert from "node:assert/strict";
import test from "node:test";
import {
  buildControlConfigurationView,
  CONFIGURATION_DESTINATIONS,
  resolveControlRecoveryRoute
} from "../src/controlConfigurationView.js";

test("control view separates effective runtime truth from saved configuration", () => {
  const view = buildControlConfigurationView({
    automationState: {
      mode: "reduce_only",
      requestedMode: "full_auto",
      runtimeStatus: "opening_paused",
      blockerDetails: [{ code: "private_rest_positions", label: "OKX 账户尚未同步" }]
    },
    system: { killSwitch: false },
    config: { liveTrading: { maxNotionalUsdt: 60 } },
    agentStatus: { activeMandate: { id: "m1", version: 4, status: "active", allowedSymbols: ["BTC/USDT"], maxOrderNotionalUsdt: 80, maxLeverage: 3 } },
    tradingCapacity: { freshForExecution: true, maxNotional: 50 },
    readiness: { checks: [
      { key: "private_rest_positions", configured: false },
      { key: "withdraw_permission_detection", configured: true },
      { key: "audit_chain", configured: true }
    ] }
  });
  assert.equal(view.runtime.requestedMode, "full_auto");
  assert.equal(view.runtime.targetIsEffective, false);
  assert.equal(view.runtime.blockers[0].route, CONFIGURATION_DESTINATIONS.exchange);
  assert.equal(view.mandate.effectiveOrderLimitUsdt, 50);
  assert.equal(view.checksPassed, 4);
});

test("control recovery routes point to the authoritative configuration context", () => {
  assert.equal(resolveControlRecoveryRoute({ code: "llm_unavailable" }), "systemSettings:models");
  assert.equal(resolveControlRecoveryRoute({ label: "交易权限未激活" }), "systemSettings:trading");
  assert.equal(resolveControlRecoveryRoute({ label: "风险规则阈值缺失" }), "systemSettings:risk");
  assert.equal(resolveControlRecoveryRoute({ label: "事件源未配置" }), "systemSettings:event-sources");
  assert.equal(resolveControlRecoveryRoute({ label: "账户对账未完成" }), "operationsCenter");
});

test("configuration destinations keep durable editors out of Control", () => {
  assert.deepEqual(Object.values(CONFIGURATION_DESTINATIONS).filter((route) => route.startsWith("riskCenter")), []);
  assert.equal(CONFIGURATION_DESTINATIONS.trading, "systemSettings:trading");
  assert.equal(CONFIGURATION_DESTINATIONS.risk, "systemSettings:risk");
});
