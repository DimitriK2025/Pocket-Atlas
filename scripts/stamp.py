"""Stamp docs/index.html with a fresh version so browsers fetch the new files after an update
(GitHub Pages lets browsers reuse cached copies for 10 minutes)."""
import re
import time
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "docs" / "index.html"
v = time.strftime("%Y%m%d%H%M%S", time.gmtime())
h = p.read_text()
h = re.sub(r'(href="style\.css|src="data/region\.js|src="app\.js)(\?v=\w+)?"', rf'\1?v={v}"', h)
h = re.sub(r'window\.ATLAS_VERSION = "\w*";', f'window.ATLAS_VERSION = "{v}";', h)
p.write_text(h)
print("stamped", v)
