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
TABLES="b01001 b01002 b03002 b04006 b05002 b08013 b08301 b08303 b11001 b11016 b12001 b14001 b15003
  b17001 b19001 b19013 b19083 b21001 b25002 b25003 b25004 b25010 b25034
  b25035 b25044 b25064 b25070 b25075 b25077 b27010 c16001 c17002 c24010 c24030"
mkdir -p "$RAW/doc"
curl -sSf -o "$RAW/doc/ACS${YEAR}5YR_Table_Shells.txt" \
  "https://www2.census.gov/programs-surveys/acs/summary_file/$YEAR/table-based-SF/documentation/ACS${YEAR}5YR_Table_Shells.txt"
for t in $TABLES; do
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
