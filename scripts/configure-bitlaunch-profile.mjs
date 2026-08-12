import { appendAudit, loadDb, saveDb } from "../server/store.mjs";

const mode = process.argv[2] || "apply";
const db = loadDb();
db.meta ||= {};
db.runtimeConfig ||= {};
db.system ||= {};
const keys = [
  "PRODUCTION_SECURITY_PROFILE",
  "MANDATE_POLICY_MAX_SINGLE_RISK_PCT",
  "MANDATE_POLICY_MAX_DAILY_LOSS_PCT"
];

if (mode === "apply") {
  if (!db.meta.bitlaunchProfileMigrationBackup) {
    db.meta.bitlaunchProfileMigrationBackup = {
      professionalRiskMode: db.system.professionalRiskMode,
      runtimeConfig: Object.fromEntries(keys.map((key) => [key, {
        present: Object.prototype.hasOwnProperty.call(db.runtimeConfig, key),
        value: db.runtimeConfig[key]
      }])),
      createdAt: new Date().toISOString()
    };
  }
  db.runtimeConfig.PRODUCTION_SECURITY_PROFILE = "bitlaunch_single_server";
  db.runtimeConfig.MANDATE_POLICY_MAX_SINGLE_RISK_PCT = "10";
  db.runtimeConfig.MANDATE_POLICY_MAX_DAILY_LOSS_PCT = "20";
  db.system.professionalRiskMode = true;
  appendAudit(db, "部署配置切换：BitLaunch 单服务器生产模式，保留 Mandate 10%/20% 策略上限", "production_security_profile", "Deployment", "critical");
  saveDb(db);
  console.log(JSON.stringify({ ok: true, mode, securityProfile: db.runtimeConfig.PRODUCTION_SECURITY_PROFILE, professionalRiskMode: true, mandatePolicyLimits: { single: 10, daily: 20 } }));
} else if (mode === "rollback") {
  const backup = db.meta.bitlaunchProfileMigrationBackup;
  if (!backup) {
    console.log(JSON.stringify({ ok: true, mode, changed: false }));
  } else {
    for (const key of keys) {
      const previous = backup.runtimeConfig?.[key];
      if (previous?.present) db.runtimeConfig[key] = previous.value;
      else delete db.runtimeConfig[key];
    }
    db.system.professionalRiskMode = backup.professionalRiskMode === true;
    delete db.meta.bitlaunchProfileMigrationBackup;
    appendAudit(db, "BitLaunch 单服务器生产配置回滚", "production_security_profile", "Deployment", "warning");
    saveDb(db);
    console.log(JSON.stringify({ ok: true, mode, changed: true }));
  }
} else if (mode === "commit") {
  const changed = Boolean(db.meta.bitlaunchProfileMigrationBackup);
  delete db.meta.bitlaunchProfileMigrationBackup;
  if (changed) {
    appendAudit(db, "BitLaunch 单服务器生产配置已通过部署验证", "production_security_profile", "Deployment", "warning");
    saveDb(db);
  }
  console.log(JSON.stringify({ ok: true, mode, changed }));
} else {
  throw new Error("mode must be apply, rollback, or commit");
}
