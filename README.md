# Wisconsin Atlas

An interactive demographic atlas in the spirit of the old Statistical Atlas: choropleth
maps of Wisconsin from the state down to individual census tracts, with a profile of
any place you click.

**Tabs:** an Overview page (statewide headline figures, county highs and lows, and a
guide to the atlas), then 16 mapped topics: Age & Sex · Race & Ethnicity · Ancestry ·
Language · Place of Birth & citizenship · Marital Status · Households & Families ·
Household Income · Poverty · Education & school enrollment · Occupations · Industries ·
Commute · Housing · Health Insurance · Veterans.

**Data:** U.S. Census Bureau, American Community Survey 2019–2023 5-year estimates,
and Census cartographic boundary files (1:500k).

## Using it

Live site: https://dimitrik2025.github.io/Wisconsin-Atlas/


Open `docs/index.html` in a browser. It needs an internet connection the first time,
to load the D3 mapping library and fonts.

- Pick a topic, then a statistic.
- Click a county to zoom in and see its census tracts. Click a tract for its profile.
- **Counties / Tracts** switches the whole-state map between the two levels.
- **Table** lists every place on screen; click a column header to sort.
- Hover anything for exact numbers. ± values are 90% margins of error.
- Esc steps back up one level.

Map colors use 7 groups with equal numbers of places in each, so every color is used.
The sex-ratio map uses fixed breaks centered on 100 instead.

## Rebuilding the data

Requires Python 3 with pandas, Node.js, curl and unzip.

```bash
npm install
bash scripts/build.sh 55 Wisconsin
```

To build another state, pass its FIPS code and name, for example
`bash scripts/build.sh 26 Michigan`. This writes `docs/data/michigan.js`; point the
`<script src="data/...">` line in `docs/index.html` at it.

| Script | What it does |
|---|---|
| `scripts/download.sh` | Streams the national ACS table files and keeps one state's rows; downloads boundaries |
| `scripts/process_acs.py` | Computes shares, medians and distributions for every state, county and tract |
| `scripts/build_geo.sh` | Simplifies boundaries into compact TopoJSON |
| `scripts/bundle.py` | Combines both into one `docs/data/<state>.js` file |

### Adding or changing a statistic

Every map, chart and label is defined in the `TOPICS` list in `scripts/process_acs.py`.
Cell numbers refer to the Census table shells, which `scripts/download.sh` saves to
`data/raw/doc/ACS20235YR_Table_Shells.txt`. Add the table name to `TABLES` and to the
download list, add a metric or chart to a topic, and rebuild. The web page picks it up
automatically.

### Not included

**Fertility** (births in the past 12 months, tables B13016/B13002) is published for
tracts, but the estimates are too noisy to map: a typical Wisconsin tract has about 34
recent births with a margin of error 91% the size of the estimate, and in 45% of tracts
the margin is larger than the estimate itself.
