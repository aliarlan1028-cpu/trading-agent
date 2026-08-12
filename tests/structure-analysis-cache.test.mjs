import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "structure-cache-test-"));
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.DEEPSEEK_API_KEY = "";

const { analyzeMarketStructure } = await import("../server/setupReview.mjs");

test("确定性结构分析可复用 TTL 内缓存，不发起重复行情请求", async () => {
  const cached = {
    available: true,
    version: 3,
    symbol: "BTC/USDT",
    bias: "LONG",
    structure4h: "BOS up",
    analyzedAt: new Date().toISOString(),
    cacheHit: false
  };
  const db = {
    structureAnalysisCache: { "v3|BTC/USDT|long|auto": cached },
    traces: []
  };
  const result = await analyzeMarketStructure(db, "BTC/USDT", "long");
  assert.equal(result.available, true);
  assert.equal(result.cacheHit, true);
  assert.equal(result.bias, "LONG");
});
