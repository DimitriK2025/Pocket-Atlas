#!/usr/bin/env bash
# Full pipeline for every state in region.json:
# download -> process stats -> tract shapes -> region shapes -> bundle for the web page.
set -euo pipefail
cd "$(dirname "$0")/.."
FIPS=$(python3 -c "import json; print(' '.join(s['fips'] for s in json.load(open('region.json'))['states']))")
bash scripts/download.sh $FIPS
for f in $FIPS; do
  python3 scripts/process_acs.py "$f"
  bash scripts/build_geo.sh "$f"
done
bash scripts/build_region.sh
python3 scripts/bundle.py
python3 scripts/stamp.py
