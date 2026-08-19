#!/usr/bin/env bash
# 开通一个"单客户独立实例"（Path A：一客户一部署，物理隔离）。
# 在服务器上运行。每个客户 = 独立容器 + 独立 sqlite 数据卷 + 独立 KMS/Vault 密钥文件
# + 独立 owner 账号 + 独立子域名。容器端口只绑 127.0.0.1，仅 Caddy 可达。
#
# 用法:
#   ./provision-tenant.sh <slug> <owner_email> [port]
# 示例:
#   ./provision-tenant.sh alice alice@example.com
#
# 前置条件:
#   1) 已构建镜像（默认 tag: trading-agent-trading-agent:latest，主实例 build 后即有）。
#   2) DNS: *.yegidawir.xyz A 记录指向本机 IP（否则 Caddy 无法为子域名签发证书）。
set -euo pipefail

SLUG="${1:-}"
OWNER_EMAIL="${2:-}"
PORT="${3:-}"
BASE_DOMAIN="${BASE_DOMAIN:-yegidawir.xyz}"
IMAGE="${IMAGE:-trading-agent-trading-agent:latest}"
TENANTS_DIR="${TENANTS_DIR:-/opt/tenants}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
KMS_SECRET_FILE="${KMS_SECRET_FILE:-}"
WORM_ENDPOINT="${WORM_AUDIT_ENDPOINT:-}"
EXTERNAL_ALERT_URL="${ALERT_WEBHOOK_URL:-${LARK_WEBHOOK_URL:-}}"
SECURITY_PROFILE="${PRODUCTION_SECURITY_PROFILE:-bitlaunch_single_server}"
MAX_TENANT_INSTANCES="${PUBLIC_MAX_TENANTS:-1}"
MIN_AVAILABLE_MEMORY_MB="${MIN_AVAILABLE_MEMORY_MB:-768}"
MAX_DISK_USAGE_PCT="${MAX_DISK_USAGE_PCT:-80}"
TENANT_MEM_LIMIT="${TENANT_MEM_LIMIT:-512m}"
TENANT_CPUS="${TENANT_CPUS:-0.50}"

if [ -z "$SLUG" ] || [ -z "$OWNER_EMAIL" ]; then
  echo "用法: $0 <slug> <owner_email> [port]" >&2
  exit 1
fi
if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]]; then
  echo "slug 只能是小写字母/数字/连字符，2-31 位: $SLUG" >&2
  exit 1
fi
DIR="$TENANTS_DIR/$SLUG"
if [ -d "$DIR" ]; then
  echo "租户 $SLUG 已存在: $DIR" >&2
  exit 1
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "镜像不存在: $IMAGE（先在 /opt/trading-agent 里 docker compose build，或用 IMAGE= 覆盖）" >&2
  exit 1
fi

# 同机开通前先做真实宿主机容量闸，避免新客户把 Owner 实例挤到 OOM 或磁盘只读。
tenant_count="$(find "$TENANTS_DIR" -mindepth 2 -maxdepth 2 -name docker-compose.yml -type f 2>/dev/null | wc -l | tr -d ' ')"
available_memory_mb="$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo)"
disk_usage_pct="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if ! [[ "$MAX_TENANT_INSTANCES" =~ ^[0-9]+$ ]] || [ "$tenant_count" -ge "$MAX_TENANT_INSTANCES" ]; then
  echo "客户实例容量已满: $tenant_count/$MAX_TENANT_INSTANCES（调整当前 BitLaunch 配置并完成压测后再提高上限）" >&2
  exit 1
fi
if [ "$available_memory_mb" -lt "$MIN_AVAILABLE_MEMORY_MB" ]; then
  echo "可用内存不足: ${available_memory_mb}MB < ${MIN_AVAILABLE_MEMORY_MB}MB，拒绝开通以保护现有交易实例" >&2
  exit 1
fi
if [ "$disk_usage_pct" -ge "$MAX_DISK_USAGE_PCT" ]; then
  echo "磁盘使用率过高: ${disk_usage_pct}% >= ${MAX_DISK_USAGE_PCT}%，请先执行安全缓存清理" >&2
  exit 1
