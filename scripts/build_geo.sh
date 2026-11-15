#!/usr/bin/env bash
# Build simplified TopoJSON (state outline, counties, tracts) for one state.
set -euo pipefail
cd "$(dirname "$0")/.."
FIPS="${1:-55}"
SHP=data/raw/shp
mkdir -p data/build
npx mapshaper \
  -i "$SHP/cb_2023_us_state_500k.shp" name=state \
  -filter "STATEFP=='$FIPS'" -filter-fields GEOID,NAME \
  -i "$SHP/cb_2023_us_county_500k.shp" name=counties \
  -filter "STATEFP=='$FIPS'" -filter-fields GEOID,NAMELSAD,ALAND \
  -rename-fields name=NAMELSAD,aland=ALAND \
  -i "$SHP/cb_2023_${FIPS}_tract_500k.shp" name=tracts \
  -filter-fields GEOID,NAMELSAD,NAMELSADCO,ALAND \
  -rename-fields name=NAMELSAD,county=NAMELSADCO,aland=ALAND \
  -simplify 35% keep-shapes weighted target=tracts \
  -o data/build/geo.json format=topojson quantization=100000 target=state,counties,tracts combine-layers
