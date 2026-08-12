import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { backfillToolUsage, classifyToolOutcome, recordToolExecution, toolUsageView } from "../server/toolUsage.mjs";
import { normalizeDatabase, seedDatabase } from "../server/store.mjs";

test("工具结果按成功、阻断、失败确定性分类", () => {
  assert.equal(classifyToolOutcome({ status: "ok" }, "完成"), "success");
  assert.equal(classifyToolOutcome({ status: "blocked" }, "样本不足"), "blocked");
  assert.equal(classifyToolOutcome({ error: "network" }, "失败：network"), "error");
});

test("每次工具调用写明细并只增加一次汇总", () => {
  const db = { meta: {}, toolExecutions: [], toolCallStats: {} };
  recordToolExecution(db, {
    runId: "run_1", sessionId: "chat_1", name: "sync_market",
    args: { symbol: "BTC/USDT" }, result: { status: "fresh" },
    summary: "BTC/USDT 现价 60000", latencyMs: 125,
    startedAt: "2026-08-09T01:00:00.000Z", finishedAt: "2026-08-09T01:00:00.125Z"
  });
  assert.equal(db.toolExecutions.length, 1);
  assert.equal(db.toolCallStats.sync_market.calls, 1);
  assert.equal(db.toolCallStats.sync_market.success, 1);
  assert.equal(db.toolCallStats.sync_market.totalLatencyMs, 125);
  assert.deepEqual(toolUsageView(db.toolCallStats.sync_market), {
    calls: 1, success: 1, blocked: 0, error: 0, successRatePct: 100,
    avgLatencyMs: 125, lastStatus: "success",
    firstAt: "2026-08-09T01:00:00.125Z", lastAt: "2026-08-09T01:00:00.125Z"
  });
});

test("历史回填只执行一次，Skill 评估次数取较大值而不叠加", () => {
  const db = {
    meta: {}, toolExecutions: [], toolCallStats: {},
    chatMessages: [{
      id: "msg_1", sessionId: "chat_1", createdAt: "2026-08-08T01:00:00.000Z",
      toolTrace: [
        { name: "sync_market", summary: "完成", latencyMs: 10 },
        { name: "mtf_trend_alignment", summary: "完成", latencyMs: 20 }
      ]
    }],
    skills: [{ toolName: "mtf_trend_alignment", evalMetrics: { calls: 3, passed: 2, blocked: 1, failed: 0 }, lastCalledAt: "2026-08-08T02:00:00.000Z" }]
  };
  const first = backfillToolUsage(db, { now: "2026-08-09T00:00:00.000Z" });
  const second = backfillToolUsage(db, { now: "2026-08-09T00:01:00.000Z" });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(db.toolCallStats.sync_market.calls, 1);
  assert.equal(db.toolCallStats.mtf_trend_alignment.calls, 3);
  assert.equal(db.toolExecutions.length, 2);
});

test("toolCallStats 保存后可由新进程重新加载", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "trading-agent-tool-usage-"));
  const cwd = path.resolve(import.meta.dirname, "..");
  const env = { ...process.env, DATA_DIR: dataDir };
  const writer = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { loadDb, saveDb } from "./server/store.mjs";
    import { recordToolExecution } from "./server/toolUsage.mjs";
    const db = loadDb();
    recordToolExecution(db, { name: "get_account", result: { status: "available" }, summary: "持仓 0", latencyMs: 4 });
    saveDb(db);
  `], { cwd, env, encoding: "utf8" });
  assert.equal(writer.status, 0, writer.stderr);
  const reader = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { loadDbReadOnlySnapshot } from "./server/store.mjs";
    const db = loadDbReadOnlySnapshot();
    process.stdout.write(JSON.stringify(db.toolCallStats.get_account));
  `], { cwd, env, encoding: "utf8" });
  try {
    assert.equal(reader.status, 0, reader.stderr);
    const stat = JSON.parse(reader.stdout);
    assert.equal(stat.calls, 1);
    assert.equal(stat.success, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("升级迁移移除 CoinGecko MCP，但保留其他 MCP", () => {
  const db = seedDatabase();
  db.mcpServers = [
    { id: "mcp_coingecko", name: "CoinGecko 行情", enabled: true },
    { id: "mcp_internal_news", name: "内部新闻", enabled: true }
  ];
  normalizeDatabase(db);
  assert.deepEqual(db.mcpServers.map((server) => server.id), ["mcp_internal_news"]);
});
