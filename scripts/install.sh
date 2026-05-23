#!/usr/bin/env bash
set -euo pipefail

PREFIX="${PREFIX:-/opt/cortex}"
CONFIG_DIR="${CONFIG_DIR:-/etc/cortex}"
DATA_DIR="${DATA_DIR:-/var/lib/cortex}"
LOG_DIR="${LOG_DIR:-/var/log/cortex}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

echo "==> Installing CORTEX to ${PREFIX}"

mkdir -p "${PREFIX}" "${CONFIG_DIR}" "${DATA_DIR}" "${LOG_DIR}"

# Copy files
cp -r . "${PREFIX}/"
chmod +x "${PREFIX}/cortex.js" "${PREFIX}/cortexd.js"

# Install example config if none exists
if [[ ! -f "${CONFIG_DIR}/cortex.env" ]]; then
  cp "${PREFIX}/configs/cortex.env.example" "${CONFIG_DIR}/cortex.env"
  echo "==> Created ${CONFIG_DIR}/cortex.env (edit before starting)"
fi

# Install systemd unit
if [[ -d "${SYSTEMD_DIR}" ]]; then
  cp "${PREFIX}/systemd/cortexd.service" "${SYSTEMD_DIR}/cortexd.service"
  systemctl daemon-reload || true
  echo "==> Installed systemd unit (systemctl enable --now cortexd)"
fi

echo "==> Install complete."
echo "   Edit config: ${CONFIG_DIR}/cortex.env"
echo "   Start:       systemctl start cortexd"
echo "   Logs:        journalctl -u cortexd -f"
