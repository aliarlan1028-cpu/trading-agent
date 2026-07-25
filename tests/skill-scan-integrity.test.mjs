import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanSkill } from "../server/skillManager.mjs";

test("Skill scan checksum covers real package content and never fakes a sandbox pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-scan-"));
  fs.writeFileSync(path.join(root, "SKILL.md"), "# Safe skill\n");
  const db = { skills: [{ id: "s1", name: "safe", localPath: root, permissions: ["web.read"] }], auditLogs: [], traces: [], meta: {} };
  const first = scanSkill(db, "s1").scanReport;
  fs.writeFileSync(path.join(root, "SKILL.md"), "# Changed skill\n");
  const second = scanSkill(db, "s1").scanReport;
  assert.notEqual(first.checksum, second.checksum);
  assert.equal(second.contentVerified, true);
  assert.equal(second.sandboxSmokeTest, "not_run");
});
