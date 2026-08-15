import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "kconv-"));
const { adoptCandidate, approveCandidateArtifact, ignoreCandidate } = await import("../server/knowledgeConverter.mjs");

function mkDb() {
  return {
    knowledge: {
      candidates: [
        { id: "c_lens", type: "lens", name: "处置效应守卫", summary: "别过早止盈", sourceTitle: "交易心理分析", sourceRef: "Ch.5", payload: { promptText: "提醒:别过早止盈、别死扛亏损", trigger: "有持仓时", policyCode: "preserve_rr" }, status: "candidate" },
        { id: "c_wf", type: "workflow", name: "趋势三步", summary: "", sourceTitle: "以交易为生", payload: { steps: ["4H定方向", "1H找结构", "15m入场"], stepCodes: ["assess_regime", "analyze_structure", "propose_plan"] }, status: "candidate" }
      ]
    },
    auditLogs: [], meta: {}, user: { name: "T" }
  };
}

test("采纳 lens 只生成待独立审批草稿，审批后才激活", () => {
  const d = mkDb();
  const r = adoptCandidate(d, "c_lens");
  assert.equal(r.ok, true);
  assert.equal((d.knowledge.lenses || []).length, 1);
  assert.equal(d.knowledge.lenses[0].active, false);
  assert.equal(d.knowledge.lenses[0].promptApproval.status, "awaiting_approval");
  assert.equal(d.knowledge.lenses[0].promptText, "提醒:别过早止盈、别死扛亏损");
  assert.equal(d.knowledge.candidates.find((c) => c.id === "c_lens").status, "adopted");
  const approved = approveCandidateArtifact(d, "c_lens", "IndependentApprover");
  assert.equal(approved.ok, true);
  assert.equal(d.knowledge.lenses[0].active, true);
  assert.equal(d.knowledge.lenses[0].promptApproval.status, "approved");
});

test("采纳 workflow 保留步骤但需独立审批后才激活", () => {
  const d = mkDb();
  const r = adoptCandidate(d, "c_wf");
  assert.equal(r.ok, true);
  assert.equal(d.knowledge.workflows[0].steps.length, 3);
  assert.equal(d.knowledge.workflows[0].active, false);
  assert.equal(d.knowledge.workflows[0].promptApproval.status, "awaiting_approval");
  assert.equal(approveCandidateArtifact(d, "c_wf", "IndependentApprover").ok, true);
  assert.equal(d.knowledge.workflows[0].active, true);
});

test("重复采纳被拒(采纳即用是一次性动作)", () => {
  const d = mkDb();
  adoptCandidate(d, "c_lens");
  const r2 = adoptCandidate(d, "c_lens");
  assert.equal(r2.ok, false);
});

test("忽略 → status=ignored,不进任何能力集合", () => {
  const d = mkDb();
  const r = ignoreCandidate(d, "c_wf");
  assert.equal(r.ok, true);
  assert.equal(d.knowledge.candidates.find((c) => c.id === "c_wf").status, "ignored");
  assert.equal(d.knowledge.workflows, undefined);
});
