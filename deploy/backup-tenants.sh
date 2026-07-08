#!/usr/bin/env bash
# 备份所有客户实例的数据（sqlite + 密钥库密文）。建议加到 cron 每日运行。
# 用法:
#   ./backup-tenants.sh [dest_dir]
# cron 示例（每天 3:30）:
#   30 3 * * * /opt/trading-agent/deploy/backup-tenants.sh >> /var/log/tenant-backup.log 2>&1
set -euo pipefail
TENANTS_DIR="${TENANTS_DIR:-/opt/tenants}"
DEST="${1:-/opt/tenant-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"
# 主实例也一起备份。
for base in /opt/trading-agent "$TENANTS_DIR"/*; do
  [ -d "$base/data" ] || continue
  name="$(basename "$base")"
  out="$DEST/$name-$STAMP.tar.gz"
  tar -czf "$out" -C "$base" data 2>/dev/null && echo "backed up $name -> $out"
done

# 清理超过保留期的旧备份。
find "$DEST" -name '*.tar.gz' -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true
echo "done. retention=${KEEP_DAYS}d dest=$DEST"
