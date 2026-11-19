"""Package the region for the web page.

docs/data/region.js   state outlines + counties, and stats for every state and county,
                      plus the topic definitions (loaded first)
docs/data/<state>.js  one state's census tracts + their stats (loaded when the state is opened)
docs/data/zip/<state>.js  one state's ZIP Code Tabulation Areas + their stats (ids prefixed "Z")
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / "region.json").read_text())
out_dir = ROOT / "docs" / "data"
out_dir.mkdir(parents=True, exist_ok=True)
zip_dir = out_dir / "zip"
zip_dir.mkdir(exist_ok=True)
for old in list(out_dir.glob("*.js")) + list(zip_dir.glob("*.js")):  # clear earlier builds
    old.unlink()

# ZIP codes: statistics for every ZCTA, grouped by the state each one is assigned to
zips_by_state = {}
zbuild = ROOT / "data" / "build" / "zcta"
if (zbuild / "stats.json").exists():
    zstats = json.loads((zbuild / "stats.json").read_text())["geo"]
    with open(zbuild / "assign.csv") as f:
        for r in csv.DictReader(f):
            if r["zcta"] in zstats:
                zips_by_state.setdefault(r["state"], {})["Z" + r["zcta"]] = zstats[r["zcta"]]

geo, meta, states = {}, None, []
for s in cfg["states"]:
    fips, slug = s["fips"], s["name"].lower().replace(" ", "-")
    stats = json.loads((ROOT / "data/build" / fips / "stats.json").read_text())
    meta = stats["meta"]
    tract_stats = {k: v for k, v in stats["geo"].items() if len(k) == 11}  # compact records
    geo.update({k: v for k, v in stats["geo"].items() if len(k) < 11})
    topo = json.loads((ROOT / "data/build" / fips / "tracts.json").read_text())
    payload = {"fips": fips, "topo": topo, "geo": tract_stats}
    path = out_dir / f"{slug}.js"
    path.write_text("window.ATLAS_TRACTS = window.ATLAS_TRACTS || {};\nwindow.ATLAS_TRACTS[" + json.dumps(fips) + "] = "
                    + json.dumps(payload, separators=(",", ":")) + ";\n")
    zgeo = zbuild / "geo" / f"{fips}.json"
    nzips = 0
    if zgeo.exists():
        zpay = {"fips": fips, "topo": json.loads(zgeo.read_text()), "geo": zips_by_state.get(fips, {})}
        nzips = len(zpay["geo"])
        (zip_dir / f"{slug}.js").write_text("window.ATLAS_ZIPS = window.ATLAS_ZIPS || {};\nwindow.ATLAS_ZIPS[" + json.dumps(fips)
                                             + "] = " + json.dumps(zpay, separators=(",", ":")) + ";\n")
    states.append({**s, "id": slug, "tracts": len(tract_stats), "zips": nzips})
    print(f"{path.relative_to(ROOT)}: {len(tract_stats)} tracts, {nzips} ZIPs, {path.stat().st_size / 1e6:.1f} MB")

region = {"name": cfg["name"], "source": "ACS 5-year estimates, 2019-2023", "states": states, "meta": meta,
          "topo": json.loads((ROOT / "data/build/region/geo.json").read_text()), "geo": geo}
path = out_dir / "region.js"
path.write_text("window.ATLAS_REGION = " + json.dumps(region, separators=(",", ":")) + ";\n")
print(f"{path.relative_to(ROOT)}: {len(geo)} states and counties, {path.stat().st_size / 1e6:.1f} MB")
