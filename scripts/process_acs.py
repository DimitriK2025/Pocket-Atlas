"""Turn raw ACS 5-year table files into compact per-geography stats for the atlas.

Input:  data/raw/<table>.dat  (pipe-delimited Census table-based summary files,
        already filtered to one state's state/county/tract rows)
Output: data/build/stats.json  {geoid: {...}}
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "build"
TABLES = ["b01001", "b01002", "b03002", "b15003", "b17001", "b19001", "b19013", "b19083"]


def load():
    frames = []
    for t in TABLES:
        df = pd.read_csv(RAW / f"{t}.dat", sep="|", dtype={"GEO_ID": str}, low_memory=False)
        frames.append(df.set_index("GEO_ID"))
    df = pd.concat(frames, axis=1)
    df = df.apply(pd.to_numeric, errors="coerce")
    # Census uses large negative "jam values" (e.g. -666666666) for unavailable estimates
    return df.mask(df < 0)


def short_geoid(g):
    # "1400000US55025000100" -> "55025000100"
    return g.split("US", 1)[1]


def col(table, n):
    return f"{table.upper()}_E{n:03d}"


def s(row, table, nums):
    return float(sum(row[col(table, n)] for n in nums))


def r(x, nd=1):
    if x is None or pd.isna(x):
        return None
    return round(float(x), nd)


def share(part, total):
    return None if not total else 100.0 * part / total


# Age bins built from the irregular ACS sex-by-age cells (male cells 3-25; female = +24)
AGE_BINS = [
    ("0-4", [3]), ("5-9", [4]), ("10-14", [5]), ("15-19", [6, 7]), ("20-24", [8, 9, 10]),
    ("25-29", [11]), ("30-34", [12]), ("35-39", [13]), ("40-44", [14]), ("45-49", [15]),
    ("50-54", [16]), ("55-59", [17]), ("60-64", [18, 19]), ("65-69", [20, 21]),
    ("70-74", [22]), ("75-79", [23]), ("80-84", [24]), ("85+", [25]),
]
RACE = [  # B03002 Hispanic or Latino origin by race
    ("White", [3]), ("Black", [4]), ("Hispanic", [12]), ("Asian", [6]),
    ("Native American", [5]), ("Multiracial / Other", [7, 8, 9]),
]
EDU = [  # B15003 educational attainment, population 25+
    ("No HS diploma", list(range(2, 17))), ("HS / GED", [17, 18]),
    ("Some college / Associate", [19, 20, 21]), ("Bachelor's", [22]),
    ("Graduate / Professional", [23, 24, 25]),
]
INCOME_BINS = ["<10k", "10-15k", "15-20k", "20-25k", "25-30k", "30-35k", "35-40k", "40-45k",
               "45-50k", "50-60k", "60-75k", "75-100k", "100-125k", "125-150k", "150-200k", "200k+"]


def build(df):
    out = {}
    for geo, row in df.iterrows():
        pop = row[col("b01001", 1)]
        if pd.isna(pop):
            continue
        pop = float(pop)
        male, female = row[col("b01001", 2)], row[col("b01001", 26)]
        ages_m = [s(row, "b01001", nums) for _, nums in AGE_BINS]
        ages_f = [s(row, "b01001", [n + 24 for n in nums]) for _, nums in AGE_BINS]
        under18 = s(row, "b01001", [3, 4, 5, 6, 27, 28, 29, 30])
        over65 = s(row, "b01001", list(range(20, 26)) + list(range(44, 50)))

        race_tot = row[col("b03002", 1)]
        race = [s(row, "b03002", nums) for _, nums in RACE]
        race_sh = [share(x, race_tot) for x in race]
        diversity = None
        if race_tot:
            diversity = 100.0 * (1 - sum((x / race_tot) ** 2 for x in race))
        predominant = None
        if race_tot:
            predominant = max(range(len(race)), key=lambda i: race[i])

        edu_tot = row[col("b15003", 1)]
        edu = [s(row, "b15003", nums) for _, nums in EDU]
        hs_plus = share(edu_tot - edu[0], edu_tot) if edu_tot else None
        ba_plus = share(edu[3] + edu[4], edu_tot)
        grad = share(edu[4], edu_tot)

        inc = [float(row[col("b19001", n)]) for n in range(2, 18)]
        pov = share(row[col("b17001", 2)], row[col("b17001", 1)])

        out[short_geoid(geo)] = {
            "pop": int(pop),
            # map metrics
            "m": {
                "pct_white": r(race_sh[0]), "pct_black": r(race_sh[1]), "pct_hispanic": r(race_sh[2]),
                "pct_asian": r(race_sh[3]), "pct_native": r(race_sh[4]), "pct_multi": r(race_sh[5]),
                "diversity": r(diversity), "predominant": predominant,
                "median_age": r(row[col("b01002", 1)]),
                "pct_under18": r(share(under18, pop)), "pct_65plus": r(share(over65, pop)),
                "sex_ratio": r(100.0 * male / female if female else None),
                "pct_hs_plus": r(hs_plus), "pct_ba_plus": r(ba_plus), "pct_grad": r(grad),
                "median_income": r(row[col("b19013", 1)], 0), "poverty": r(pov),
                "gini": r(row[col("b19083", 1)], 3),
            },
            # margins of error (90%) for the headline medians
            "moe": {
                "median_age": r(row["B01002_M001"]),
                "median_income": r(row["B19013_M001"], 0),
                "gini": r(row["B19083_M001"], 3),
            },
            # distributions for the profile charts (counts)
            "d": {
                "age_m": [int(x) for x in ages_m], "age_f": [int(x) for x in ages_f],
                "race": [int(x) for x in race], "edu": [int(x) for x in edu],
                "income": [int(x) for x in inc],
            },
        }
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stats = build(load())
    meta = {
        "age_bins": [b for b, _ in AGE_BINS], "race": [b for b, _ in RACE],
        "edu": [b for b, _ in EDU], "income_bins": INCOME_BINS,
    }
    (OUT / "stats.json").write_text(json.dumps({"meta": meta, "geo": stats}, separators=(",", ":")))
    print(f"wrote {len(stats)} geographies", file=sys.stderr)


if __name__ == "__main__":
    main()
