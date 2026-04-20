#!/usr/bin/env sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-adb-charge-control.service}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"
UNIT_PATH="/etc/systemd/system/$SERVICE_NAME"

TMP_UNIT="$(mktemp)"
cat > "$TMP_UNIT" <<EOF
[Unit]
Description=ADB Charge Control
After=network-online.target adb.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/start.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo install -m 0644 "$TMP_UNIT" "$UNIT_PATH"
rm -f "$TMP_UNIT"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

cat <<EOF
Installed system service: $SERVICE_NAME

Useful commands:
  sudo systemctl status $SERVICE_NAME
  sudo journalctl -u $SERVICE_NAME -f
  sudo systemctl restart $SERVICE_NAME
  sudo systemctl disable --now $SERVICE_NAME
EOF

