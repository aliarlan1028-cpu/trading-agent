import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchMap } from "../src/researchMap.js";

test("research map joins native and knowledge-derived assets without treating them as one pipeline", () => {
  const map = buildResearchMap({
    knowledge: {
      sources: [
        { id: "ready", type: "pdf", status: "parsed" },
        { id: "working", type: "url", status: "processing" },
        { id: "bad", type: "pdf", status: "parse_failed" }
      ],
      chunks: [{ id: "chunk", sourceId: "ready" }],
      tradingMethods: [{ id: "method" }],
      tradingSkills: [
        { id: "candidate-strategy", sourceMethodId: "method", status: "historical_validated" },
        { id: "live-strategy", methodId: "method", status: "active" }
      ],
      candidates: [{ id: "workflow-candidate", type: "workflow", status: "candidate" }],
      workflows: [{ id: "knowledge-flow", title: "Knowledge Flow", runtimeApproved: true, publishedEligible: true }],
      ruleProposals: [{ id: "rule", status: "待审批" }]
    },
    strategyCatalog: {
      products: [{ id: "core", versionId: "core:v1", definition: { name: "Core" }, deployment: { state: "validated_active" } }],
      strategies: [{ id: "native", name: "Native", lifecycle: { stage: "research" }, contract: {} }]
    },
    analysisEngine: { tools: [{ id: "native-tool", name: "Native Tool", status: "enabled" }] },
    skills: [{ id: "imported", name: "Imported Tool", status: "active" }],
    mcpServers: [{ id: "mcp-news", serverName: "News MCP", status: "registered" }],
    reviews: [{ id: "review", type: "trade", status: "completed" }],
    ownerReviewLoop: {
      improvements: [{ id: "improvement", state: "pending_owner" }],
      lessons: [{ id: "lesson", status: "candidate" }]
    }
  });

  assert.deepEqual(map.sources, { total: 3, searchable: 1, processing: 1, failed: 1, chunks: 1 });
  assert.equal(map.strategies.total, 3);
  assert.deepEqual(map.strategies.origins, { system: 2, knowledge: 1, imported: 0 });
  assert.equal(map.capabilities.total, 4);
  assert.deepEqual(map.capabilities.origins, { system: 1, knowledge: 1, imported: 1, mcp: 1, registered: 0 });
  assert.equal(map.incubation.incubatingStrategies, 1);
  assert.equal(map.learning.completedReviews, 1);
  assert.equal(map.learning.pendingOwner, 1);
  assert.ok(map.actionQueue.some((item) => item.id === "failed-sources" && item.destination === "researchCenter:knowledge"));
  assert.ok(map.actionQueue.some((item) => item.id === "owner-pending" && item.destination === "ownerReviewWorkspace"));
});

test("research map fails closed on empty and unknown source state", () => {
  const map = buildResearchMap({ knowledge: { sources: [{ id: "unknown", status: "mystery" }] } });
  assert.equal(map.sources.total, 1);
  assert.equal(map.sources.searchable, 0);
  assert.equal(map.strategies.total, 0);
  assert.equal(map.capabilities.total, 0);
  assert.deepEqual(map.actionQueue, []);
});
