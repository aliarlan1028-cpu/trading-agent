#!/usr/bin/env bash
# Production-safe disk maintenance: cap build cache and prune untagged images.
# Never prunes tagged images, containers, volumes, application data, or backups.
set -euo pipefail

max_used_space="${DOCKER_BUILD_CACHE_MAX_USED_SPACE:-3gb}"
disk_pct="$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"

if ! [[ "$disk_pct" =~ ^[0-9]+$ ]]; then
  echo "Unable to determine root filesystem usage" >&2
  exit 1
fi

echo "disk_before=${disk_pct}% build_cache_max_used_space=${max_used_space}"
/usr/bin/docker buildx prune --all --force --max-used-space "$max_used_space"
/usr/bin/docker image prune --force
disk_after="$(df -P / | awk 'NR == 2 { print $5 }')"
echo "disk_after=${disk_after}"
