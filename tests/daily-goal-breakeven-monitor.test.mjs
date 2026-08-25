import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "daily-goal-monitor-test-"));
delete process.env.LARK_WEBHOOK_URL;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const { monitorPositions } = await import("../server/positionManager.mjs");

function fixture() {
  const snapshotAt = new Date().toISOString();
  const managed = {
    id: "managed-1", source: "execution_engine", executionOrderId: "exec-1",
    symbol: "BTC/USDT", direction: "short", entry: 100, size: 1, stopLoss: 105,
    takeProfits: [], openedAt: new Date(Date.now() - 60_000).toISOString()
  };
  const exchange = {
    id: "exchange-1", source: "exchange_rest", exchange: "OKX", symbol: "BTC/USDT",
    posSide: "short", direction: "short", entry: 100, mark: 99, pnl: 150, size: 1,
    rawSyncedAt: snapshotAt
  };
  return {
    meta: {}, auditLogs: [], traces: [], notifications: [], riskIncidents: [], fills: [],
    system: { dailyGoalUsdt: 150, dailyGoalBreakevenEnabled: true },
    portfolio: {}, markets: [{
      symbol: "BTC/USDT", price: 99, fundingRate: 0,
      tickerSourceAt: snapshotAt, tickerReceivedAt: snapshotAt,
      lastRealtimeAt: snapshotAt, microSyncedAt: snapshotAt
    }],
    positions: [managed, exchange],
    executionOrders: [{ id: "exec-1", exchange: "OKX", stopClientOrderId: "stop-exec-1" }],
    accountSnapshots: [{
      id: "snap-1", exchange: "OKX", status: "ok", createdAt: snapshotAt,
      algoOrders: [{ instId: "BTC-USDT-SWAP", algoClOrdId: "stop-exec-1", slTriggerPx: "105" }],
      algoOrdersComplete: true
    }]
  };
}

test("持仓巡检只在 OKX 确认改单后回写每日目标保本状态", async () => {
  const db = fixture();
  const calls = [];
  const result = await monitorPositions(db, {
    executeTradeAction: async (_db, action, payload) => {
      calls.push({ action, payload });
      return { status: "ok", stopPrice: payload.stopPrice };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "move_stop");
  assert.equal(calls[0].payload.stopPrice, 100);
  assert.equal(db.positions[0].stopLoss, 100);
  assert.equal(db.positions[0].dailyGoalBreakevenStatus, "confirmed");
  assert.equal(db.system.dailyGoalProtectionLastEvent.status, "confirmed");
  assert.ok(result.actions.some((item) => item.action === "daily_goal_breakeven_confirmed"));
});

test("OKX 未确认时保留原止损并记录可重试失败", async () => {
  const db = fixture();
  let attempts = 0;
  const result = await monitorPositions(db, {
    executeTradeAction: async () => { attempts += 1; return { status: "exchange_rejected" }; }
  });
  assert.equal(db.positions[0].stopLoss, 105);
  assert.equal(db.positions[0].dailyGoalBreakevenStatus, "move_failed");
  assert.equal(db.system.dailyGoalProtectionLastEvent.status, "move_failed");
  assert.ok(result.actions.some((item) => item.action === "daily_goal_breakeven_failed"));
  await monitorPositions(db, { executeTradeAction: async () => { attempts += 1; return { status: "exchange_rejected" }; } });
  assert.equal(attempts, 1, "一分钟重试冷却内不能持续轰炸交易所改单接口");
});

test("scheduler-owned position monitoring can defer its internal duplicate save", async () => {
  const db = fixture();
  let saves = 0;

  await monitorPositions(db, {
    deferPersistence: true,
    saveDb() { saves += 1; },
    executeTradeAction: async (_database, _action, payload) => ({ status: "ok", stopPrice: payload.stopPrice })
  });

  assert.equal(saves, 0, "外层 scheduler 会在风控保护评估完成后统一持久化，内部不得提前重复全库保存");
});
