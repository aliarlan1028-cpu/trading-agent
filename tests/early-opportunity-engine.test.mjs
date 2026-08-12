import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "early-opportunity-test-"));

const {
  computeEarlyOpportunityFeatures,
  computeEarlyReversalFeatures,
  assessAbnormalVolatility,
  consumeOpportunitySignals,
  prunePendingOpportunitySignals,
  recordOpportunityTick
} = await import("../server/earlyOpportunityEngine.mjs");

test("5分钟异动评估严格区分已发生、风险升高与样本不足", () => {
  const db = fixture();
  const now = 2_000_100_000_000;
  db.marketFeatureState["BTC/USDT"] = {
    updatedAt: new Date(now).toISOString(),
    samples: [100, 101, 102, 104, 106].map((p, index) => ({ t: now - (4 - index) * 75_000, p, oi: 1000 + index, v: 1_000_000 + index * 10_000 }))
  };
  const confirmed = assessAbnormalVolatility(db, "BTC/USDT", { now, thresholdPct: 5 });
  assert.equal(confirmed.status, "confirmed");
  assert.ok(confirmed.realizedMovePct >= 5);
  assert.match(confirmed.caveat, /实测/);

  const empty = assessAbnormalVolatility(fixture(), "BTC/USDT", { now });
  assert.equal(empty.status, "insufficient_data");
  assert.match(empty.caveat, /不得用知识库或猜测/);
});

function fixture() {
  return {
    system: {},
    mandates: [{ id: "m1", status: "active", version: 1, allowedSymbols: ["BTC/USDT"], activatedAt: new Date().toISOString() }],
    markets: [{ symbol: "BTC/USDT", high24h: 103, low24h: 90, spreadBps: 2 }],
    marketFeatureState: {},
    opportunityCandidates: [],
    opportunityEvents: [],
    auditLogs: [],
    traces: []
  };
}

test("流式短窗口能在 24h 涨完之前发现加速候选并去重排队", () => {
  const db = fixture();
  const base = 2_000_000_000_000;
  const prices = [100, 100.2, 100.4, 100.6, 101, 102];
  let last;
  for (let i = 0; i < prices.length; i += 1) {
    last = recordOpportunityTick(db, "BTC/USDT", {
      price: prices[i],
      openInterest: 1000 + i * 5,
      volume24h: 1_000_000 + i * 20_000,
      high24h: 103,
      low24h: 90,
      spreadBps: 2
    }, base + i * 15_000);
  }
  assert.ok(["discovered", "updated"].includes(last.status));
  assert.equal(db.system.pendingOpportunitySignals.length, 1);
  assert.equal(last.candidate.direction, "long");
  assert.ok(last.features.score >= 55);
  assert.ok(last.features.evidenceCount >= 2);
  recordOpportunityTick(db, "BTC/USDT", { price: 102.2, openInterest: 1030, volume24h: 1_130_000 }, base + 5 * 15_000 + 5_000);
  assert.equal(db.system.pendingOpportunitySignals.length, 1, "同一候选在待处理队列中不得重复排队");
  const consumed = consumeOpportunitySignals(db, 2);
  assert.equal(consumed.length, 1);
  assert.equal(db.opportunityCandidates[0].status, "ANALYZING");
});

test("30–60 秒启动段可被发现，不必等待 3m/5m 或 24h 动量", () => {
  const db = fixture();
  const base = 2_050_000_000_000;
  const prices = [100, 100.05, 100.15, 100.4, 100.8];
  let result;
  for (let i = 0; i < prices.length; i += 1) {
    result = recordOpportunityTick(db, "BTC/USDT", {
      price: prices[i],
      openInterest: 1000 + i * 4,
      volume24h: 1_000_000 + i * 10_000,
      high24h: 103,
      low24h: 90,
      spreadBps: 2
    }, base + i * 15_000);
  }
  assert.ok(["discovered", "updated"].includes(result.status));
  assert.equal(result.candidate.direction, "long");
  assert.ok(result.features.ret30sPct > 0);
  assert.equal(db.system.pendingOpportunitySignals.length, 1);
});

test("预热不足或弱波动不会制造机会", () => {
  const db = fixture();
  const base = 2_100_000_000_000;
  let result = recordOpportunityTick(db, "BTC/USDT", { price: 100 }, base);
  assert.equal(result.status, "insufficient_samples");
  result = recordOpportunityTick(db, "BTC/USDT", { price: 100.01 }, base + 60_000);
  assert.equal(result.status, "below_threshold");
  assert.equal(db.opportunityCandidates.length, 0);
  assert.equal(db.system.pendingOpportunitySignals?.length || 0, 0);
});

