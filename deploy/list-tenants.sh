#!/usr/bin/env bash
# 列出所有客户实例及其运行状态。
set -euo pipefail
TENANTS_DIR="${TENANTS_DIR:-/opt/tenants}"
BASE_DOMAIN="${BASE_DOMAIN:-yegidawir.xyz}"

[ -d "$TENANTS_DIR" ] || { echo "尚无客户实例（$TENANTS_DIR 不存在）"; exit 0; }
printf "%-16s %-34s %-10s %s\n" "SLUG" "URL" "PORT" "STATUS"
for d in "$TENANTS_DIR"/*/; do
  [ -d "$d" ] || continue
  slug="$(basename "$d")"
  port="$(grep -oE '127.0.0.1:[0-9]+:8787' "$d/docker-compose.yml" 2>/dev/null | grep -oE ':[0-9]+:' | tr -d ':' | head -1)"
  status="$(docker compose -p "tenant-$slug" -f "$d/docker-compose.yml" ps --format '{{.Status}}' 2>/dev/null | head -1)"
  printf "%-16s %-34s %-10s %s\n" "$slug" "https://$slug.$BASE_DOMAIN" "${port:-?}" "${status:-stopped}"
done
