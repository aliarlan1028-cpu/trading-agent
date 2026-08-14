#!/usr/bin/env bash
# 宕机监控：巡检主实例 + 所有客户实例的 /api/health。
#  - 状态翻转（正常↔宕机）时推送告警（飞书 webhook / Telegram bot，配任一即可，都配都发）
#  - 主实例连续 FAIL_THRESHOLD 次失败 → 自动 docker compose restart（带冷却期防抖），并告警
# 告警通道来源优先级：deploy/monitor.env 显式配置 > 前端「系统设置」配的（从金库解密） > 上次缓存。
# 缓存是为了在 App 宕机时仍能发出告警（此时无法实时从金库读）。
# cron（每 1 分钟）：
#   * * * * * /opt/trading-agent/deploy/monitor-tenants.sh >> /var/log/tenant-monitor.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/trading-agent}"
TENANTS_DIR="${TENANTS_DIR:-/opt/tenants}"
STATE_DIR="${STATE_DIR:-$APP_DIR/data/.monitor}"   # 演练时可指向 /tmp 隔离状态
MAIN_URL="${MAIN_URL:-http://127.0.0.1:8787/api/health}"  # 演练时可指向坏地址验证自愈链路
mkdir -p "$STATE_DIR"

# 部署静默:deploy.sh 在容器重建期间写 .deploying 标记,这段短暂宕机不该告警(否则每次部署都刷「宕机/恢复」)。
# 标记超 8 分钟(480s)视为失效,防部署卡死/ssh 掉线导致永久静默——真宕机仍会被后续巡检发现。
DEPLOY_MARK="$STATE_DIR/.deploying"
if [ -f "$DEPLOY_MARK" ]; then
  mark_ts="$(stat -c %Y "$DEPLOY_MARK" 2>/dev/null || echo 0)"
  if [ "$(( $(date +%s) - mark_ts ))" -lt 480 ]; then
    echo "$(date '+%F %T') 部署静默中,跳过本轮巡检"
    exit 0
  fi
fi

COMPOSE="$APP_DIR/docker-compose.yml"
SERVICE="${SERVICE:-trading-agent}"
CHANNEL_CACHE="$STATE_DIR/.channels"     # 缓存的告警通道（宕机时金库读不到，用上次的）
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"    # 主实例连续失败 N 次才重启（每分钟一次 → 约 N 分钟）
RESTART_COOLDOWN="${RESTART_COOLDOWN:-600}"  # 两次自动重启至少间隔秒数（防抖）
DOWN_THRESHOLD="${DOWN_THRESHOLD:-2}"    # 连续 N 次健康检查失败才判「宕机」并告警（防抖：
                                          # 部署 docker compose up -d 重建容器有十几秒空档，单次失败即告警会刷屏「宕机/恢复」）

# ---------- 告警通道 ----------
# shellcheck disable=SC1090
[ -f "$APP_DIR/deploy/monitor.env" ] && . "$APP_DIR/deploy/monitor.env"
LARK="${LARK_WEBHOOK_URL:-}"
TG_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TG_CHAT="${TELEGRAM_CHAT_ID:-}"

if [ -z "$LARK" ] || [ -z "$TG_TOKEN" ]; then
  DEC="$APP_DIR/data/.mon-channels.mjs"
  cat > "$DEC" <<'NODE'
