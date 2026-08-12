#!/usr/bin/env bash
# 备份所有客户实例的一致 SQLite 快照（含密钥库密文）。建议加到 cron 每日运行。
# 用法:
#   ./backup-tenants.sh [dest_dir]
# cron 示例（每天 3:30）:
#   30 3 * * * /opt/trading-agent/deploy/backup-tenants.sh >> /var/log/tenant-backup.log 2>&1
set -euo pipefail
umask 077
TENANTS_DIR="${TENANTS_DIR:-/opt/tenants}"
DEST="${1:-/opt/tenant-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"
chmod 700 "$DEST"
# 主实例也一起备份。先在容器内调用 SQLite Online Backup API，禁止直接 tar 活跃 WAL 目录。
for base in /opt/trading-agent "$TENANTS_DIR"/*; do
  [ -d "$base/data" ] || continue
  name="$(basename "$base")"
  if [ "$base" = "/opt/trading-agent" ]; then
    compose=(docker compose -f "$base/docker-compose.yml")
    service="trading-agent"
  else
    compose=(docker compose -p "tenant-$name" -f "$base/docker-compose.yml")
    service="app"
  fi
  "${compose[@]}" exec -T "$service" node scripts/backup.mjs >/tmp/trading-backup-"$name".log
  # 异地目录只接收经过认证加密的快照；禁止把账户、审计和密钥库数据以明文 SQLite 复制出去。
  latest="$(find "$base/backups" -maxdepth 1 -name 'trading-agent-*.sqlite.enc' -type f -print | sort | tail -1)"
  [ -n "$latest" ] || { echo "backup missing for $name"; exit 1; }
  out="$DEST/$name-$STAMP.sqlite.enc"
  cp "$latest" "$out"
  sha256sum "$out" > "$out.sha256"
  sha256sum -c "$out.sha256" >/dev/null
  echo "backed up and verified $name -> $out"
done

# 清理超过保留期的旧备份。
find "$DEST" \( -name '*.sqlite.enc' -o -name '*.sqlite.enc.sha256' \) -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true
echo "done. retention=${KEEP_DAYS}d dest=$DEST"
