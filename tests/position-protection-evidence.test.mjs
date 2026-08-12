import test from "node:test";
import assert from "node:assert/strict";
import { stopProtectionFailureReason } from "../server/positionManager.mjs";

const now = Date.now();
const snapshotAt = new Date(now - 10_000).toISOString();
function fixture(algoOrders = []) {
  const position = {
    source: "execution_engine",
    executionOrderId: "execution1",
    symbol: "BTC/USDT",
    size: 0.01,
    stopLoss: 90000,
    openedAt: new Date(now - 30_000).toISOString()
  };
  const exchangePosition = { source: "exchange_rest", exchange: "OKX", symbol: "BTC/USDT", rawSyncedAt: snapshotAt };
  const db = {
    executionOrders: [{ id: "execution1", stopClientOrderId: "stopExecution1" }],
    accountSnapshots: [{ exchange: "OKX", status: "ok", createdAt: snapshotAt, algoOrders }]
  };
  return { db, position, exchangePosition };
}

test("持仓管理只把同合约同客户端算法单号的 OKX 止损视为保护证据", () => {
  const { db, position, exchangePosition } = fixture([{
    instId: "BTC-USDT-SWAP", algoClOrdId: "stopExecution1", slTriggerPx: "90000"
  }]);
  assert.equal(stopProtectionFailureReason(db, position, exchangePosition, now), null);
  db.accountSnapshots[0].algoOrders = [];
  assert.equal(stopProtectionFailureReason(db, position, exchangePosition, now), "exchange_stop_missing");
});

test("旧于开仓或未对应当前镜像的快照不能作为止损缺失证据", () => {
  const { db, position, exchangePosition } = fixture([]);
  db.accountSnapshots[0].createdAt = new Date(now - 60_000).toISOString();
  position.openedAt = new Date(now - 30_000).toISOString();
  assert.equal(stopProtectionFailureReason(db, position, exchangePosition, now), null);
});

test("本地止损或止损身份丢失无需等待交易所证据", () => {
  const { db, position, exchangePosition } = fixture([]);
  position.stopLoss = null;
  assert.equal(stopProtectionFailureReason(db, position, exchangePosition, now), "local_stop_missing");
  position.stopLoss = 90000;
  db.executionOrders[0].stopClientOrderId = null;
  assert.equal(stopProtectionFailureReason(db, position, exchangePosition, now), "stop_identity_missing");
});
