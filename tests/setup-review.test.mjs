import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "setup-review-"));
delete process.env.DEEPSEEK_API_KEY; delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;

const { reviewTradeSetup } = await import("../server/setupReview.mjs");

function db() { return { auditLogs: [], traces: [], meta: {} }; }

test("SRTL 盈亏比硬门槛：低于门槛直接 FAIL，不依赖 LLM", async () => {
  // 多单：入场100 止损98(2%) 止盈101(1%) → R=0.5 < 2.0
  const r = await reviewTradeSetup(db(), {
    id: "p1", symbol: "BTC/USDT", direction: "long", entry: 100, stopLoss: 98, takeProfit: [101]
  }, { minR: 2.0 });
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.rewardRisk.r < 2.0);
});

test("盈亏比达标且无 LLM 时判 SKIP（不做假审核，如实标注）", async () => {
  // R = (108-100)/(100-96) = 2.0 == 门槛
  const r = await reviewTradeSetup(db(), {
    id: "p2", symbol: "BTC/USDT", direction: "long", entry: 100, stopLoss: 96, takeProfit: [108]
  }, { minR: 2.0 });
  assert.equal(r.verdict, "SKIP");
});

test("空单盈亏比方向正确", async () => {
  // 空单：入场100 止损103(风险3) 止盈91(收益9) → R=3.0 达标 → 无LLM → SKIP
  const r = await reviewTradeSetup(db(), {
    id: "p3", symbol: "ETH/USDT", direction: "short", entry: 100, stopLoss: 103, takeProfit: [91]
  }, { minR: 2.0 });
  assert.equal(r.rewardRisk.r, 3);
  assert.equal(r.verdict, "SKIP");
});