test("断线后的旧样本不能冒充 15/30 秒急动，陈旧待处理信号会被清理", () => {
  const now = 2_200_000_000_000;
  const features = computeEarlyOpportunityFeatures([
    { t: now - 10 * 60_000, p: 100, oi: 1000, v: 1_000_000 },
    { t: now, p: 105, oi: 1100, v: 1_100_000 }
  ], { high24h: 106, low24h: 90, spreadBps: 2 }, now);
  assert.equal(features.ready, false);
  assert.equal(features.reason, "no_direction");

  const db = fixture();
  db.opportunityCandidates.push({ id: "old", symbol: "BTC/USDT", direction: "long", status: "DISCOVERED", expiresAt: new Date(now - 1).toISOString() });
  db.system.pendingOpportunitySignals = [{ candidateId: "old", symbol: "BTC/USDT", queuedAt: new Date(now - 31 * 60_000).toISOString() }];
  assert.equal(prunePendingOpportunitySignals(db, now).length, 1);
  assert.equal(db.system.pendingOpportunitySignals.length, 0);
  assert.equal(db.opportunityCandidates.at(-1).status, "EXPIRED");
});

test("待处理机会按分数取最强两个，不受入队先后误导", () => {
  const db = fixture();
  const now = new Date().toISOString();
  db.opportunityCandidates = [
    { id: "low", status: "DISCOVERED" },
    { id: "high", status: "DISCOVERED" },
    { id: "mid", status: "DISCOVERED" }
  ];
  db.system.pendingOpportunitySignals = [
    { candidateId: "low", score: 56, queuedAt: now },
    { candidateId: "high", score: 91, queuedAt: now },
    { candidateId: "mid", score: 72, queuedAt: now }
  ];
  const consumed = consumeOpportunitySignals(db, 2);
  assert.deepEqual(consumed.map((row) => row.candidateId), ["high", "mid"]);
  assert.deepEqual(db.system.pendingOpportunitySignals.map((row) => row.candidateId), ["low"]);
});

test("低位必须出现下跌腿、极值回收和短动量翻向才成为反转多头候选", () => {
  const now = 2_300_000_000_000;
  const samples = [96, 95.5, 94.8, 94.2, 94.5].map((price, index) => ({
    t: now - (4 - index) * 15_000,
    p: price,
    oi: 1000 - index * 2,
    v: 1_000_000 + index * 10_000
  }));
  const reversal = computeEarlyReversalFeatures(samples, { high24h: 110, low24h: 90, bookImbalancePct: 57 }, now);
  assert.equal(reversal.qualified, true);
  assert.equal(reversal.direction, "long");
  assert.equal(reversal.setupType, "reversal_reclaim");
  assert.ok(reversal.confirmations.includes("reclaimedLow"));
  assert.ok(reversal.confirmations.includes("momentumFlip"));
});

test("只有低位没有回收确认不能被误判为做多", () => {
  const now = 2_310_000_000_000;
  const samples = [96, 95.5, 95, 94.5, 94.2].map((price, index) => ({ t: now - (4 - index) * 15_000, p: price, v: 1_000_000 }));
  const reversal = computeEarlyReversalFeatures(samples, { high24h: 110, low24h: 90 }, now);
  assert.equal(reversal.qualified, false);
  assert.ok(reversal.missing.includes("reclaimedLow") || reversal.missing.includes("momentumFlip"));
});

test("旧空头动量仍在但低位反转证据齐全时，排队方向切换为反转多头", () => {
  const db = fixture();
  db.markets[0] = { symbol: "BTC/USDT", high24h: 110, low24h: 90, spreadBps: 2, bookImbalancePct: 57, candles: [] };
  const base = 2_320_000_000_000;
  db.opportunityCandidates.push({
    id: "old-short", symbol: "BTC/USDT", direction: "short", status: "DISCOVERED",
    source: "OKX_WS_EARLY", expiresAt: new Date(base + 60_000).toISOString()
  });
  db.system.pendingOpportunitySignals = [{
    candidateId: "old-short", symbol: "BTC/USDT", direction: "short", score: 70,
    queuedAt: new Date(base).toISOString()
  }];
  const prices = [96, 95.5, 94.8, 94.2, 94.5];
  let result;
  for (let index = 0; index < prices.length; index += 1) {
    result = recordOpportunityTick(db, "BTC/USDT", {
      price: prices[index], high24h: 110, low24h: 90, spreadBps: 2,
      openInterest: 1000 - index * 2, volume24h: 1_000_000 + index * 10_000
    }, base + index * 15_000);
  }
  assert.ok(["discovered", "updated"].includes(result.status));
  assert.equal(result.candidate.direction, "long");
  assert.equal(result.candidate.features.setupType, "reversal_reclaim");
  assert.equal(db.system.pendingOpportunitySignals[0].direction, "long");
  assert.equal(db.system.pendingOpportunitySignals.length, 1, "相反方向旧信号必须从待办移除");
  assert.equal(db.opportunityCandidates.find((item) => item.id === "old-short").status, "SUPERSEDED");
});
