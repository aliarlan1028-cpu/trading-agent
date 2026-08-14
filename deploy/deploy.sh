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
GIT_REV="$(git -C "$LOCAL_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git -C "$LOCAL_DIR" status --porcelain 2>/dev/null)" ]; then
  echo "FATAL: 正式部署要求干净工作树；请先审查并提交全部改动（含未跟踪文件）" >&2
  git -C "$LOCAL_DIR" status --short >&2
  exit 1
fi
RELEASE_ID="${GIT_REV}-$(date -u +%Y%m%dT%H%M%SZ)"

EXCLUDES=(--exclude node_modules --exclude .git --exclude data --exclude backups --exclude offsite-backups --exclude secrets
          --exclude ios --exclude dist --exclude .env --exclude '*.log'
          --exclude tmp --exclude public/kordyn-concept-faithful.html --exclude public/kordyn-marketing-v4.html
          --exclude public/landing-concept-v3.html --exclude public/landing-prototype.html
          --exclude deploy/vendor.env --exclude deploy/monitor.env)  # 服务器专有密钥文件(gitignore,本地无)——曾被 --delete 误删导致新租户静默无 LLM key

if [ "${1:-}" = "--dry" ]; then
  rsync -azn --delete -v "${EXCLUDES[@]}" "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/" | head -50
  exit 0
fi

echo "==> [1/5] 本地生产质量闸（test/lint/build/agent-eval/audit）"
for gate in "npm test" "npm run lint" "npm run build" "npm run eval:agent" "npm audit --audit-level=high"; do
  log="/tmp/deploy-$(echo "$gate" | tr ' /:' '---').log"
  if ! ( cd "$LOCAL_DIR" && $gate ) >"$log" 2>&1; then
    echo "  ❌ $gate 未通过 → 中止部署（服务器完全没被触碰）。最后 25 行："
    tail -25 "$log"
    exit 1
  fi
  echo "  ✅ $gate"
done

echo "==> [2/5] rsync 代码（排除 .env/data/ios/dist）"
rsync -az --delete "${EXCLUDES[@]}" "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/"

echo "==> [3/5] 远端构建 + 保留回滚镜像"
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
export APP_RELEASE="$RELEASE_ID"
grep -q '^HOST=0.0.0.0' .env || { echo "FATAL: .env 缺少 HOST=0.0.0.0（会 502），中止"; exit 1; }
mkdir -p data backups offsite-backups
chown -R 1000:1000 data backups offsite-backups
# 数据迁移前先做一致快照并验证可恢复性；失败则旧容器继续运行、部署中止。
if docker compose ps -q "$SERVICE" </dev/null | grep -q .; then
  docker compose exec -T "$SERVICE" npm run backup </dev/null
  # 首次启用“强制加密恢复演练”时，旧容器进程还没有读取刚写入 .env 的密钥路径。
  # 显式注入只读挂载内的路径生成首份加密快照，避免候选镜像在正确的 fail-closed
  # 检查处卡住；密钥内容本身从不进入命令行、日志或 .env。
  if grep -q '^RESTORE_DRILL_REQUIRE_ENCRYPTED=true$' .env && ! find backups -maxdepth 1 -name 'trading-agent-*.sqlite.enc' -type f | grep -q .; then
    backup_key_file="\$(awk -F= '\$1 == "BACKUP_ENCRYPTION_KEY_FILE" { print substr(\$0, index(\$0, "=") + 1); exit }' .env)"
    [ -n "\$backup_key_file" ] || { echo "FATAL: encrypted restore drill requires BACKUP_ENCRYPTION_KEY_FILE"; exit 1; }
    docker compose exec -T -e BACKUP_ENCRYPTION_KEY_FILE="\$backup_key_file" "$SERVICE" npm run backup </dev/null
  fi
else
  echo "  首次部署：无旧容器可备份，将在候选容器启动并初始化后建立首个恢复点"
fi
# 回滚必须锁定“当前正在运行”的稳定镜像，不能使用 latest：
# 上一次构建若预检失败，latest 已可能指向从未上线的候选镜像。
running_container=\$(docker compose ps -q "$SERVICE" </dev/null)
if [ -n "\$running_container" ]; then
  running_image=\$(docker inspect -f '{{.Image}}' "\$running_container")
  docker tag "\$running_image" "$IMAGE:rollback"
