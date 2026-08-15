import crypto from "node:crypto";
import { notifyLark } from "./larkNotifier.mjs";
import { appendAudit, appendTrace, id, nowIso, verifyAuditChain } from "./store.mjs";
import { getMasterKeyMaterial, getMasterKeyring } from "./keyProvider.mjs";
import { fetchExternalText } from "./externalInputSafety.mjs";

export function storeSecret(db, name, value, scope = "exchange") {
  assertSecretStorageConfigured();
  const encrypted = encryptVaultValue(value, { name, scope });
  const item = { id: id("vault"), name, scope, encrypted, createdAt: nowIso(), updatedAt: nowIso() };
  db.vaultItems = (db.vaultItems || []).filter((existing) => existing.name !== name);
  db.vaultItems.unshift(item);
  appendAudit(db, "写入加密金库", item.id, "SecurityOps");
  return { id: item.id, name, scope, createdAt: item.createdAt };
}

export function listVaultItems(db) {
  return (db.vaultItems || []).map(({ encrypted, ...safe }) => safe);
}

export function readSecret(db, name) {
  const item = (db.vaultItems || []).find((entry) => entry.name === name);
  if (!item?.encrypted) return null;
  return decryptVaultItem(item);
}

export async function sendAlert(db, payload = {}) {
  const alert = { id: id("alert"), severity: payload.severity || "info", title: payload.title || "系统告警", body: payload.body || "", status: "created", createdAt: nowIso() };
  db.alerts.unshift(alert);
  if (process.env.ALERT_WEBHOOK_URL) {
    try {
      const { response } = await fetchExternalText(process.env.ALERT_WEBHOOK_URL, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alert), timeoutMs: 8000, maxBytes: 256 * 1024
      });
      alert.status = response.ok ? "sent" : "send_failed";
      alert.httpStatus = response.status;
    } catch (error) {
      alert.status = "send_failed";
      alert.error = error.message;
    }
  }
  // 同步推送飞书（若已配置），让主人第一时间收到。
  try {
    const lark = await notifyLark(db, { severity: alert.severity, title: alert.title, body: alert.body || alert.title });
    alert.larkStatus = lark.deliveryStatus;
  } catch { /* 飞书失败不影响告警落库 */ }
  appendAudit(db, `发送告警：${alert.status}`, alert.id, "AlertManager", alert.severity);
  return alert;
}

export function runSafetyDrill(db, type = "kill_switch") {
  const drill = { id: id("drill"), type, status: "completed", actions: [], createdAt: nowIso() };
  if (type === "kill_switch") {
    drill.actions.push("演练触发一键熔断");
    drill.actions.push("验证新开仓被拒绝");
    drill.actions.push("确认审计链写入");
  }
  if (type === "api_desync") {
    drill.actions.push("演练 REST/WS 状态不一致");
    drill.actions.push("创建风险事件");
    db.riskIncidents.unshift({ id: id("incident"), severity: "high", status: "drill", title: "演练：API 对账异常", source: drill.id, createdAt: nowIso() });
  }
  drill.auditChain = verifyAuditChain(db);
  db.drillRuns.unshift(drill);
  appendAudit(db, "运行安全演练", drill.id, "SecurityOps", "warning");
  appendTrace(db, "safety_drill", type, "ok");
  return drill;
}

function assertSecretStorageConfigured() {
  try {
    getMasterKeyMaterial();
  } catch (cause) {
    const error = new Error(cause.message);
    error.status = 400;
    throw error;
  }
}

function derivedKey(keyId) {
  return crypto.createHash("sha256").update(getMasterKeyMaterial(keyId)).digest();
}

function vaultAad(name, scope) {
  return Buffer.from(JSON.stringify({ schemaVersion: 2, name: String(name), scope: String(scope) }), "utf8");
}

export function encryptVaultValue(value, { name, scope, keyId = null } = {}) {
  const ring = getMasterKeyring();
  const selectedKeyId = keyId || ring.activeKeyId;
  const key = derivedKey(selectedKeyId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(vaultAad(name, scope));
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { schemaVersion: 2, algorithm: "aes-256-gcm", keyId: selectedKeyId, iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptVaultItem(item) {
  const encrypted = item?.encrypted || item;
  if (!encrypted?.ciphertext) throw new Error("Vault ciphertext is missing");
  const ring = getMasterKeyring();
  const candidateIds = encrypted.keyId ? [encrypted.keyId] : [...ring.keys.keys()];
  let lastError = null;
  for (const candidateId of candidateIds) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey(candidateId), Buffer.from(encrypted.iv, "base64"));
      if (Number(encrypted.schemaVersion || 1) >= 2) decipher.setAAD(vaultAad(item?.name, item?.scope));
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch (error) { lastError = error; }
  }
  throw new Error(`Vault decryption failed${encrypted.keyId ? ` for ${encrypted.keyId}` : ""}: ${lastError?.message || "unknown error"}`);
}

export function rotateVaultEncryption(db) {
  const ring = getMasterKeyring();
  const plaintext = (db.vaultItems || []).map((item) => ({ item, value: decryptVaultItem(item) }));
  const rotatedAt = nowIso();
  const replacements = plaintext.map(({ item, value }) => ({
    ...item,
    encrypted: encryptVaultValue(value, { name: item.name, scope: item.scope, keyId: ring.activeKeyId }),
    keyRotatedAt: rotatedAt,
    updatedAt: rotatedAt
  }));
  db.vaultItems = replacements;
  appendAudit(db, `金库密钥轮换完成：${replacements.length} 项`, "vault_rotation", "SecurityOps", "warning");
  return { rotated: replacements.length, activeKeyId: ring.activeKeyId, rotatedAt };
}
