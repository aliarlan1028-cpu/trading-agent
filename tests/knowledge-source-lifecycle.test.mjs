import test from "node:test";
import assert from "node:assert/strict";
import { detachKnowledgeSource } from "../server/routes/knowledgeImport.mjs";

test("deleting one source preserves shared knowledge and approved audit artifacts", () => {
  const db = {
    knowledge: {
      sources: [{ id: "s1" }, { id: "s2" }],
      documentNodes: [{ id: "n1", sourceId: "s1" }, { id: "n2", sourceId: "s2" }],
      chunks: [{ id: "c1", sourceId: "s1" }, { id: "c2", sourceId: "s2" }],
      tradingMethods: [{ id: "m1", source: { id: "s1" } }, { id: "m2", sourceId: "s2" }],
      reviewTemplates: [{ id: "t1", sourceId: "s1" }, { id: "t2", sourceId: "s2" }],
      strategyHypotheses: [{ id: "h1", sourceId: "s1" }, { id: "h2", sourceId: "s2" }],
      candidates: [
        { id: "candidate", sourceId: "s1", status: "candidate" },
        { id: "adopted", sourceId: "s1", status: "adopted" },
        { id: "other", sourceId: "s2", status: "candidate" }
      ],
      conceptCards: [
        { id: "shared", sourceRefs: ["s1", "s2"] },
        { id: "only-s1", sourceRefs: ["s1"] },
        { id: "only-s2", sourceRefs: ["s2"] }
      ],
      theoryFrameworks: [
        { id: "fw-shared", sourceRefs: ["s1", "s2"] },
        { id: "fw-only", sourceRefs: ["s1"] }
      ],
      ruleProposals: [
        { id: "approved", status: "已批准", sourceRefs: ["s1"] },
        { id: "pending-shared", status: "待审批", sourceRefs: ["s1", "s2"] },
        { id: "pending-only", status: "待审批", sourceRefs: ["s1"] }
      ]
    }
  };

  detachKnowledgeSource(db, "s1");

  assert.deepEqual(db.knowledge.sources.map((item) => item.id), ["s2"]);
  assert.deepEqual(db.knowledge.conceptCards.map((item) => item.id), ["shared", "only-s2"]);
  assert.deepEqual(db.knowledge.conceptCards.find((item) => item.id === "shared").sourceRefs, ["s2"]);
  assert.deepEqual(db.knowledge.theoryFrameworks.map((item) => item.id), ["fw-shared"]);
  assert.deepEqual(db.knowledge.theoryFrameworks[0].sourceRefs, ["s2"]);
  assert.deepEqual(db.knowledge.ruleProposals.map((item) => item.id), ["approved", "pending-shared"]);
  assert.deepEqual(db.knowledge.ruleProposals.find((item) => item.id === "approved").sourceRefs, []);
  assert.ok(db.knowledge.ruleProposals.find((item) => item.id === "approved").sourceDeletedAt);
  assert.deepEqual(db.knowledge.ruleProposals.find((item) => item.id === "pending-shared").sourceRefs, ["s2"]);
  assert.deepEqual(db.knowledge.candidates.map((item) => item.id), ["adopted", "other"]);
  assert.equal(db.knowledge.candidates.find((item) => item.id === "adopted").sourceId, null);
  assert.ok(db.knowledge.candidates.find((item) => item.id === "adopted").sourceDeletedAt);
  assert.deepEqual(db.knowledge.tradingMethods.map((item) => item.id), ["m2"]);
  assert.deepEqual(db.knowledge.chunks.map((item) => item.id), ["c2"]);
});
