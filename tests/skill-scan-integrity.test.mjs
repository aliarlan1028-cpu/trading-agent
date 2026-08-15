import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanSkill, verifySkillPackageIntegrity } from "../server/skillManager.mjs";
import { readSkillInstructions, validateSkillPackageTree } from "../server/skillSandbox.mjs";

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

test("Skill packages reject relative, absolute and nested symlink escapes", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "skill-link-"));
  const secret = path.join(parent, "host-secret.env");
  fs.writeFileSync(secret, "HOST_SECRET_CANARY=never-read\n", { mode: 0o600 });
  for (const [name, target] of [
    ["relative", "../host-secret.env"],
    ["absolute", secret]
  ]) {
    const root = path.join(parent, name);
    fs.mkdirSync(root);
    fs.symlinkSync(target, path.join(root, "SKILL.md"));
    const db = { skills: [{ id: name, name, localPath: root, entryFile: "SKILL.md", permissions: ["web.read"] }], auditLogs: [], traces: [], meta: {} };
    const scanned = scanSkill(db, name).scanReport;
    assert.equal(scanned.status, "failed", name);
    assert.match(scanned.error, /links|entry/i);
    assert.equal(await readSkillInstructions(db.skills[0]), "");
    await assert.rejects(() => validateSkillPackageTree(root), /links/i);
  }

  const nested = path.join(parent, "nested");
  fs.mkdirSync(path.join(nested, "docs"), { recursive: true });
  fs.symlinkSync(secret, path.join(nested, "docs", "SKILL.md"));
  await assert.rejects(() => validateSkillPackageTree(nested), /links/i);
});

test("trust-time integrity detects scan-after-change while ordinary packages remain readable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-integrity-"));
  fs.writeFileSync(path.join(root, "SKILL.md"), "# Safe skill\n\nUse deterministic inputs.\n", { mode: 0o600 });
  const skill = { id: "safe", name: "safe", localPath: root, entryFile: "SKILL.md", permissions: ["web.read"] };
  const db = { skills: [skill], auditLogs: [], traces: [], meta: {} };
  const report = scanSkill(db, skill.id).scanReport;
  assert.equal(report.status, "passed");
  assert.equal(verifySkillPackageIntegrity(skill).ok, true);
  assert.match(await readSkillInstructions(skill), /deterministic inputs/);

  fs.writeFileSync(path.join(root, "SKILL.md"), "# Replaced after scan\n");
  assert.equal(verifySkillPackageIntegrity(skill).ok, false);
});
