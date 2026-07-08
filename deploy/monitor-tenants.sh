#!/usr/bin/env bash
# 宕机告警：巡检主实例 + 所有客户实例的 /api/health，状态翻转（正常↔宕机）时推送告警。
# 用状态文件去重，只在"掉线"和"恢复"的瞬间告警，不刷屏。
# 配置：deploy/monitor.env 里填 LARK_WEBHOOK_URL（见 monitor.env.example）。未配则只写日志。
# cron 示例（每 3 分钟）：
#   */3 * * * * /opt/trading-agent/deploy/monitor-tenants.sh >> /var/log/tenant-monitor.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/trading-agent}"
TENANTS_DIR="${TENANTS_DIR:-/opt/tenants}"
STATE_DIR="$APP_DIR/data/.monitor"
mkdir -p "$STATE_DIR"

COMPOSE="$APP_DIR/docker-compose.yml"
SERVICE="${SERVICE:-trading-agent}"
WEBHOOK_CACHE="$STATE_DIR/.webhook"

# 告警地址优先级：monitor.env 显式配置 > 前端「系统设置→外部服务→飞书」配的（从金库解密） > 上次缓存。
# 缓存是为了在 App 宕机时仍能发出告警（此时无法实时从金库读）。
# shellcheck disable=SC1090
[ -f "$APP_DIR/deploy/monitor.env" ] && . "$APP_DIR/deploy/monitor.env"
WEBHOOK="${LARK_WEBHOOK_URL:-}"

if [ -z "$WEBHOOK" ]; then
  DEC="$APP_DIR/data/.mon-webhook.mjs"
  cat > "$DEC" <<'NODE'
import Database from "better-sqlite3"; import crypto from "node:crypto";
const r = new Database((process.env.DATA_DIR||"/app/data")+"/trading-agent.sqlite",{readonly:true})
  .prepare("SELECT value FROM collections WHERE name=?").get("vaultItems");
const item = (r?JSON.parse(r.value):[]).find(v=>v.name==="LARK_WEBHOOK_URL"&&v.encrypted);
if (item) {
  const key = crypto.createHash("sha256").update(process.env.SECRETS_MASTER_KEY||"development-only-master-key").digest();
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(item.encrypted.iv,"base64"));
  d.setAuthTag(Buffer.from(item.encrypted.tag,"base64"));
  process.stdout.write(Buffer.concat([d.update(Buffer.from(item.encrypted.ciphertext,"base64")), d.final()]).toString("utf8"));
}
NODE
  FRESH="$(docker compose -f "$COMPOSE" exec -T "$SERVICE" node /app/data/.mon-webhook.mjs 2>/dev/null || true)"
  rm -f "$DEC"
  if [ -n "$FRESH" ]; then umask 077; printf '%s' "$FRESH" > "$WEBHOOK_CACHE"; fi
  [ -z "$WEBHOOK" ] && [ -f "$WEBHOOK_CACHE" ] && WEBHOOK="$(cat "$WEBHOOK_CACHE")"
fi

send_alert() { # $1=title  $2=text
  if [ -z "$WEBHOOK" ]; then echo "[无 webhook] $1 | $2"; return; fi
  # 单行文本，避免 JSON 换行转义问题；引号做最小转义。
  local text; text="$(printf '%s · %s' "$1" "$2" | sed 's/"/\\"/g')"
  curl -s -m 8 -X POST "$WEBHOOK" -H "Content-Type: application/json" \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$text\"}}" >/dev/null 2>&1 || true
}

check() { # $1=name  $2=url
  local name="$1" url="$2" statefile="$STATE_DIR/$1.state" prev="up" now="down" code
  [ -f "$statefile" ] && prev="$(cat "$statefile")"
  code=$(curl -s -o /dev/null -m 8 -w "%{http_code}" "$url" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && now="up"
  if [ "$now" != "$prev" ]; then
    if [ "$now" = "down" ]; then send_alert "🔴 实例宕机" "$name 无响应（HTTP $code） · $(date '+%F %T')";
    else send_alert "🟢 实例恢复" "$name 已恢复 · $(date '+%F %T')"; fi
    echo "$now" > "$statefile"
  fi
  echo "$(date '+%F %T') $name: $now (HTTP $code)"
}

check "main" "http://127.0.0.1:8787/api/health"
if [ -d "$TENANTS_DIR" ]; then
  for d in "$TENANTS_DIR"/*/; do
    [ -d "$d" ] || continue
    slug="$(basename "$d")"
    port="$(grep -oE '127.0.0.1:[0-9]+:8787' "$d/docker-compose.yml" 2>/dev/null | grep -oE ':[0-9]+:' | tr -d ':' | head -1)"
    [ -n "$port" ] && check "$slug" "http://127.0.0.1:$port/api/health"
  done
fi
