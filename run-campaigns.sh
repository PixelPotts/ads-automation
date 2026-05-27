#!/usr/bin/env bash
# Run all 4 campaign configs through the Google Ads wizard.
# Usage: ./run-campaigns.sh [--test]
# --test: auto-close after review step (no publish)

set -e
cd "$(dirname "$0")"

MODE="${1:---test}"

CONFIGS=(
  "campaigns/french-drain.json"
  "campaigns/mobile-detailing.json"
  "campaigns/pressure-washing.json"
  "campaigns/junk-removal.json"
)

for config in "${CONFIGS[@]}"; do
  name=$(basename "$config" .json)
  echo ""
  echo "========================================"
  echo "  Campaign: $name"
  echo "========================================"
  node create-campaign.js --config "$config" $MODE
  echo "  Done: $name"
  echo ""
  sleep 5
done

echo "All campaigns processed."