elif docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$IMAGE:latest" "$IMAGE:rollback"
fi
# 上线前任何步骤失败都把 latest 还原到稳定镜像；旧容器此时仍在运行。
restore_stable_latest() {
  docker image inspect "$IMAGE:rollback" >/dev/null 2>&1 && docker tag "$IMAGE:rollback" "$IMAGE:latest" || true
}
trap restore_stable_latest ERR
docker compose build </dev/null 2>&1 | tail -2
# 用候选镜像对刚创建的快照做只读恢复演练；兼容当前运行镜像尚无 restore-drill 命令的首次升级。
if find backups -maxdepth 1 \( -name 'trading-agent-*.sqlite' -o -name 'trading-agent-*.sqlite.enc' \) -type f | grep -q .; then
  docker compose run --rm --no-deps "$SERVICE" npm run restore-drill </dev/null
fi
# 使用新镜像 + 生产 .env + 生产数据卷运行上线前检查；失败时旧容器保持运行。
docker compose run --rm --no-deps "$SERVICE" npm run preflight:production </dev/null
# up -d 必须断开 stdin/stdout/stderr：否则容器继承 ssh 的 stdout fd，ssh 等不到 EOF 会永久挂死（曾致部署"卡住"37 分钟）
docker compose up -d </dev/null >/dev/null 2>&1 && echo "  up -d ok"
trap - ERR
REMOTE

echo "==> [4/5] 验证（最多 90s：health 200 且 CPU 恢复正常）"
if ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$HOST" bash -s <<REMOTE
set -uo pipefail
cd "$REMOTE_DIR"
export APP_RELEASE="$RELEASE_ID"
ok=0
for i in \$(seq 1 18); do
  sleep 5
  code=\$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$HEALTH_URL" 2>/dev/null) || code=000
  cpu=\$(docker stats --no-stream --format "{{.CPUPerc}}" \$(docker compose ps -q "$SERVICE" </dev/null) 2>/dev/null | tr -d '%' | cut -d. -f1)
  if [ "\$code" = "200" ] && { [ -z "\$cpu" ] || [ "\$cpu" -le 80 ]; }; then
    echo "  health 200 · CPU \${cpu:-?}%"
    ok=1
    break
  fi
  echo "  ... 第 \$i 次检查 HTTP \$code · CPU \${cpu:-?}%"
done
[ "\$ok" = "1" ] || { echo "90 秒内健康检查与 CPU 稳态未同时通过"; exit 1; }
# 首次部署在服务初始化后创建第一个一致恢复点；升级部署也再生成一次新版本可读快照。
docker compose exec -T "$SERVICE" npm run backup </dev/null >/dev/null
docker compose exec -T "$SERVICE" npm run restore-drill </dev/null >/dev/null
install -m 0644 deploy/trading-agent-restore-drill.service /etc/systemd/system/trading-agent-restore-drill.service
install -m 0644 deploy/trading-agent-restore-drill.timer /etc/systemd/system/trading-agent-restore-drill.timer
install -m 0755 deploy/safe-docker-cleanup.sh /usr/local/sbin/trading-agent-safe-cleanup
install -m 0644 deploy/trading-agent-cache-prune.service /etc/systemd/system/trading-agent-cache-prune.service
install -m 0644 deploy/trading-agent-cache-prune.timer /etc/systemd/system/trading-agent-cache-prune.timer
install -m 0644 deploy/trading-agent-monitor.service /etc/systemd/system/trading-agent-monitor.service
install -m 0644 deploy/trading-agent-monitor.timer /etc/systemd/system/trading-agent-monitor.timer
install -m 0755 deploy/ensure-swap.sh /usr/local/sbin/trading-agent-ensure-swap
systemctl daemon-reload
systemctl enable --now trading-agent-restore-drill.timer >/dev/null
/usr/local/sbin/trading-agent-ensure-swap
systemctl enable --now trading-agent-cache-prune.timer >/dev/null
systemctl enable --now trading-agent-monitor.timer >/dev/null
/usr/local/sbin/trading-agent-safe-cleanup
exit 0
REMOTE
then
  echo "==> [5/5] ✅ 部署成功并通过验证"
else
  echo "==> [5/5] ❌ 验证失败 → 自动回滚上一镜像"
  ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
docker image inspect "$IMAGE:rollback" >/dev/null 2>&1 || { echo "无回滚镜像，需人工介入"; exit 1; }
docker tag "$IMAGE:rollback" "$IMAGE:latest"
docker compose up -d --force-recreate </dev/null >/dev/null 2>&1 && echo "  回滚 up -d ok"
sleep 8
code=\$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$HEALTH_URL" 2>/dev/null) || code=000
echo "回滚后 health: HTTP \$code"
REMOTE
  echo "已回滚到上一版本，请排查本次改动后再部署。"
  exit 1
fi
