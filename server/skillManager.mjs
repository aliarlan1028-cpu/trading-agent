import crypto from "node:crypto";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const HIGH_RISK_PERMISSIONS = new Set(["trade.write", "trade.execute", "secret.read", "fs.write", "shell.exec", "network.raw"]);

export function scanSkill(db, skillId) {
  const skill = db.skills.find((item) => item.id === skillId);
  if (!skill) return null;
  const permissions = skill.permissions || [];
  const highRisk = permissions.filter((permission) => HIGH_RISK_PERMISSIONS.has(permission));
  const checksum = crypto.createHash("sha256").update(`${skill.name}:${skill.source}:${skill.version}:${permissions.join(",")}`).digest("hex");
  skill.scanReport = {
    id: id("scan"),
    status: highRisk.length ? "needs_review" : "passed",
    checksum,
    highRiskPermissions: highRisk,
    dependencyRisk: "not_executed_in_mvp",
    sandboxSmokeTest: highRisk.length ? "blocked_until_approval" : "passed",
    scannedAt: nowIso()
  };
  skill.scan = highRisk.length ? "需复核" : "通过";
  skill.status = highRisk.length ? "待安全复核" : "待批准";
  appendAudit(db, "扫描 Skill", skill.id, "Skill Manager", highRisk.length ? "warning" : "info");
  appendTrace(db, "skill_scan", `扫描 ${skill.name}`, highRisk.length ? "warning" : "ok");
  return skill;
}

export function installSkill(db, skillId, approvedBy = "System") {
  const skill = db.skills.find((item) => item.id === skillId);
  if (!skill) return null;
  if (!skill.scanReport || !["passed", "needs_review"].includes(skill.scanReport.status)) {
    const error = new Error("Skill must be scanned before install");
    error.status = 409;
    throw error;
  }
  if (skill.scanReport.highRiskPermissions?.includes("trade.write") || skill.scanReport.highRiskPermissions?.includes("trade.execute")) {
    const error = new Error("Skill requests direct trade permission and cannot be installed");
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
