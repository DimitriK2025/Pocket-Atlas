#!/usr/bin/env bash
# Full pipeline for one state: download -> process stats -> map shapes -> bundle for the web page.
# Usage: scripts/build.sh <state FIPS> "<State Name>"     e.g.  scripts/build.sh 17 Illinois
set -euo pipefail
cd "$(dirname "$0")/.."
FIPS="${1:-55}"; NAME="${2:-Wisconsin}"
bash scripts/download.sh "$FIPS"
python3 scripts/process_acs.py "$FIPS"
bash scripts/build_geo.sh "$FIPS"
python3 scripts/bundle.py "$FIPS" "$NAME"
