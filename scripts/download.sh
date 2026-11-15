#!/usr/bin/env bash
# Download ACS 5-year tables (filtered to one state) and Census boundary files.
# Usage: scripts/download.sh <state FIPS code>   e.g. 55 for Wisconsin
set -euo pipefail
cd "$(dirname "$0")/.."
FIPS="${1:-55}"
YEAR=2023
RAW=data/raw
mkdir -p "$RAW/shp"
B="https://www2.census.gov/programs-surveys/acs/summary_file/$YEAR/table-based-SF/data/5YRData"
for t in b01001 b01002 b03002 b15003 b17001 b19001 b19013 b19083; do
  # National files are large; keep only this state's state/county/tract rows while streaming.
  curl -sSf "$B/acsdt5y$YEAR-$t.dat" \
    | awk -F'|' -v f="$FIPS" 'NR==1 || $1 ~ ("^(0400000US" f "|0500000US" f "|1400000US" f ")")' > "$RAW/$t.dat" &
done
wait
G="https://www2.census.gov/geo/tiger/GENZ$YEAR/shp"
for z in "cb_${YEAR}_${FIPS}_tract_500k.zip" "cb_${YEAR}_us_county_500k.zip" "cb_${YEAR}_us_state_500k.zip"; do
  [ -f "$RAW/$z" ] || curl -sSf -o "$RAW/$z" "$G/$z"
  unzip -oq "$RAW/$z" -d "$RAW/shp"
done
echo "Downloaded data for state $FIPS"
