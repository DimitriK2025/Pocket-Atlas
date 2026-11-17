# Midwest Atlas

An interactive demographic atlas in the spirit of the old Statistical Atlas: choropleth
maps of seven Midwestern states, from the whole region down to individual census tracts,
with a profile of any place you click.

**States:** Wisconsin, Illinois, Iowa, Minnesota, Michigan, Indiana and Ohio
(623 counties, 15,089 census tracts, 56 million people).

**Statistics:** 99, chosen from the **Data** menu and grouped into 16 topics: Age & Sex ·
Race & Ethnicity · Ancestry · Language · Place of Birth & citizenship · Marital Status ·
Households & Families · Household Income · Poverty · Education & school enrollment ·
Occupations · Industries · Commute · Housing · Health Insurance · Veterans.

**Data:** U.S. Census Bureau, American Community Survey 2019–2023 5-year estimates,
and Census cartographic boundary files (1:500k).

## Using it

Live site: https://dimitrik2025.github.io/Wisconsin-Atlas/
Open a state directly by adding its name, e.g. `#illinois` or `#ohio`.

You can also open `docs/index.html` straight from disk. It needs an internet connection
to load the D3 mapping library and fonts.

- Pick a statistic from the **Data** menu at the top right. The side panel shows every figure
  in that statistic's topic for the selected place; click a row to map it.
- The map opens on the whole Midwest. **States / Counties** switches how it is shaded.
- Click a state to open it, a county to see its census tracts, and a tract for its profile.
  **Tracts** shows every tract in the open state. A state's tracts download the first time
  you open them.
- The **×** button (or Esc) steps back up one level.
- **Table** lists every place on screen; click a column header to sort.
- Hover anything for exact numbers. ± values are 90% margins of error. Counties and tracts
  are compared with their own state.

Map colors use 7 groups with equal numbers of places in each, so every color is used.
Counties are grouped across the whole region, so colors mean the same thing in every state;
tracts are grouped within their state.
The sex-ratio map uses fixed breaks centered on 100 instead.

## Rebuilding the data

Requires Python 3 with pandas, Node.js, curl and unzip.

```bash
npm install
bash scripts/build.sh
```

The states come from `region.json`. To add one, add its FIPS code, name and postal
abbreviation there and run the build again.

| Script | What it does |
|---|---|
| `scripts/download.sh` | Streams each national ACS table once and splits out the requested states' rows; downloads boundaries |
| `scripts/process_acs.py` | Computes shares, medians and distributions for every state, county and tract |
| `scripts/build_geo.sh` | Simplifies one state's tract boundaries into compact TopoJSON |
| `scripts/build_region.sh` | State outlines and counties for the whole region |
| `scripts/bundle.py` | Writes `docs/data/region.js` (states, counties) and `docs/data/<state>.js` (tracts) |

After changing anything in `docs/`, run `python3 scripts/stamp.py` (the build does this
automatically). It adds a fresh version number to the page's file links so browsers load the
new files instead of cached copies.

### Adding or changing a statistic

Every map, chart and label is defined in the `TOPICS` list in `scripts/process_acs.py`.
Cell numbers refer to the Census table shells, which `scripts/download.sh` saves to
`data/raw/doc/ACS20235YR_Table_Shells.txt`. Add the table name to `TABLES` and to the
download list, add a metric or chart to a topic, and rebuild. The web page picks it up
automatically.

### Not included

**Fertility** (births in the past 12 months, tables B13016/B13002) is published for
tracts, but the estimates are too noisy to map: a typical tract has about 34
recent births with a margin of error 91% the size of the estimate, and in 45% of tracts
the margin is larger than the estimate itself.
