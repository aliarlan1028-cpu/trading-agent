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
          --exclude ios --exclude dist --exclude .env --exclude '*.log'
          --exclude deploy/vendor.env --exclude deploy/monitor.env)  # 服务器专有密钥文件(gitignore,本地无)——曾被 --delete 误删导致新租户静默无 LLM key

if [ "${1:-}" = "--dry" ]; then
  rsync -azn --delete -v "${EXCLUDES[@]}" "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/" | head -50
  exit 0
fi

echo "==> [1/5] 本地测试闸（npm test；不过则中止，不碰服务器）"
if ! ( cd "$LOCAL_DIR" && npm test ) >/tmp/deploy-test.log 2>&1; then
  echo "  ❌ 测试未通过 → 中止部署（服务器完全没被触碰）。最后 25 行："
  tail -25 /tmp/deploy-test.log
  exit 1
fi
echo "  ✅ 测试通过（$(grep -oE 'tests [0-9]+' /tmp/deploy-test.log | tail -1 || echo ok)）"

echo "==> [2/5] rsync 代码（排除 .env/data/ios/dist）"
rsync -az --delete "${EXCLUDES[@]}" "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/"

echo "==> [3/5] 远端构建 + 保留回滚镜像"
ssh -o ConnectTimeout=30 "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
# 写"部署静默"标记:容器重建的短暂宕机期间,监控(monitor-tenants.sh)跳过巡检、不发「宕机/恢复」告警。
# 标记放 data/.monitor(rsync 排除、跨部署保留);监控端超 480s 自动失效,ssh 掉线也不会永久静默。
mkdir -p data/.monitor && touch data/.monitor/.deploying
grep -q '^HOST=0.0.0.0' .env || { echo "FATAL: .env 缺少 HOST=0.0.0.0（会 502），中止"; exit 1; }
docker image inspect "$IMAGE:latest" >/dev/null 2>&1 && docker tag "$IMAGE:latest" "$IMAGE:rollback"
docker compose build </dev/null 2>&1 | tail -2
# up -d 必须断开 stdin/stdout/stderr：否则容器继承 ssh 的 stdout fd，ssh 等不到 EOF 会永久挂死（曾致部署"卡住"37 分钟）
docker compose up -d </dev/null >/dev/null 2>&1 && echo "  up -d ok"
REMOTE

echo "==> [4/5] 验证（最多 90s：health 200 且 CPU 恢复正常）"
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
cpu=\$(docker stats --no-stream --format "{{.CPUPerc}}" \$(docker compose ps -q "$SERVICE" </dev/null) 2>/dev/null | tr -d '%' | cut -d. -f1)
echo "  health 200 · CPU \${cpu:-?}%"
if [ -n "\$cpu" ] && [ "\$cpu" -gt 80 ]; then echo "CPU 异常偏高(\${cpu}%)"; exit 1; fi
exit 0
REMOTE
then
  ssh -o ConnectTimeout=15 "$HOST" "rm -f $REMOTE_DIR/data/.monitor/.deploying" 2>/dev/null || true
  echo "==> [5/5] ✅ 部署成功并通过验证"
else
  echo "==> [5/5] ❌ 验证失败 → 自动回滚上一镜像"
  ssh -o ConnectTimeout=30 "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
docker image inspect "$IMAGE:rollback" >/dev/null 2>&1 || { echo "无回滚镜像，需人工介入"; exit 1; }
docker tag "$IMAGE:rollback" "$IMAGE:latest"
docker compose up -d --force-recreate </dev/null >/dev/null 2>&1 && echo "  回滚 up -d ok"
sleep 8
code=\$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo 000)
echo "回滚后 health: HTTP \$code"
REMOTE
  ssh -o ConnectTimeout=15 "$HOST" "rm -f $REMOTE_DIR/data/.monitor/.deploying" 2>/dev/null || true
  echo "已回滚到上一版本，请排查本次改动后再部署。"
  exit 1
fi
