#!/usr/bin/env sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-adb-charge-control.service}"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$SYSTEMD_USER_DIR/$SERVICE_NAME"

mkdir -p "$SYSTEMD_USER_DIR"

cat > "$UNIT_PATH" <<EOF
[Unit]
Description=ADB Charge Control
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/start.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

cat <<EOF
Installed user service: $SERVICE_NAME

Useful commands:
  systemctl --user status $SERVICE_NAME
  journalctl --user -u $SERVICE_NAME -f
  systemctl --user restart $SERVICE_NAME
  systemctl --user disable --now $SERVICE_NAME

To keep this user service running after logout and after boot, run once:
  sudo loginctl enable-linger $(id -un)
EOF

