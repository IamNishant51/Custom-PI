#!/usr/bin/env bash
# Install pi-custom-pack as a systemd service
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="pi-custom-pack"
SERVICE_FILE="${REPO_DIR}/${SERVICE_NAME}.service"
TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "Service file not found: $SERVICE_FILE"
  exit 1
fi

echo "Installing systemd service..."
sudo cp "$SERVICE_FILE" "$TARGET"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

echo "Service installed and started."
echo "Check status: sudo systemctl status $SERVICE_NAME"
echo "View logs: sudo journalctl -u $SERVICE_NAME -f"
