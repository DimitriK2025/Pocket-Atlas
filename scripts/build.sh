#!/usr/bin/env bash
# Full pipeline: download -> process stats -> build map shapes -> bundle for the web page.
# Usage: scripts/build.sh <state FIPS> "<State Name>"     e.g.  scripts/build.sh 55 Wisconsin
set -euo pipefail
cd "$(dirname "$0")/.."
FIPS="${1:-55}"; NAME="${2:-Wisconsin}"
bash scripts/download.sh "$FIPS"
python3 scripts/process_acs.py
bash scripts/build_geo.sh "$FIPS"
python3 scripts/bundle.py "$NAME"
