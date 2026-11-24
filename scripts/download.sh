#!/usr/bin/env bash
# Download ACS 5-year tables and Census boundary files for one or more states.
# Each national table file is streamed once and split into data/raw/<FIPS>/<table>.dat.
# Usage: scripts/download.sh <FIPS> [<FIPS> ...]     e.g. scripts/download.sh 55 17 19
set -euo pipefail
cd "$(dirname "$0")/.."
FIPS_LIST="${*:-55}"
YEAR=2023
RAW=data/raw
mkdir -p "$RAW/shp" "$RAW/doc"
for f in $FIPS_LIST; do mkdir -p "$RAW/$f"; done
TABLES="b01001 b01001b b01002 b03002 b04006 b05002 b08013 b08301 b08303 b11001 b11016 b12001 b14001 b15003
  b17001 b19001 b19013 b19083 b21001 b25002 b25003 b25004 b25010 b25034 b25035 b25044 b25064
  b25070 b25075 b25077 b27010 c16001 c17002 c24010 c24030"
[ -f "$RAW/doc/ACS${YEAR}5YR_Table_Shells.txt" ] || curl -sSf -o "$RAW/doc/ACS${YEAR}5YR_Table_Shells.txt" \
  "https://www2.census.gov/programs-surveys/acs/summary_file/$YEAR/table-based-SF/documentation/ACS${YEAR}5YR_Table_Shells.txt"
B="https://www2.census.gov/programs-surveys/acs/summary_file/$YEAR/table-based-SF/data/5YRData"
for t in $TABLES; do
  # keep state (040), county (050) and tract (140) rows for the requested states
  curl -sSf "$B/acsdt5y$YEAR-$t.dat" | awk -F'|' -v want="$FIPS_LIST" -v raw="$RAW" -v t="$t" '
    BEGIN { n = split(want, w, " "); for (i = 1; i <= n; i++) ok[w[i]] = 1 }
    NR == 1 { for (f in ok) print > (raw "/" f "/" t ".dat"); next }
    { lev = substr($1, 1, 9); f = substr($1, 10, 2)
      if ((lev == "0400000US" || lev == "0500000US" || lev == "1400000US") && (f in ok)) print > (raw "/" f "/" t ".dat") }' &
done
wait
G="https://www2.census.gov/geo/tiger/GENZ$YEAR/shp"
for z in cb_${YEAR}_us_county_500k.zip cb_${YEAR}_us_state_500k.zip $(for f in $FIPS_LIST; do echo "cb_${YEAR}_${f}_tract_500k.zip"; done); do
  [ -f "$RAW/$z" ] || curl -sSf -o "$RAW/$z" "$G/$z"
  unzip -oq "$RAW/$z" -d "$RAW/shp"
done
echo "Downloaded data for states: $FIPS_LIST"
