import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const HIGH_RISK_PERMISSIONS = new Set(["trade.write", "trade.execute", "secret.read", "fs.write", "shell.exec", "network.raw"]);

export function scanSkill(db, skillId) {
  const skill = db.skills.find((item) => item.id === skillId);
  if (!skill) return null;
  const permissions = skill.permissions || [];
  const highRisk = permissions.filter((permission) => HIGH_RISK_PERMISSIONS.has(permission));
  let scanError = null;
  let content = null;
  try {
    content = skill.native ? {
        checksum: crypto.createHash("sha256").update(`builtin:${skill.id}:${skill.version}:${skill.toolName || ""}`).digest("hex"),
        fileCount: 1,
        hasPackageManifest: false,
        trustedBuiltin: true
      }
      : skill.localPath ? hashDirectory(skill.localPath) : null;
    if (content && !skill.native && content.fileCount < 1) throw new Error("Skill package contains no regular files");
    if (content && !skill.native && !content.files.includes(String(skill.entryFile || "SKILL.md").replaceAll("\\", "/"))) {
      throw new Error("Skill entry file was not included in the scanned checksum");
    }
  } catch (error) {
    scanError = String(error.message || error).slice(0, 240);
    content = null;
  }
  const checksum = content?.checksum || null;
  skill.scanReport = {
    id: id("scan"),
    status: !content ? "failed" : highRisk.length ? "needs_review" : "passed",
    checksum,
    contentVerified: Boolean(content),
    fileCount: content?.fileCount || 0,
    trustedBuiltin: content?.trustedBuiltin === true,
    format: skill.format || "codex",
    entryFile: skill.entryFile || "SKILL.md",
    clawhubCompatible: skill.format === "clawhub" || Boolean(skill.clawhub),
    highRiskPermissions: highRisk,
    dependencyRisk: content?.hasPackageManifest ? "manifest_present_requires_dependency_audit" : "no_package_manifest",
    error: scanError,
    sandboxSmokeTest: "not_run",
    scannedAt: nowIso()
  };
  skill.scan = !content ? "失败" : highRisk.length ? "需复核" : "通过";
  skill.status = !content ? "扫描失败" : highRisk.length ? "待安全复核" : "待批准";
  appendAudit(db, "扫描 Skill", skill.id, "Skill Manager", highRisk.length ? "warning" : "info");
  appendTrace(db, "skill_scan", `扫描 ${skill.name}`, highRisk.length ? "warning" : "ok");
  return skill;
}

export function installSkill(db, skillId, approvedBy = "System", options = {}) {
  const skill = db.skills.find((item) => item.id === skillId);
  if (!skill) return null;
  if (!skill.scanReport || !["passed", "needs_review"].includes(skill.scanReport.status)) {
    const error = new Error("Skill must be scanned before install");
    error.status = 409;
    throw error;
  }
  if (!skill.scanReport.contentVerified || !skill.scanReport.checksum) {
    const error = new Error("Skill package content was not verified");
    error.status = 409;
    throw error;
  }
  const integrity = verifySkillPackageIntegrity(skill);
  if (!integrity.ok) {
    const error = new Error(`Skill package changed after scan: ${integrity.reason}`);
    error.status = 409;
    throw error;
  }
  if (skill.scanReport.highRiskPermissions?.includes("trade.write") || skill.scanReport.highRiskPermissions?.includes("trade.execute")) {
    const error = new Error("Skill requests direct trade permission and cannot be installed");
    error.status = 403;
    throw error;
  }
  if (skill.scanReport.highRiskPermissions?.length && options.securityApproved !== true) {
    const error = new Error("High-risk Skill permissions require explicit security approval");
    error.status = 403;
    throw error;
  }
  skill.status = "已启用";
  skill.installedAt = nowIso();
  skill.approvedBy = approvedBy;
  appendAudit(db, "安装并启用 Skill", skill.id, approvedBy);
  appendTrace(db, "skill_install", `启用 ${skill.name}`);
  return skill;
}

export function hashDirectory(root) {
  const rootReal = fs.realpathSync(root);
  const hash = crypto.createHash("sha256");
  let fileCount = 0;
  let hasPackageManifest = false;
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      const lstat = fs.lstatSync(full);
      if (lstat.isSymbolicLink()) throw new Error(`Skill package rejects links: ${path.relative(rootReal, full)}`);
      if (entry.isDirectory()) {
        const real = fs.realpathSync(full);
        if (!real.startsWith(`${rootReal}${path.sep}`)) throw new Error("Skill directory escapes package root");
        walk(full);
        continue;
      }
      if (!entry.isFile() || !lstat.isFile()) throw new Error(`Skill package rejects special files: ${path.relative(rootReal, full)}`);
      const relative = path.relative(rootReal, full).replaceAll("\\", "/");
      if (lstat.nlink > 1) throw new Error(`Skill package rejects hard links: ${relative}`);
      if (lstat.size > 5 * 1024 * 1024) throw new Error(`Skill file too large to scan: ${relative}`);
      hash.update(relative);
      hash.update(fs.readFileSync(full));
      fileCount += 1;
      files.push(relative);
      if (["package.json", "package-lock.json", "npm-shrinkwrap.json"].includes(entry.name)) hasPackageManifest = true;
    }
  }
  walk(rootReal);
  return { checksum: hash.digest("hex"), fileCount, hasPackageManifest, files };
}

export function verifySkillPackageIntegrity(skill) {
  if (skill?.native) return { ok: true, checksum: skill.scanReport?.checksum };
  if (!skill?.localPath || !skill?.scanReport?.checksum) return { ok: false, reason: "missing_scan_basis" };
  try {
    const current = hashDirectory(skill.localPath);
    const entry = String(skill.entryFile || "SKILL.md").replaceAll("\\", "/");
    if (!current.files.includes(entry)) return { ok: false, reason: "entry_not_scanned" };
    if (current.checksum !== skill.scanReport.checksum || current.fileCount !== skill.scanReport.fileCount) {
      return { ok: false, reason: "checksum_mismatch", checksum: current.checksum };
    }
    return { ok: true, checksum: current.checksum, fileCount: current.fileCount };
  } catch (error) {
    return { ok: false, reason: String(error.message || error).slice(0, 200) };
  }
}
