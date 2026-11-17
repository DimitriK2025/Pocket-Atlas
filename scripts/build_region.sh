#!/usr/bin/env bash
# State outlines and counties for every state in region.json -> data/build/region/geo.json
set -euo pipefail
cd "$(dirname "$0")/.."
SHP=data/raw/shp
LIST=$(python3 -c "import json; print(','.join(repr(s['fips']) for s in json.load(open('region.json'))['states']))")
mkdir -p data/build/region
npx mapshaper \
  -i "$SHP/cb_2023_us_state_500k.shp" name=states \
  -filter "[$LIST].indexOf(STATEFP) > -1" -filter-fields GEOID,NAME \
  -i "$SHP/cb_2023_us_county_500k.shp" name=counties \
  -filter "[$LIST].indexOf(STATEFP) > -1" -filter-fields GEOID,NAMELSAD,ALAND \
  -rename-fields name=NAMELSAD,aland=ALAND \
  -simplify 15% keep-shapes weighted target=counties \
  -o data/build/region/geo.json format=topojson quantization=100000 target=states,counties combine-layers
