#!/usr/bin/env bash
# ZIP code layer: assign each ZCTA to the state and county holding most of its land,
# compute its statistics, and split the boundaries into one TopoJSON file per state.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/build/zcta/geo
python3 - <<'PY'
import csv, json
states = {s["fips"] for s in json.load(open("region.json"))["states"]}
best = {}
with open("data/raw/tab20_zcta520_county20_natl.txt", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f, delimiter="|"):
        z = r["GEOID_ZCTA5_20"]
        if not z:
            continue
        land = int(r["AREALAND_PART"] or 0) + int(r["AREAWATER_PART"] or 0) / 1e6
        if z not in best or land > best[z][0]:
            best[z] = (land, r["GEOID_COUNTY_20"], r["NAMELSAD_COUNTY_20"])
with open("data/build/zcta/assign.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["zcta", "state", "county"])
    n = 0
    for z, (_, cty, name) in sorted(best.items()):
        if cty[:2] in states:
            w.writerow([z, cty[:2], name]); n += 1
print(f"assigned {n} ZCTAs to states")
PY
python3 scripts/process_acs.py zcta
npx mapshaper -i data/raw/shp/cb_2020_us_zcta520_500k.shp name=zips \
  -join data/build/zcta/assign.csv keys=ZCTA5CE20,zcta field-types=zcta:str,state:str \
  -filter "state != null" \
  -filter-fields ZCTA5CE20,state,county,ALAND20 -rename-fields zcta=ZCTA5CE20,aland=ALAND20 \
  -simplify 25% keep-shapes weighted \
  -split state \
  -o data/build/zcta/geo/ format=topojson quantization=100000 singles
