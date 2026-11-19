#!/usr/bin/env bash
# ZIP Code Tabulation Areas (ZCTAs): ACS rows for every ZCTA, ZCTA boundaries, and the
# ZCTA-to-county overlap file used to assign each ZCTA to one state and county.
set -euo pipefail
cd "$(dirname "$0")/.."
YEAR=2023
RAW=data/raw
mkdir -p "$RAW/zcta" "$RAW/shp"
TABLES="b01001 b01002 b03002 b04006 b05002 b08013 b08301 b08303 b11001 b11016 b12001 b14001 b15003
  b17001 b19001 b19013 b19083 b21001 b25002 b25003 b25004 b25010 b25034 b25035 b25044 b25064
  b25070 b25075 b25077 b27010 c16001 c17002 c24010 c24030"
B="https://www2.census.gov/programs-surveys/acs/summary_file/$YEAR/table-based-SF/data/5YRData"
for t in $TABLES; do
  curl -sSf "$B/acsdt5y$YEAR-$t.dat" | awk -F'|' 'NR == 1 || substr($1, 1, 9) == "860Z200US"' > "$RAW/zcta/$t.dat" &
done
wait
# ACS 2019-2023 uses the 2020 ZCTA boundaries
Z=cb_2020_us_zcta520_500k.zip
[ -f "$RAW/$Z" ] || curl -sSf -o "$RAW/$Z" "https://www2.census.gov/geo/tiger/GENZ2020/shp/$Z"
unzip -oq "$RAW/$Z" -d "$RAW/shp"
REL=tab20_zcta520_county20_natl.txt
[ -f "$RAW/$REL" ] || curl -sSf -o "$RAW/$REL" "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/$REL"
echo "Downloaded ZCTA data"
