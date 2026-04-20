#!/usr/bin/env sh
set -eu

SERVICE_NAME="${SERVICE_NAME:-adb-charge-control.service}"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$SYSTEMD_USER_DIR/$SERVICE_NAME"

systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true
rm -f "$UNIT_PATH"
systemctl --user daemon-reload

echo "Uninstalled user service: $SERVICE_NAME"

