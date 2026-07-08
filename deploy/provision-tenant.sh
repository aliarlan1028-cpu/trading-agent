#!/usr/bin/env bash
# 开通一个"单客户独立实例"（Path A：一客户一部署，物理隔离）。
# 在服务器上运行。每个客户 = 独立容器 + 独立 sqlite 数据卷 + 独立 SECRETS_MASTER_KEY
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

# 自动挑一个未占用端口（从 8801 起）。
if [ -z "$PORT" ]; then
  PORT=8801
  while ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q ":$PORT" || grep -rqs ":$PORT:8787" "$TENANTS_DIR" 2>/dev/null; do
    PORT=$((PORT + 1))
  done
fi

mkdir -p "$DIR/data" "$DIR/backups"
MASTER_KEY="$(openssl rand -hex 32)"
ADMIN_PW="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"

# 统一提供的 LLM key：从 vendor.env 注入（客户进实例后仍可在密钥库改成自己的）。
VENDOR_ENV="${VENDOR_ENV:-$(cd "$(dirname "$0")" && pwd)/vendor.env}"
LLM_LINES=""
LLM_STATUS="未注入（该实例 AI 只做数据巡检，直到客户自配 key）"
if [ -f "$VENDOR_ENV" ]; then
  LLM_LINES="$(grep -E '^(ANTHROPIC_API_KEY|ANTHROPIC_MODEL|OPENAI_API_KEY|OPENAI_MODEL|DEEPSEEK_API_KEY|DEEPSEEK_MODEL|GEMINI_API_KEY|GEMINI_MODEL)=' "$VENDOR_ENV" 2>/dev/null || true)"
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
OWNER_EMAIL=$OWNER_EMAIL
ADMIN_PASSWORD=$ADMIN_PW
SECRETS_MASTER_KEY=$MASTER_KEY
PUBLIC_BASE_URL=https://$SLUG.$BASE_DOMAIN
LIVE_TRADING_ENABLED=false
I_UNDERSTAND_REAL_TRADING=false
REAL_ORDER_WRITE_ENABLED=false
MAX_LIVE_NOTIONAL_USDT=50
REALTIME_RECONCILER_ENABLED=false
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
    env_file: [.env]
    ports:
      - "127.0.0.1:$PORT:8787"
    volumes:
      - ./data:/app/data
      - ./backups:/app/backups
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "scripts/healthcheck.mjs"]
      interval: 30s
      timeout: 10s
      retries: 3
EOF

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
echo " 提醒: 让客户在 [系统设置→密钥库] 填自己的交易所 API Key"
echo "       （权限只勾'交易'，务必不要勾'提币'），并自行开启实盘闸门。"