fi

if [ "$SECURITY_PROFILE" = "external_hardened" ]; then
  if [ ! -f "$KMS_SECRET_FILE" ] || [ "$(tr -d '\r\n' < "$KMS_SECRET_FILE" | wc -c)" -lt 32 ]; then
    echo "external_hardened 模式要求 KMS_SECRET_FILE 指向租户独立密钥文件（至少 32 字符）" >&2
    exit 1
  fi
  if [ -z "$WORM_ENDPOINT" ] || [ -z "$EXTERNAL_ALERT_URL" ]; then
    echo "external_hardened 模式要求 WORM 审计和外部告警" >&2
    exit 1
  fi
else
  [ -n "$WORM_ENDPOINT" ] || echo "警告: BitLaunch 单服务器模式未配置外部 WORM，保留本地哈希审计链"
  [ -n "$EXTERNAL_ALERT_URL" ] || echo "警告: 未配置客户实例外部告警；开通后应在 Lark 设置中补齐"
fi

# 自动挑一个未占用端口（从 8801 起）。
if [ -z "$PORT" ]; then
  PORT=8801
  while ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q ":$PORT" || grep -rqs ":$PORT:8787" "$TENANTS_DIR" 2>/dev/null; do
    PORT=$((PORT + 1))
  done
fi

mkdir -p "$DIR/data" "$DIR/backups" "$DIR/offsite-backups" "$DIR/secrets"
chown -R 1000:1000 "$DIR/data" "$DIR/backups" "$DIR/offsite-backups"
if [ -z "$KMS_SECRET_FILE" ]; then
  KMS_SECRET_FILE="$DIR/secrets/master_key"
  openssl rand -hex 32 > "$KMS_SECRET_FILE"
  chown 1000:1000 "$KMS_SECRET_FILE"
  chmod 400 "$KMS_SECRET_FILE"
fi
if [ ! -f "$KMS_SECRET_FILE" ] || [ "$(tr -d '\r\n' < "$KMS_SECRET_FILE" | wc -c)" -lt 32 ]; then
  echo "租户主密钥文件不可读或不足 32 字符: $KMS_SECRET_FILE" >&2
  exit 1
fi
ADMIN_PW="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
BACKUP_KEY_FILE="$DIR/secrets/backup_key"
openssl rand -hex 32 > "$BACKUP_KEY_FILE"
chown 1000:1000 "$BACKUP_KEY_FILE"
chmod 400 "$BACKUP_KEY_FILE"

# 统一提供的 LLM key：从 vendor.env 注入（客户进实例后仍可在密钥库改成自己的）。
VENDOR_ENV="${VENDOR_ENV:-$(cd "$(dirname "$0")" && pwd)/vendor.env}"
LLM_LINES=""
LLM_STATUS="未注入（该实例 AI 只做数据巡检，直到客户自配 key）"
if [ -f "$VENDOR_ENV" ]; then
  LLM_LINES="$(grep -E '^(OPENROUTER_API_KEY|GEMINI_MODEL|GEMINI_CLASSIFIER_MODEL|DEEPSEEK_API_KEY|DEEPSEEK_MODEL|OPENROUTER_ZDR|OPENROUTER_DATA_COLLECTION|OPENROUTER_ALLOW_PROVIDER_FALLBACKS|LLM_CRITIC_REQUIRED_FOR_LIVE)=' "$VENDOR_ENV" 2>/dev/null || true)"
  [ -n "$LLM_LINES" ] && LLM_STATUS="已注入统一 LLM key（客户可在密钥库覆盖）"
fi

