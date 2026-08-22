#!/usr/bin/env bash
# Production-safe disk maintenance: prune old build cache and untagged images.
# Never prunes tagged images, containers, volumes, application data, or backups.
set -euo pipefail

threshold_pct="${DISK_CLEANUP_THRESHOLD_PCT:-70}"
cache_age="${DOCKER_BUILD_CACHE_MAX_AGE:-168h}"
disk_pct="$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"

if ! [[ "$disk_pct" =~ ^[0-9]+$ ]]; then
  echo "Unable to determine root filesystem usage" >&2
  exit 1
fi

echo "disk_before=${disk_pct}% threshold=${threshold_pct}% cache_age=${cache_age}"
if (( disk_pct < threshold_pct )); then
  echo "skip: disk usage is below threshold"
  exit 0
fi

/usr/bin/docker builder prune --all --force --filter "until=${cache_age}"
/usr/bin/docker image prune --force
disk_after="$(df -P / | awk 'NR == 2 { print $5 }')"
echo "disk_after=${disk_after}"
