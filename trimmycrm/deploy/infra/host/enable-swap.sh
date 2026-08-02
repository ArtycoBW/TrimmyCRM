#!/usr/bin/env sh
# Configure a modest swap file for a small production VM.
# Run once as root: SWAP_SIZE_MB=2048 sh deploy/infra/host/enable-swap.sh
set -eu

swap_file="${SWAP_FILE:-/swapfile}"
swap_size_mb="${SWAP_SIZE_MB:-2048}"

case "$swap_size_mb" in
  ''|*[!0-9]*)
    echo "SWAP_SIZE_MB must be a positive integer" >&2
    exit 64
    ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root" >&2
  exit 77
fi

if awk 'NR > 1 { print $1 }' /proc/swaps | grep -Fqx "$swap_file"; then
  echo "Swap is already active at $swap_file"
  exit 0
fi

if [ ! -e "$swap_file" ]; then
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l "${swap_size_mb}M" "$swap_file"
  else
    dd if=/dev/zero of="$swap_file" bs=1M count="$swap_size_mb" status=progress
  fi
fi

chmod 600 "$swap_file"
mkswap "$swap_file" >/dev/null
swapon "$swap_file"

fstab_entry="$swap_file none swap sw 0 0"
if ! grep -Fqx "$fstab_entry" /etc/fstab; then
  printf '%s\n' "$fstab_entry" >> /etc/fstab
fi

cat > /etc/sysctl.d/99-trimmycrm-swap.conf <<'EOF'
vm.swappiness=10
EOF
sysctl --system >/dev/null

echo "Enabled ${swap_size_mb} MiB swap at $swap_file"
