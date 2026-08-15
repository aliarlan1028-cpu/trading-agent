#!/usr/bin/env bash
# 把主实例加密金库里已配置的 LLM key 同步到 deploy/vendor.env，
# 供 provision-tenant.sh 自动注入每个新客户实例（客户仍可在密钥库覆盖成自己的）。
# 全程在服务器内部完成：明文只写入 vendor.env（chmod 600），绝不打印到终端/日志。
# 用法（在服务器上）：  ./sync-vendor-llm.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/trading-agent}"
DEPLOY_DIR="$APP_DIR/deploy"
DATA_DIR="$APP_DIR/data"
COMPOSE="$APP_DIR/docker-compose.yml"
SERVICE="${SERVICE:-trading-agent}"
NODE_SCRIPT="$DATA_DIR/.sync-vendor-llm.mjs"
TMP_ON_HOST="$DATA_DIR/.vendor-llm.env.tmp"

cat > "$NODE_SCRIPT" <<'NODE'
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
const dir = process.env.DATA_DIR || "/app/data";
const db = new Database(dir + "/trading-agent.sqlite", { readonly: true });
const get = (n) => { const r = db.prepare("SELECT value FROM collections WHERE name=?").get(n); return r ? JSON.parse(r.value) : null; };
const vault = get("vaultItems") || [];
const rc = get("runtimeConfig") || {};
const masterKey = crypto.createHash("sha256").update(process.env.SECRETS_MASTER_KEY || "development-only-master-key").digest();
function decrypt(enc) {
  const iv = Buffer.from(enc.iv, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
  d.setAuthTag(Buffer.from(enc.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc.ciphertext, "base64")), d.final()]).toString("utf8");
}
const KEYS = ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"];
const MODEL = { OPENROUTER_API_KEY: "GEMINI_MODEL", DEEPSEEK_API_KEY: "DEEPSEEK_MODEL" };
let out = "# 由 sync-vendor-llm.sh 从主实例金库自动同步 —— 含密钥，勿提交\n";
const synced = [];
for (const k of KEYS) {
  const item = vault.find((v) => v.name === k && v.encrypted);
  if (!item) continue;
  try {
    const val = decrypt(item.encrypted);
    if (!val) continue;
    out += `${k}=${val}\n`;
    const mk = MODEL[k];
    if (rc[mk]) out += `${mk}=${rc[mk]}\n`;
    synced.push(k);
  } catch { /* 解密失败跳过 */ }
}
out += `OPENROUTER_ZDR=${rc.OPENROUTER_ZDR || "true"}\n`;
out += `OPENROUTER_DATA_COLLECTION=${rc.OPENROUTER_DATA_COLLECTION || "deny"}\n`;
out += `OPENROUTER_ALLOW_PROVIDER_FALLBACKS=${rc.OPENROUTER_ALLOW_PROVIDER_FALLBACKS || "true"}\n`;
out += `LLM_CRITIC_REQUIRED_FOR_LIVE=${rc.LLM_CRITIC_REQUIRED_FOR_LIVE || "true"}\n`;
fs.writeFileSync(dir + "/.vendor-llm.env.tmp", out, { mode: 0o600 });
console.log("SYNCED " + synced.length + ": " + (synced.join(", ") || "（金库无 LLM key）"));
NODE

OUTPUT="$(docker compose -f "$COMPOSE" exec -T "$SERVICE" node /app/data/.sync-vendor-llm.mjs)"
rm -f "$NODE_SCRIPT"

if [ ! -f "$TMP_ON_HOST" ]; then
  echo "同步失败：未生成临时文件。$OUTPUT" >&2
  exit 1
fi
mkdir -p "$DEPLOY_DIR"
mv "$TMP_ON_HOST" "$DEPLOY_DIR/vendor.env"
chmod 600 "$DEPLOY_DIR/vendor.env"

echo "✅ 已写入 $DEPLOY_DIR/vendor.env（$OUTPUT）"
echo "   仅显示 key 名称与数量；明文只落在 vendor.env，未打印。"
echo "   之后 ./provision-tenant.sh 开的每个新实例都会自动带上这些 key。"