import Database from "better-sqlite3"; import crypto from "node:crypto";
const db = new Database((process.env.DATA_DIR||"/app/data")+"/trading-agent.sqlite",{readonly:true});
const get = (n) => { const r = db.prepare("SELECT value FROM collections WHERE name=?").get(n); return r ? JSON.parse(r.value) : null; };
const vault = get("vaultItems") || [];
const rc = get("runtimeConfig") || {};
const key = crypto.createHash("sha256").update(process.env.SECRETS_MASTER_KEY||"development-only-master-key").digest();
const dec = (name) => {
  const item = vault.find(v=>v.name===name&&v.encrypted); if (!item) return "";
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(item.encrypted.iv,"base64"));
    d.setAuthTag(Buffer.from(item.encrypted.tag,"base64"));
    return Buffer.concat([d.update(Buffer.from(item.encrypted.ciphertext,"base64")), d.final()]).toString("utf8");
  } catch { return ""; }
};
const esc = (s) => String(s||"").replace(/'/g,"");
console.log(`LARK='${esc(dec("LARK_WEBHOOK_URL"))}'`);
console.log(`TG_TOKEN='${esc(dec("TELEGRAM_BOT_TOKEN"))}'`);
console.log(`TG_CHAT='${esc(rc.TELEGRAM_CHAT_ID||"")}'`);
NODE
  FRESH="$(timeout 12 docker compose -f "$COMPOSE" exec -T "$SERVICE" node /app/data/.mon-channels.mjs 2>/dev/null || true)"
  rm -f "$DEC"
  if [ -n "$FRESH" ]; then umask 077; printf '%s\n' "$FRESH" > "$CHANNEL_CACHE"; fi
  if [ -f "$CHANNEL_CACHE" ]; then
    # shellcheck disable=SC1090
    VLARK=""; VTG_TOKEN=""; VTG_CHAT=""
    eval "$(sed 's/^LARK=/VLARK=/; s/^TG_TOKEN=/VTG_TOKEN=/; s/^TG_CHAT=/VTG_CHAT=/' "$CHANNEL_CACHE")"
    [ -z "$LARK" ] && LARK="$VLARK"
    [ -z "$TG_TOKEN" ] && TG_TOKEN="$VTG_TOKEN"
    [ -z "$TG_CHAT" ] && TG_CHAT="$VTG_CHAT"
  fi
fi

ALERT_SENT=0
send_alert() { # $1=title  $2=text
  local sent=0
  local text; text="$(printf '%s · %s' "$1" "$2" | sed 's/"/\\"/g')"
  if [ -n "$LARK" ]; then
    curl -fsS -m 8 -X POST "$LARK" -H "Content-Type: application/json" \
      -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$text\"}}" >/dev/null 2>&1 && sent=1 || true
  fi
  if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    curl -fsS -m 8 -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
      -d "chat_id=${TG_CHAT}" --data-urlencode "text=${1} · ${2}" >/dev/null 2>&1 && sent=1 || true
  fi
  [ "$sent" = "0" ] && echo "[无可用告警通道] $1 | $2"
  ALERT_SENT="$sent"
}

if [ "${1:-}" = "--test-alert" ]; then
  send_alert "🧪 KORDYN 外部告警测试" "主机监控、前端、磁盘和备份巡检通道已连接 · $(date '+%F %T')"
  [ "$ALERT_SENT" = "1" ] || { echo "external alert delivery failed" >&2; exit 1; }
  exit 0
fi

# ---------- 主实例自愈 ----------
try_restart_main() { # $1=code
  local failfile="$STATE_DIR/main.fails" lastfile="$STATE_DIR/main.lastrestart" fails=0 last=0 now
  now="$(date +%s)"
  [ -f "$failfile" ] && fails="$(cat "$failfile")"
  fails=$((fails + 1)); echo "$fails" > "$failfile"
  [ "$fails" -lt "$FAIL_THRESHOLD" ] && return 0
  [ -f "$lastfile" ] && last="$(cat "$lastfile")"
  if [ $((now - last)) -lt "$RESTART_COOLDOWN" ]; then
    echo "$(date '+%F %T') main: 连续失败 $fails 次，但距上次自动重启不足 ${RESTART_COOLDOWN}s，暂不重启"
    return 0
  fi
  echo "$now" > "$lastfile"; echo 0 > "$failfile"
  echo "$(date '+%F %T') main: 连续失败 $fails 次 → 自动重启容器"
  send_alert "🔁 自动重启" "主实例连续 $fails 次无响应（HTTP $1），已执行 docker compose restart · $(date '+%F %T')"
  ( cd "$APP_DIR" && timeout 90 docker compose restart "$SERVICE" >/dev/null 2>&1 ) || \
    send_alert "🆘 重启失败" "docker compose restart 未成功，需要人工介入 · $(date '+%F %T')"
}

check() { # $1=name  $2=url  $3=auto_heal(main 才传 1)
  local name="$1" url="$2" heal="${3:-0}" statefile="$STATE_DIR/$1.state" failfile="$STATE_DIR/$1.dfails" prev="up" now="up" code dfails=0
  [ -f "$statefile" ] && prev="$(cat "$statefile")"
  [ -f "$failfile" ] && dfails="$(cat "$failfile")"
  code=$(curl -s -o /dev/null -m 8 -w "%{http_code}" "$url" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    dfails=0; now="up"
  else
    dfails=$((dfails + 1))
    # 防抖:连续失败达阈值才判宕机;未达阈值维持上一状态(不因部署重建的短暂空档误报)
    if [ "$dfails" -ge "$DOWN_THRESHOLD" ]; then now="down"; else now="$prev"; fi
  fi
  echo "$dfails" > "$failfile"
  if [ "$now" != "$prev" ]; then
    if [ "$now" = "down" ]; then send_alert "🔴 实例宕机" "$name 无响应（HTTP $code） · $(date '+%F %T')";
    else send_alert "🟢 实例恢复" "$name 已恢复 · $(date '+%F %T')"; fi
    echo "$now" > "$statefile"
  fi
  if [ "$heal" = "1" ]; then
    if [ "$now" = "down" ]; then try_restart_main "$code"; else echo 0 > "$STATE_DIR/main.fails"; fi
  fi
  echo "$(date '+%F %T') $name: $now (HTTP $code)"
}

check "main" "$MAIN_URL" 1

# 前端资产探测：API 健康不代表页面能开（曾发生 CORS 把自家 JS 403 掉的全站白屏，/api/health 全程 200）。
# 模拟浏览器带 Origin 头请求首页引用的第一个 JS 资产，非 200 即告警（状态翻转去重）。
check_frontend() {
  # 走真实公网地址（用户实际路径，含 Caddy），Origin 与站点同源——模拟浏览器加载 ES module。
  local base="${FRONTEND_URL:-https://yegidawir.xyz}" statefile="$STATE_DIR/frontend.state" prev="up" now="down"
  [ -f "$statefile" ] && prev="$(cat "$statefile")"
  local asset
  asset="$(curl -s -m 8 "$base/" 2>/dev/null | grep -oE 'assets/[A-Za-z0-9._-]+\.js' | head -1)"
  if [ -n "$asset" ]; then
    local code
    code=$(curl -s -o /dev/null -m 8 -w "%{http_code}" -H "Origin: $base" "$base/$asset" 2>/dev/null || echo 000)
    [ "$code" = "200" ] && now="up"
  fi
  if [ "$now" != "$prev" ]; then
    if [ "$now" = "down" ]; then send_alert "🟠 前端异常" "页面资产加载失败（API 可能仍正常），请检查 CORS/构建 · $(date '+%F %T')";
    else send_alert "🟢 前端恢复" "页面资产恢复加载 · $(date '+%F %T')"; fi
    echo "$now" > "$statefile"
  fi
  echo "$(date '+%F %T') frontend: $now"
}
check_frontend

check_backup_health() {
  local statefile="$STATE_DIR/backup.state" prev="up" now="down"
  [ -f "$statefile" ] && prev="$(cat "$statefile")"
  local status_file="$APP_DIR/backups/backup-status.json" max_age="${BACKUP_MAX_AGE_SECONDS:-129600}" age=999999999
  if [ -f "$status_file" ]; then age=$(( $(date +%s) - $(stat -c %Y "$status_file" 2>/dev/null || echo 0) )); fi
  [ "$age" -le "$max_age" ] && now="up"
  if [ "$now" != "$prev" ]; then
    if [ "$now" = "down" ]; then send_alert "🟠 备份异常" "最近一次已验证备份超过 $((max_age / 3600)) 小时或状态文件缺失 · $(date '+%F %T')";
    else send_alert "🟢 备份恢复" "已验证备份恢复正常 · $(date '+%F %T')"; fi
    echo "$now" > "$statefile"
  fi
  echo "$(date '+%F %T') backup: $now (age=${age}s)"
}

check_disk_health() {
  local statefile="$STATE_DIR/disk.state" prev="up" now="up" threshold="${DISK_ALERT_THRESHOLD_PCT:-85}" used
  [ -f "$statefile" ] && prev="$(cat "$statefile")"
  used="$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if ! [[ "$used" =~ ^[0-9]+$ ]] || [ "$used" -ge "$threshold" ]; then now="down"; fi
  if [ "$now" != "$prev" ]; then
    if [ "$now" = "down" ]; then send_alert "🟠 磁盘空间告警" "根分区已使用 ${used:-未知}%（阈值 ${threshold}%） · $(date '+%F %T')";
    else send_alert "🟢 磁盘空间恢复" "根分区已降至 ${used}% · $(date '+%F %T')"; fi
    echo "$now" > "$statefile"
  fi
  echo "$(date '+%F %T') disk: $now (${used:-?}%)"
}

check_backup_health
check_disk_health
if [ -d "$TENANTS_DIR" ]; then
  for d in "$TENANTS_DIR"/*/; do
    [ -d "$d" ] || continue
    slug="$(basename "$d")"
    port="$(grep -oE '127.0.0.1:[0-9]+:8787' "$d/docker-compose.yml" 2>/dev/null | grep -oE ':[0-9]+:' | tr -d ':' | head -1)"
    [ -n "$port" ] && check "$slug" "http://127.0.0.1:$port/api/health"
  done
fi
