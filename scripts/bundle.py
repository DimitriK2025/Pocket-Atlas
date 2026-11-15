"""Combine geometry + stats into one JS file the web page loads with a <script> tag
(so the atlas works by just opening index.html, no server needed)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
name = sys.argv[1] if len(sys.argv) > 1 else "Wisconsin"
slug = name.lower().replace(" ", "-")
geo = json.loads((ROOT / "data/build/geo.json").read_text())
stats = json.loads((ROOT / "data/build/stats.json").read_text())
payload = {"name": name, "source": "ACS 5-year estimates, 2019-2023", "topo": geo, **stats}
out = ROOT / "docs" / "data" / f"{slug}.js"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("window.ATLAS_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")
print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size/1e6:.1f} MB)")
