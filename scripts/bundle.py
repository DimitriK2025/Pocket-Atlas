"""Combine one state's geometry + stats into docs/data/<state>.js, and refresh
docs/data/states.js, the list of states the web page offers.
Usage: python3 scripts/bundle.py <state FIPS> "<State Name>"
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fips = sys.argv[1] if len(sys.argv) > 1 else "55"
name = sys.argv[2] if len(sys.argv) > 2 else "Wisconsin"
slug = name.lower().replace(" ", "-")
build = ROOT / "data" / "build" / fips
geo = json.loads((build / "geo.json").read_text())
stats = json.loads((build / "stats.json").read_text())
payload = {"name": name, "slug": slug, "source": "ACS 5-year estimates, 2019-2023", "topo": geo, **stats}
out_dir = ROOT / "docs" / "data"
out_dir.mkdir(parents=True, exist_ok=True)
out = out_dir / f"{slug}.js"
out.write_text("window.ATLAS_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")
print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size/1e6:.1f} MB)")

# state list: every bundled state, alphabetical
reg_path = out_dir / "states.json"
reg = json.loads(reg_path.read_text()) if reg_path.exists() else {}
reg[slug] = name
reg = dict(sorted(reg.items(), key=lambda kv: kv[1]))
reg_path.write_text(json.dumps(reg, indent=1) + "\n")
(out_dir / "states.js").write_text(
    "window.ATLAS_STATES = " + json.dumps([{"id": k, "name": v} for k, v in reg.items()]) + ";\n")
print("states:", ", ".join(reg.values()))
