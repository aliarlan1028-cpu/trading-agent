import assert from "node:assert/strict";
import test from "node:test";

process.env.SECRETS_MASTER_KEY = "test-runtime-secret-precedence-key-123456789";
const { applyStoredConfigToEnv, clearSecret, setConfig } = await import("../server/runtimeConfig.mjs");

test("前端写入金库的 ADMIN_PASSWORD 在重启恢复时优先于旧部署 env", () => {
  const previous = process.env.ADMIN_PASSWORD;
  const db = { system: {}, runtimeConfig: {}, vaultItems: [], auditLogs: [] };
  try {
    process.env.ADMIN_PASSWORD = "old-deployment-password";
    setConfig(db, { ADMIN_PASSWORD: "new-frontend-password" });
    assert.equal(process.env.ADMIN_PASSWORD, "new-frontend-password");
    process.env.ADMIN_PASSWORD = "old-deployment-password"; // 模拟重启后 dotenv 再次注入旧值
    applyStoredConfigToEnv(db);
    assert.equal(process.env.ADMIN_PASSWORD, "new-frontend-password");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});

test("前端移除密钥后重启不会被旧部署 env 复活", () => {
  const db = { system: {}, vaultItems: [], runtimeConfig: {}, auditLogs: [] };
  process.env.TELEGRAM_BOT_TOKEN = "legacy-bootstrap-token";
  clearSecret(db, "TELEGRAM_BOT_TOKEN");
  process.env.TELEGRAM_BOT_TOKEN = "legacy-bootstrap-token";
  applyStoredConfigToEnv(db);
  assert.equal(process.env.TELEGRAM_BOT_TOKEN, undefined);
});
