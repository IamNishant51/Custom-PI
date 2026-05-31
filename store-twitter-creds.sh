#!/usr/bin/env bash
# Store Twitter API credentials in the Pi vault via the running web server.
# Run this after creating your X Developer App and generating tokens.
set -e

API="http://localhost:4321/api/vault"

echo "=== Twitter Credential Store ==="
echo "Paste the 4 values from https://console.x.com when prompted."
echo ""

read -p "API Key (Consumer Key): " key1
read -p "API Secret (Consumer Secret): " key2
read -p "Access Token: " key3
read -p "Access Token Secret: " key4

curl -s -X POST "$API/set" -H "Content-Type: application/json" \
  -d "{\"key\":\"TWITTER_API_KEY\",\"value\":\"$key1\"}" > /dev/null
echo "  ✓ TWITTER_API_KEY stored"

curl -s -X POST "$API/set" -H "Content-Type: application/json" \
  -d "{\"key\":\"TWITTER_API_SECRET\",\"value\":\"$key2\"}" > /dev/null
echo "  ✓ TWITTER_API_SECRET stored"

curl -s -X POST "$API/set" -H "Content-Type: application/json" \
  -d "{\"key\":\"TWITTER_ACCESS_TOKEN\",\"value\":\"$key3\"}" > /dev/null
echo "  ✓ TWITTER_ACCESS_TOKEN stored"

curl -s -X POST "$API/set" -H "Content-Type: application/json" \
  -d "{\"key\":\"TWITTER_ACCESS_SECRET\",\"value\":\"$key4\"}" > /dev/null
echo "  ✓ TWITTER_ACCESS_SECRET stored"

echo ""
echo "All 4 credentials stored. Verify:"
curl -s "$API/list" | python3 -m json.tool
