#!/usr/bin/env sh
set -eu

SERVICE_NAME="${SERVICE_NAME:-adb-charge-control.service}"
UNIT_PATH="/etc/systemd/system/$SERVICE_NAME"

sudo systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
sudo rm -f "$UNIT_PATH"
sudo systemctl daemon-reload

echo "Uninstalled system service: $SERVICE_NAME"

