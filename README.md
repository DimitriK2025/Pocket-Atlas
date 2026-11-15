# Wisconsin Atlas

An interactive demographic atlas in the spirit of the old Statistical Atlas: choropleth
maps of Wisconsin from the state down to individual census tracts, with a profile of
any place you click.

**Topics:** population and density · race & ethnicity · age & sex · educational
attainment · household income, poverty and inequality (Gini index).

**Data:** U.S. Census Bureau, American Community Survey 2019–2023 5-year estimates,
and Census cartographic boundary files (1:500k).

## Using it

Open `web/index.html` in a browser. It needs an internet connection the first time,
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
`bash scripts/build.sh 26 Michigan`. This writes `web/data/michigan.js`; point the
`<script src="data/...">` line in `web/index.html` at it.

| Script | What it does |
|---|---|
| `scripts/download.sh` | Streams the national ACS table files and keeps one state's rows; downloads boundaries |
| `scripts/process_acs.py` | Computes shares, medians and distributions for every state, county and tract |
| `scripts/build_geo.sh` | Simplifies boundaries into compact TopoJSON |
| `scripts/bundle.py` | Combines both into one `web/data/<state>.js` file |

### ACS tables used

| Table | Contents |
|---|---|
| B01001 | Sex by age |
| B01002 | Median age |
| B03002 | Hispanic or Latino origin by race |
| B15003 | Educational attainment, 25+ |
| B17001 | Poverty status |
| B19001 | Household income brackets |
| B19013 | Median household income |
| B19083 | Gini index |