umask 077
cat > "$DIR/.env" <<EOF
# 客户实例: $SLUG  ($OWNER_EMAIL)  —— 由 provision-tenant.sh 生成，请勿提交到仓库
PORT=8787
HOST=0.0.0.0
DATA_DIR=/app/data
AUTH_REQUIRED=true
PUBLIC_REGISTRATION_ENABLED=false
PUBLIC_REGISTRATION_MODE=closed
TENANT_ISOLATION_V2=false
OWNER_EMAIL=$OWNER_EMAIL
ADMIN_PASSWORD=$ADMIN_PW
SECRETS_MASTER_KEY_FILE=/run/secrets/trading-agent/master_key
REQUIRE_EXTERNAL_KEY_PROVIDER=$([ "$SECURITY_PROFILE" = "external_hardened" ] && echo true || echo false)
PRODUCTION_SECURITY_PROFILE=$SECURITY_PROFILE
WORM_AUDIT_ENDPOINT=$WORM_ENDPOINT
WORM_AUDIT_TOKEN=${WORM_AUDIT_TOKEN:-}
ALERT_WEBHOOK_URL=$EXTERNAL_ALERT_URL
PUBLIC_BASE_URL=https://$SLUG.$BASE_DOMAIN
LIVE_TRADING_ENABLED=false
I_UNDERSTAND_REAL_TRADING=false
REAL_ORDER_WRITE_ENABLED=false
MAX_LIVE_NOTIONAL_USDT=50
REQUIRE_MFA_FOR_LIVE=true
BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/trading-agent/backup_key
BACKUP_OFFSITE_DIR=/app/offsite-backups
RESTORE_DRILL_REQUIRE_ENCRYPTED=true
EOF
# 追加统一 LLM key（若 vendor.env 提供）。
if [ -n "$LLM_LINES" ]; then
  printf '%s\n' "$LLM_LINES" >> "$DIR/.env"
fi
chmod 600 "$DIR/.env"

cat > "$DIR/docker-compose.yml" <<EOF
services:
  app:
    image: $IMAGE
    user: "1000:1000"
    env_file: [.env]
    ports:
      - "127.0.0.1:$PORT:8787"
    volumes:
      - ./data:/app/data
      - ./backups:/app/backups
      - ./offsite-backups:/app/offsite-backups
      - "$KMS_SECRET_FILE:/run/secrets/trading-agent/master_key:ro"
      - "$BACKUP_KEY_FILE:/run/secrets/trading-agent/backup_key:ro"
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    init: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 256
    stop_grace_period: 30s
    mem_limit: $TENANT_MEM_LIMIT
    cpus: $TENANT_CPUS
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
    healthcheck:
      test: ["CMD", "node", "scripts/healthcheck.mjs"]
      interval: 30s
      timeout: 10s
      retries: 3
EOF

if ! docker compose -p "tenant-$SLUG" -f "$DIR/docker-compose.yml" run --rm --no-deps app sh -c 'test -r /run/secrets/trading-agent/master_key && [ "$(tr -d "\r\n" < /run/secrets/trading-agent/master_key | wc -c)" -ge 32 ]'; then
  echo "容器内 UID 1000 无法读取 KMS/Vault 密钥；请让 sidecar 以 UID/GID 1000 可读方式挂载" >&2
  exit 1
fi

docker compose -p "tenant-$SLUG" -f "$DIR/docker-compose.yml" up -d

# 注入 Caddy 子域名路由（幂等）。
if ! grep -q "^$SLUG.$BASE_DOMAIN {" "$CADDYFILE"; then
  cat >> "$CADDYFILE" <<EOF

$SLUG.$BASE_DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
fi
systemctl reload caddy

echo "==============================================================="
echo " 已开通客户实例"
echo "   URL          : https://$SLUG.$BASE_DOMAIN"
echo "   Owner 邮箱   : $OWNER_EMAIL"
echo "   初始密码     : $ADMIN_PW   （只显示这一次，安全交付给客户后让 TA 登录）"
echo "   容器端口     : 127.0.0.1:$PORT （不对外，仅 Caddy 可达）"
echo "   数据目录     : $DIR/data"
echo "   LLM key      : $LLM_STATUS"
echo "==============================================================="
echo " 提醒: 让客户在 [系统设置→密钥库] 填自己的 OKX API Key"
echo "       （权限只勾'交易'，务必不要勾'提币'），并自行开启实盘闸门。"
