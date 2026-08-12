import assert from "node:assert/strict";
import test from "node:test";

for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY"]) delete process.env[key];
const { runAgentMission } = await import(`../server/eventSources.mjs?mission-test=${Date.now()}`);

test("情报自由任务在证据未变化时不重复生成通知", async () => {
  const now = new Date().toISOString();
  const task = { id: "mission_1", name: "追踪 BTC ETF", mission: "追踪 BTC ETF" };
  const db = {
    meta: { defaultSourcesRestored: true }, eventSources: [], notifications: [], auditLogs: [], traces: [], riskIncidents: [],
    events: [{
      id: "event_1", title: "BTC · ETF 专题", topicTags: ["BTC", "ETF"], topicKey: "BTC+ETF",
      relatedSymbols: ["BTC/USDT"], impact: 80, impactLabel: "高影响", directionHint: "方向待观察",
      action: "等待官方确认", updateCount: 1, createdAt: now, lastUpdatedAt: now,
      timeline: [{ at: now, source: "official", title: "ETF update", link: "https://example.com/update" }]
    }]
  };
  const first = await runAgentMission(db, task);
  const second = await runAgentMission(db, task);
  assert.equal(first.status, "partial");
  assert.equal(second.status, "unchanged");
  assert.equal(db.notifications.length, 1);
  assert.deepEqual(task.lastEvidenceIds, ["event_1"]);
});
