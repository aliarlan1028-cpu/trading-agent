#!/usr/bin/env bash
# 注销一个客户实例：停容器、移除 Caddy 路由。默认保留数据目录（可 --purge 一并删）。
# 用法:
#   ./deprovision-tenant.sh <slug> [--purge]
set -euo pipefail

SLUG="${1:-}"
PURGE="${2:-}"
BASE_DOMAIN="${BASE_DOMAIN:-yegidawir.xyz}"
TENANTS_DIR="${TENANTS_DIR:-/opt/tenants}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
DIR="$TENANTS_DIR/$SLUG"

if [ -z "$SLUG" ]; then echo "用法: $0 <slug> [--purge]" >&2; exit 1; fi
if [ ! -d "$DIR" ]; then echo "租户不存在: $DIR" >&2; exit 1; fi

docker compose -p "tenant-$SLUG" -f "$DIR/docker-compose.yml" down || true

# 删除 Caddyfile 中对应 site 块（从 "slug.domain {" 到匹配的 "}"）。
if grep -q "^$SLUG.$BASE_DOMAIN {" "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%s)"
  awk -v host="$SLUG.$BASE_DOMAIN {" '
    $0==host {skip=1; next}
    skip && $0=="}" {skip=0; next}
    !skip {print}
  ' "$CADDYFILE" > "$CADDYFILE.tmp" && mv "$CADDYFILE.tmp" "$CADDYFILE"
  systemctl reload caddy
fi

if [ "$PURGE" = "--purge" ]; then
  # 备份一份 sqlite 再删，避免误删无法恢复。
  BK="/opt/tenant-purged-$SLUG-$(date +%Y%m%d%H%M%S).tar.gz"
  tar -czf "$BK" -C "$TENANTS_DIR" "$SLUG" || true
  rm -rf "$DIR"
  echo "已删除并归档到 $BK"
else
  echo "容器与路由已移除；数据目录保留在 $DIR （加 --purge 可删除并归档）"
fi
