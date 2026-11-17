#!/usr/bin/env bash
# Simplified census-tract TopoJSON for one state -> data/build/<FIPS>/tracts.json
set -euo pipefail
cd "$(dirname "$0")/.."
FIPS="${1:?state FIPS}"
mkdir -p "data/build/$FIPS"
npx mapshaper -i "data/raw/shp/cb_2023_${FIPS}_tract_500k.shp" name=tracts \
  -filter-fields GEOID,NAMELSAD,NAMELSADCO,ALAND \
  -rename-fields name=NAMELSAD,county=NAMELSADCO,aland=ALAND \
  -simplify 35% keep-shapes weighted \
  -o "data/build/$FIPS/tracts.json" format=topojson quantization=100000
