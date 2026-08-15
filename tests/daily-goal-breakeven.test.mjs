import assert from "node:assert/strict";
import test from "node:test";
import { dailyGoalBreakevenDecision, exchangeStopEvidence } from "../server/positionManager.mjs";

const now = Date.now();
const snapshotAt = new Date(now - 5_000).toISOString();

function fixture({ direction = "short", entry = 100, stop = 105, pnl = 150, enabled = true, target = 150 } = {}) {
  const position = {
    id: "managed-1",
    source: "execution_engine",
    executionOrderId: "exec-1",
    symbol: "BTC/USDT",
    direction,
    entry,
    stopLoss: stop,
    openedAt: new Date(now - 30_000).toISOString()
  };
  const exchangePosition = {
    id: "exchange-1",
    source: "exchange_rest",
    exchange: "OKX",
    symbol: "BTC/USDT",
    direction,
    pnl,
    entry,
    rawSyncedAt: snapshotAt
  };
  const db = {
    system: { dailyGoalBreakevenEnabled: enabled, dailyGoalUsdt: target },
    executionOrders: [{ id: "exec-1", stopClientOrderId: "stop-exec-1" }],
    accountSnapshots: [{
      id: "snap-1",
      exchange: "OKX",
      status: "ok",
      createdAt: snapshotAt,
      algoOrdersComplete: true,
      algoOrders: [{ instId: "BTC-USDT-SWAP", algoClOrdId: "stop-exec-1", slTriggerPx: String(stop) }]
    }]
  };
  return { db, position, exchangePosition };
}

test("单笔 OKX 浮盈达到明确日目标后，请求把较差止损保护到开仓价", () => {
  const { db, position, exchangePosition } = fixture();
  assert.deepEqual(dailyGoalBreakevenDecision(db, position, exchangePosition, now), {
    action: "move_to_entry",
    reason: "target_reached",
    targetUsdt: 150,
    unrealizedPnlUsdt: 150,
    entryPrice: 100,
    currentStopPrice: 105
  });
});

test("已有更优止损时不回退：空单低于开仓价、多单高于开仓价都保持不动", () => {
  let f = fixture({ direction: "short", stop: 98, pnl: 200 });
  assert.equal(dailyGoalBreakevenDecision(f.db, f.position, f.exchangePosition, now).reason, "already_protected");
  f = fixture({ direction: "long", stop: 102, pnl: 200 });
  assert.equal(dailyGoalBreakevenDecision(f.db, f.position, f.exchangePosition, now).reason, "already_protected");
});

test("未明确配置、未达到金额或缺少 OKX 权威证据时绝不改单", () => {
  let f = fixture({ enabled: false });
  assert.equal(dailyGoalBreakevenDecision(f.db, f.position, f.exchangePosition, now).reason, "disabled");
  f = fixture({ target: 0 });
  assert.equal(dailyGoalBreakevenDecision(f.db, f.position, f.exchangePosition, now).reason, "daily_goal_unconfigured");
  f = fixture({ pnl: 149.99 });
  assert.equal(dailyGoalBreakevenDecision(f.db, f.position, f.exchangePosition, now).reason, "target_not_reached");
  f = fixture();
  f.db.accountSnapshots[0].createdAt = new Date(now - 5 * 60_000).toISOString();
  assert.equal(dailyGoalBreakevenDecision(f.db, f.position, f.exchangePosition, now).reason, "exchange_stop_snapshot_unverified");
});

test("止损证据必须同时匹配最新 OKX 快照、合约和算法单身份", () => {
  const { db, position, exchangePosition } = fixture();
  assert.deepEqual(exchangeStopEvidence(db, position, exchangePosition, now), {
    verified: true,
    present: true,
    reason: null,
    stopPrice: 105,
    snapshotAt
  });
  db.accountSnapshots[0].algoOrders[0].algoClOrdId = "other-stop";
  assert.equal(exchangeStopEvidence(db, position, exchangePosition, now).reason, "exchange_stop_missing");
});
