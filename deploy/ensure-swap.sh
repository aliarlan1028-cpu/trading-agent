#!/usr/bin/env bash
# BitLaunch 单服务器的 OOM 缓冲。只在系统完全没有 swap 时创建固定 /swapfile；
# 它不是客户容量，开通脚本仍按真实 MemAvailable 做硬限制。
set -euo pipefail

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ensure-swap.sh must run as root" >&2
  exit 1
fi
if [ "$SWAP_FILE" != "/swapfile" ]; then
  echo "Refusing non-standard swap target: $SWAP_FILE" >&2
  exit 1
fi
if ! [[ "$SWAP_SIZE_MB" =~ ^[0-9]+$ ]] || [ "$SWAP_SIZE_MB" -lt 512 ] || [ "$SWAP_SIZE_MB" -gt 8192 ]; then
  echo "SWAP_SIZE_MB must be between 512 and 8192" >&2
  exit 1
fi
if [ "$(swapon --noheadings --show=NAME | wc -l)" -gt 0 ]; then
  echo "swap already enabled; no change"
  exit 0
fi
if [ -e "$SWAP_FILE" ] && [ ! -f "$SWAP_FILE" ]; then
  echo "Refusing unexpected non-file target: $SWAP_FILE" >&2
  exit 1
fi
if [ ! -f "$SWAP_FILE" ]; then
  fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE"
fi
chmod 600 "$SWAP_FILE"
mkswap "$SWAP_FILE" >/dev/null
swapon "$SWAP_FILE"
grep -qF "$SWAP_FILE none swap sw 0 0" /etc/fstab || printf '%s\n' "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
sysctl -w vm.swappiness=10 >/dev/null
printf '%s\n' "vm.swappiness=10" > /etc/sysctl.d/99-trading-agent-swap.conf
echo "enabled ${SWAP_SIZE_MB}MB emergency swap at $SWAP_FILE"
