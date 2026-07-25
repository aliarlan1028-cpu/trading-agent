#!/usr/bin/env bash
# 一键部署（本机执行）：固定排除清单 rsync → 服务器保留回滚镜像 → build → up → 验证 → 失败自动回滚。
# 用法：deploy/deploy.sh            正常部署
#       deploy/deploy.sh --dry     只看 rsync 会传什么，不实际执行
# 历史事故教训（勿改排除清单）：.env 曾被本地覆盖导致 502；data/ 是生产数据库绝不能碰。
set -euo pipefail

HOST="${DEPLOY_HOST:-root@199.217.98.153}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/trading-agent}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="trading-agent"
IMAGE="trading-agent-trading-agent"
HEALTH_URL="http://127.0.0.1:8787/api/health"

EXCLUDES=(--exclude node_modules --exclude .git --exclude data --exclude backups
          --exclude ios --exclude dist --exclude .env --exclude '*.log')

if [ "${1:-}" = "--dry" ]; then
  rsync -azn --delete -v "${EXCLUDES[@]}" "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/" | head -50
  exit 0
fi

echo "==> [1/4] rsync 代码（排除 .env/data/ios/dist）"
rsync -az --delete "${EXCLUDES[@]}" "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/"

echo "==> [2/4] 远端构建 + 保留回滚镜像"
ssh -o ConnectTimeout=30 "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
grep -q '^HOST=0.0.0.0' .env || { echo "FATAL: .env 缺少 HOST=0.0.0.0（会 502），中止"; exit 1; }
docker image inspect "$IMAGE:latest" >/dev/null 2>&1 && docker tag "$IMAGE:latest" "$IMAGE:rollback"
docker compose build 2>&1 | tail -2
docker compose up -d 2>&1 | tail -1
REMOTE

echo "==> [3/4] 验证（最多 90s：health 200 且 CPU 恢复正常）"
if ssh -o ConnectTimeout=30 "$HOST" bash -s <<REMOTE
set -uo pipefail
cd "$REMOTE_DIR"
ok=0
for i in \$(seq 1 18); do
  sleep 5
  code=\$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo 000)
  if [ "\$code" = "200" ]; then ok=1; break; fi
  echo "  ... 第 \$i 次检查 HTTP \$code"
done
[ "\$ok" = "1" ] || { echo "健康检查未通过"; exit 1; }
cpu=\$(docker stats --no-stream --format "{{.CPUPerc}}" \$(docker compose ps -q "$SERVICE") 2>/dev/null | tr -d '%' | cut -d. -f1)
echo "  health 200 · CPU \${cpu:-?}%"
if [ -n "\$cpu" ] && [ "\$cpu" -gt 80 ]; then echo "CPU 异常偏高(\${cpu}%)"; exit 1; fi
exit 0
REMOTE
then
  echo "==> [4/4] ✅ 部署成功并通过验证"
else
  echo "==> [4/4] ❌ 验证失败 → 自动回滚上一镜像"
  ssh -o ConnectTimeout=30 "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
docker image inspect "$IMAGE:rollback" >/dev/null 2>&1 || { echo "无回滚镜像，需人工介入"; exit 1; }
docker tag "$IMAGE:rollback" "$IMAGE:latest"
docker compose up -d --force-recreate 2>&1 | tail -1
sleep 8
code=\$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo 000)
echo "回滚后 health: HTTP \$code"
REMOTE
  echo "已回滚到上一版本，请排查本次改动后再部署。"
  exit 1
fi
