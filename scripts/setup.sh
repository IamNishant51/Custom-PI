#!/usr/bin/env bash
set -euo pipefail

echo "=== PI Custom Pack Setup ==="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Installing Node.js..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install node
  elif command -v apt &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
    sudo apt install -y nodejs
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y nodejs
  else
    echo "Please install Node.js 22+ manually: https://nodejs.org"
    exit 1
  fi
fi

echo "Node $(node -v) — OK"

# Install dependencies
echo "Installing project dependencies..."
npm install

# Install web client dependencies
echo "Installing web client dependencies..."
cd assets/web/client && npm install && cd ../..

# Build web client
echo "Building web client..."
npm run build:web

# Create config
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit to configure"
fi

echo ""
echo "=== Setup Complete ==="
echo "Run: node assets/web/web-server.mjs"
echo "Open: http://localhost:4321"
