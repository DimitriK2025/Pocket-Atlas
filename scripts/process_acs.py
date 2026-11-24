"""Turn raw ACS 5-year table files into compact per-geography stats for the atlas.

Usage:  python3 scripts/process_acs.py <state FIPS>
Input:  data/raw/<FIPS>/<table>.dat  (pipe-delimited Census table-based summary files,
        already filtered to one state's state/county/tract rows)
Output: data/build/<FIPS>/stats.json  {"meta": {...topic definitions...}, "geo": {geoid: [compact record]}}

Everything the web page shows is defined in TOPICS below. Each topic has
  metrics: one number per place, mappable (id, label, unit, fmt, f=formula, moe=formula)
  charts:  a distribution for the profile panel
           kind "share"  -> bar per category, shown as % of the total (t) or of the sum
           kind "hist"   -> ordered columns, shown as % of the sum
           kind "values" -> bar per category, values already in final units (fmt)
           kind "pyramid"-> male counts then female counts per age group
Cell numbers refer to the Census table shells (data/raw/doc/ACS20235YR_Table_Shells.txt).
"""
import json
import math
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "build"

TABLES = [
    "b01001", "b01002", "b03002", "b04006", "b05002", "b08013", "b08301", "b08303", "b11001",
    "b11016", "b12001", "b14001", "b15003", "b17001", "b19001", "b19013", "b19083",
    "b21001", "b25002", "b25003", "b25004", "b25010", "b25034",
    "b25035", "b25044", "b25064", "b25070", "b25075", "b25077", "b27010", "c16001", "c17002",
    "c24010", "c24030",
]


class G:
    """Accessor for one geography's row: g("b01001", 3) -> estimate, g.s("b01001", [3, 4]) -> sum."""

    def __init__(self, row):
        self.row = row

    def __call__(self, t, n):
        v = self.row.get(f"{t.upper()}_E{n:03d}")
        return None if v is None or pd.isna(v) else float(v)

    def m(self, t, n):
        v = self.row.get(f"{t.upper()}_M{n:03d}")
        return None if v is None or pd.isna(v) else float(v)

    def s(self, t, nums):
        vals = [self(t, n) for n in nums]
        return None if any(v is None for v in vals) else sum(vals)


def P(num, den):
    if num is None or not den:
        return None
    return 100.0 * num / den


def rng(a, b):
    return list(range(a, b + 1))


def both(nums, offset):
    """Cells for men plus the matching cells for women (tables split by sex)."""
    return list(nums) + [n + offset for n in nums]


# ---------------------------------------------------------------- age & sex
AGE_BINS = [
    ("0-4", [3]), ("5-9", [4]), ("10-14", [5]), ("15-19", [6, 7]), ("20-24", [8, 9, 10]),
    ("25-29", [11]), ("30-34", [12]), ("35-39", [13]), ("40-44", [14]), ("45-49", [15]),
    ("50-54", [16]), ("55-59", [17]), ("60-64", [18, 19]), ("65-69", [20, 21]),
    ("70-74", [22]), ("75-79", [23]), ("80-84", [24]), ("85+", [25]),
]
RACE = [("White", [3]), ("Black", [4]), ("Hispanic", [12]), ("Asian", [6]),
        ("Native American", [5]), ("Multiracial / Other", [7, 8, 9])]


def race_counts(g):
    return [g.s("b03002", n) for _, n in RACE]


def predominant(g):
    c = race_counts(g)
    if any(v is None for v in c) or not sum(c):
        return None
    return max(range(len(c)), key=lambda i: c[i])


def diversity(g):
    c = race_counts(g)
    if any(v is None for v in c) or not sum(c):
        return None
    t = sum(c)
    return 100.0 * (1 - sum((v / t) ** 2 for v in c))


def pop(g):
    return g("b01001", 1)


# ---------------------------------------------------------------- ancestry (B04006)
ANCESTRY = [
    ("German", [42]), ("Irish", [49]), ("Norwegian", [59]), ("Polish", [61]), ("English", [36]),
    ("Italian", [51]), ("French / French Canadian", [40, 41]), ("Swedish", [89]), ("Dutch", [34]),
    ("American", [5]), ("Czech", [31, 32]), ("Danish", [33]), ("Scottish", [67]), ("Belgian", [21]),
    ("Finnish", [39]), ("Sub-Saharan African", [73]), ("Arab", [6]),
]

# ---------------------------------------------------------------- language (C16001)
LANGS = [  # (label, total cell, limited-English cell)
    ("Spanish", 3, 5), ("German / West Germanic", 9, 11), ("Russian, Polish / Slavic", 12, 14),
    ("French, Haitian, Cajun", 6, 8), ("Other Indo-European", 15, 17), ("Chinese", 21, 23),
    ("Korean", 18, 20), ("Vietnamese", 24, 26), ("Tagalog", 27, 29),
    ("Other Asian & Pacific Island (incl. Hmong)", 30, 32), ("Arabic", 33, 35), ("Other", 36, 38),
]
LIMITED = [c for _, _, c in LANGS]

# ---------------------------------------------------------------- occupations / industries
OCC_MAJOR = {"mgmt": 3, "service": 19, "sales": 27, "nrcm": 30, "prod": 34}
OCC = [
    ("Management", [5]), ("Business & finance", [6]), ("Computer & math", [8]),
    ("Architecture & engineering", [9]), ("Life, physical & social science", [10]),
    ("Community & social service", [12]), ("Legal", [13]), ("Education & library", [14]),
    ("Arts, design & media", [15]), ("Healthcare practitioners", [16]), ("Healthcare support", [20]),
    ("Protective service", [21]), ("Food preparation & serving", [24]),
    ("Cleaning & grounds maintenance", [25]), ("Personal care", [26]), ("Sales", [28]),
    ("Office & administrative", [29]), ("Farming, fishing & forestry", [31]),
    ("Construction & extraction", [32]), ("Installation & repair", [33]), ("Production", [35]),
    ("Transportation", [36]), ("Material moving", [37]),
]
IND = [
    ("Agriculture, forestry & mining", [3]), ("Construction", [6]), ("Manufacturing", [7]),
    ("Wholesale trade", [8]), ("Retail trade", [9]), ("Transportation & utilities", [10]),
    ("Information", [13]), ("Finance, insurance & real estate", [14]),
    ("Professional & administrative services", [17]), ("Educational services", [22]),
    ("Health care & social assistance", [23]), ("Arts, recreation, lodging & food", [24]),
    ("Other services", [27]), ("Public administration", [28]),
]


def occ(g, nums):
    return g.s("c24010", both(nums, 36))


def ind(g, nums):
    return g.s("c24030", both(nums, 27))


# ---------------------------------------------------------------- poverty by age (B17001)
POV_CHILD = [4, 5, 6, 7, 8, 9]
POV_ADULT = [10, 11, 12, 13, 14]
POV_SENIOR = [15, 16]


def pov_rate(g, cells):
    below = g.s("b17001", both(cells, 14))
    above = g.s("b17001", [c + 29 for c in both(cells, 14)])
    return P(below, (below or 0) + (above or 0)) if below is not None and above is not None else None


# ---------------------------------------------------------------- health insurance (B27010)
INS = [
    ("Employer-based only", [4, 20, 36, 53]), ("Direct-purchase only", [5, 21, 37, 54]),
    ("Medicare only", [6, 22, 38, 55]), ("Medicaid / means-tested only", [7, 23, 39]),
    ("Military / VA only", [8, 9, 24, 25, 40, 41, 56, 57]), ("Two or more types", [10, 26, 42, 58]),
    ("No health insurance", [17, 33, 50, 66]),
]
INS_AGES = [("Under 19", 17, 2), ("19-34", 33, 18), ("35-64", 50, 34), ("65+", 66, 51)]

def mean_vehicles(g):
    t = g("b25044", 1)
    if not t:
        return None
    s = sum(k * ((g("b25044", 3 + k) or 0) + (g("b25044", 10 + k) or 0)) for k in range(6))
    return s / t


def mean_commute(g):
    a, w = g("b08013", 1), g("b08303", 1)
    return a / w if a is not None and w else None


def ratio(a, b):
    return a / b if a is not None and b else None


# Metric helper: M(id, label, unit, fmt, f, moe=None, **extra)
def M(id, label, unit, fmt, f, moe=None, **extra):
    return dict(id=id, label=label, unit=unit, fmt=fmt, f=f, moe=moe, **extra)


def C(id, title, kind, labels, f, sub="", fmt="pct", t=None):
    return dict(id=id, title=title, kind=kind, labels=labels, f=f, sub=sub, fmt=fmt, t=t)


TOPICS = [
    dict(id="age", label="Age & Sex", metrics=[
        M("median_age", "Median age", "years", "dec1", lambda g: g("b01002", 1), lambda g: g.m("b01002", 1)),
        M("density", "Population density", "people per square mile of land", "dens", None),
        M("pop", "Total population", "residents", "int", pop),
        M("pct_under18", "Under 18", "% of residents", "pct",
          lambda g: P(g.s("b01001", [3, 4, 5, 6, 27, 28, 29, 30]), pop(g))),
        M("pct_65plus", "65 and older", "% of residents", "pct",
          lambda g: P(g.s("b01001", rng(20, 25) + rng(44, 49)), pop(g))),
        M("sex_ratio", "Sex ratio", "men per 100 women", "dec1",
          lambda g: 100 * ratio(g("b01001", 2), g("b01001", 26)) if ratio(g("b01001", 2), g("b01001", 26)) else None,
          type="div", thresholds=[85, 93, 98, 102, 107, 115]),
        # B01001 cells: men 20, 21, 22-24, 25-29 = 8-11; women = +24
        M("sex_ratio_2029", "Sex ratio 20-29", "men per 100 women, ages 20-29", "dec1",
          lambda g: P(g.s("b01001", [8, 9, 10, 11]), g.s("b01001", [32, 33, 34, 35])),
          type="div", thresholds=[85, 93, 98, 102, 107, 115]),
    ], charts=[
        C("pyramid", "Age & sex", "pyramid", [b for b, _ in AGE_BINS],
          lambda g: [g.s("b01001", n) for _, n in AGE_BINS] + [g.s("b01001", [x + 24 for x in n]) for _, n in AGE_BINS],
          sub="share of residents"),
    ]),
    dict(id="race", label="Race & Ethnicity", metrics=[
        M("predominant", "Largest group", "largest racial or ethnic group", "cat", predominant, type="cat"),
        M("pct_white", "White", "% non-Hispanic White", "pct", lambda g: P(g("b03002", 3), g("b03002", 1))),
        M("pct_black", "Black", "% non-Hispanic Black", "pct", lambda g: P(g("b03002", 4), g("b03002", 1))),
        M("pct_hispanic", "Hispanic", "% Hispanic or Latino, any race", "pct", lambda g: P(g("b03002", 12), g("b03002", 1))),
        M("pct_asian", "Asian", "% non-Hispanic Asian", "pct", lambda g: P(g("b03002", 6), g("b03002", 1))),
        M("pct_native", "Native American", "% non-Hispanic American Indian / Alaska Native", "pct",
          lambda g: P(g("b03002", 5), g("b03002", 1))),
        M("pct_multi", "Multiracial / Other", "% two or more races, Pacific Islander or other", "pct",
          lambda g: P(g.s("b03002", [7, 8, 9]), g("b03002", 1))),
        M("diversity", "Diversity index", "% chance two random residents are of different groups", "pct", diversity),
    ], charts=[
        C("race", "Race & ethnicity", "share", [l for l, _ in RACE], race_counts,
          sub="groups other than Hispanic are non-Hispanic"),
    ]),
    dict(id="ancestry", label="Ancestry", metrics=[
        M("anc_" + l.split()[0].lower().strip(",/"), l, "% of residents reporting this ancestry", "pct",
          (lambda nums: lambda g: P(g.s("b04006", nums), pop(g)))(n))
        for l, n in ANCESTRY[:12]
    ], charts=[
        C("ancestry", "Reported ancestry", "share", [l for l, _ in ANCESTRY],
          lambda g: [g.s("b04006", n) for _, n in ANCESTRY], t=pop,
          sub="% of residents; people may report two ancestries"),
    ]),
    dict(id="language", label="Language", metrics=[
        M("pct_english_only", "English only", "% of residents 5+ who speak only English at home", "pct",
          lambda g: P(g("c16001", 2), g("c16001", 1))),
        M("pct_other_lang", "Other language at home", "% of residents 5+", "pct",
          lambda g: P((g("c16001", 1) or 0) - (g("c16001", 2) or 0), g("c16001", 1))),
        M("pct_limited_english", "Limited English", "% of residents 5+ who speak English less than “very well”", "pct",
          lambda g: P(g.s("c16001", LIMITED), g("c16001", 1))),
        M("pct_spanish", "Spanish", "% of residents 5+ who speak Spanish at home", "pct",
          lambda g: P(g("c16001", 3), g("c16001", 1))),
        M("pct_west_germanic", "German / West Germanic", "% of residents 5+ (incl. Pennsylvania Dutch)", "pct",
          lambda g: P(g("c16001", 9), g("c16001", 1))),
        M("pct_other_asian", "Other Asian & Pacific Island", "% of residents 5+ (incl. Hmong)", "pct",
          lambda g: P(g("c16001", 30), g("c16001", 1))),
    ], charts=[
        C("languages", "Languages other than English", "share", [l for l, _, _ in LANGS],
          lambda g: [g("c16001", c) for _, c, _ in LANGS], t=lambda g: g("c16001", 1), sub="% of residents 5+"),
    ]),
    dict(id="birth", label="Place of Birth", metrics=[
        M("pct_born_state", "Born in this state", "% of residents", "pct", lambda g: P(g("b05002", 3), g("b05002", 1))),
        M("pct_born_other_state", "Born in another state", "% of residents", "pct", lambda g: P(g("b05002", 4), g("b05002", 1))),
        M("pct_foreign_born", "Foreign-born", "% of residents born abroad to non-US parents", "pct",
          lambda g: P(g("b05002", 13), g("b05002", 1))),
        M("pct_noncitizen", "Not a US citizen", "% of residents", "pct", lambda g: P(g("b05002", 21), g("b05002", 1))),
        M("pct_naturalized", "Naturalized citizens", "% of foreign-born residents who are naturalized", "pct",
          lambda g: P(g("b05002", 14), g("b05002", 13))),
    ], charts=[
        C("nativity", "Birthplace & citizenship", "share",
          ["Born in this state", "Born in another state", "Born in PR, territories or abroad to US parents",
           "Naturalized citizen", "Not a citizen"],
          lambda g: [g("b05002", 3), g("b05002", 4), g("b05002", 9), g("b05002", 14), g("b05002", 21)]),
        C("fb_region", "Foreign-born by region of birth", "share",
          ["Europe", "Asia", "Africa", "Oceania", "Latin America", "Canada & N. America"],
          lambda g: [g.s("b05002", [15 + i, 22 + i]) for i in range(6)], sub="% of foreign-born"),
    ]),
    dict(id="marital", label="Marital Status", metrics=[
        M("pct_married", "Married", "% of residents 15+ (excl. separated)", "pct",
          lambda g: P(g.s("b12001", [4, 13]) - g.s("b12001", [7, 16]), g("b12001", 1)) if g("b12001", 1) else None),
        M("pct_never_married", "Never married", "% of residents 15+", "pct", lambda g: P(g.s("b12001", [3, 12]), g("b12001", 1))),
        M("pct_divorced", "Divorced", "% of residents 15+", "pct", lambda g: P(g.s("b12001", [10, 19]), g("b12001", 1))),
        M("pct_widowed", "Widowed", "% of residents 15+", "pct", lambda g: P(g.s("b12001", [9, 18]), g("b12001", 1))),
    ], charts=[
        C("marital", "Marital status", "share", ["Never married", "Married", "Separated", "Widowed", "Divorced"],
          lambda g: [g.s("b12001", [3, 12]), g.s("b12001", [4, 13]) - g.s("b12001", [7, 16]) if g("b12001", 1) is not None else None,
                     g.s("b12001", [7, 16]), g.s("b12001", [9, 18]), g.s("b12001", [10, 19])], sub="residents 15+"),
    ]),
    dict(id="households", label="Households & Families", metrics=[
        M("avg_hh_size", "Average household size", "people per household", "dec2",
          lambda g: g("b25010", 1), lambda g: g.m("b25010", 1)),
        M("pct_married_couple", "Married-couple households", "% of households", "pct", lambda g: P(g("b11001", 3), g("b11001", 1))),
        M("pct_living_alone", "Living alone", "% of households with one person", "pct", lambda g: P(g("b11001", 8), g("b11001", 1))),
        M("pct_single_mother", "Female householder, no spouse", "% of households (family, no spouse present)", "pct",
          lambda g: P(g("b11001", 6), g("b11001", 1))),
        M("pct_family", "Family households", "% of households", "pct", lambda g: P(g("b11001", 2), g("b11001", 1))),
    ], charts=[
        C("hh_type", "Household type", "share",
          ["Married couple", "Male householder, no spouse", "Female householder, no spouse", "Living alone",
           "Roommates / other non-family"],
          lambda g: [g("b11001", n) for n in (3, 5, 6, 8, 9)]),
        C("hh_size", "Household size", "hist", ["1", "2", "3", "4", "5", "6", "7+"],
          lambda g: [g("b11016", 10)] + [g.s("b11016", [n, n + 8]) for n in range(3, 9)], sub="people per household"),
    ]),
    dict(id="hhincome", label="Household Income", metrics=[
        M("median_income", "Median household income", "dollars, 2023-adjusted", "money",
          lambda g: g("b19013", 1), lambda g: g.m("b19013", 1)),
        M("gini", "Gini index", "income inequality, 0 = equal, 1 = one household has all", "dec3",
          lambda g: g("b19083", 1), lambda g: g.m("b19083", 1)),
        M("pct_hh_100k", "Households earning $100k+", "% of households", "pct",
          lambda g: P(g.s("b19001", rng(14, 17)), g("b19001", 1))),
        M("pct_hh_under25k", "Households under $25k", "% of households", "pct",
          lambda g: P(g.s("b19001", rng(2, 5)), g("b19001", 1))),
    ], charts=[
        C("income", "Household income", "hist",
          ["<10k", "10-15k", "15-20k", "20-25k", "25-30k", "30-35k", "35-40k", "40-45k", "45-50k", "50-60k",
           "60-75k", "75-100k", "100-125k", "125-150k", "150-200k", "200k+"],
          lambda g: [g("b19001", n) for n in range(2, 18)], sub="share of households"),
    ]),
    dict(id="poverty", label="Poverty", metrics=[
        M("poverty", "Poverty rate", "% of residents below the poverty line", "pct", lambda g: P(g("b17001", 2), g("b17001", 1))),
        M("child_poverty", "Child poverty", "% of children under 18 below the poverty line", "pct",
          lambda g: pov_rate(g, POV_CHILD)),
        M("senior_poverty", "Poverty, 65+", "% of residents 65+ below the poverty line", "pct",
          lambda g: pov_rate(g, POV_SENIOR)),
        M("deep_poverty", "Deep poverty", "% of residents below half the poverty line", "pct",
          lambda g: P(g("c17002", 2), g("c17002", 1))),
        M("low_income", "Low income", "% of residents below twice the poverty line", "pct",
          lambda g: P(g.s("c17002", rng(2, 7)), g("c17002", 1))),
    ], charts=[
        C("pov_ratio", "Income relative to poverty line", "hist",
          ["<50%", "50-99%", "100-124%", "125-149%", "150-184%", "185-199%", "200%+"],
          lambda g: [g("c17002", n) for n in range(2, 9)], sub="share of residents"),
        C("pov_age", "Poverty rate by age", "values", ["Under 18", "18-64", "65+"],
          lambda g: [pov_rate(g, POV_CHILD), pov_rate(g, POV_ADULT), pov_rate(g, POV_SENIOR)]),
    ]),
    dict(id="edu", label="Education", metrics=[
        M("pct_ba_plus", "Bachelor's or higher", "% of adults 25+", "pct", lambda g: P(g.s("b15003", rng(22, 25)), g("b15003", 1))),
        M("pct_hs_plus", "High school or higher", "% of adults 25+", "pct",
          lambda g: P(g("b15003", 1) - g.s("b15003", rng(2, 16)), g("b15003", 1)) if g("b15003", 1) else None),
        M("pct_grad", "Graduate degree", "% of adults 25+", "pct", lambda g: P(g.s("b15003", [23, 24, 25]), g("b15003", 1))),
        M("pct_college_students", "College & graduate students", "% of residents 3+ enrolled in college or grad school", "pct",
          lambda g: P(g.s("b14001", [8, 9]), g("b14001", 1))),
        M("pct_enrolled", "Enrolled in school", "% of residents 3+", "pct", lambda g: P(g("b14001", 2), g("b14001", 1))),
    ], charts=[
        C("edu", "Educational attainment", "share",
          ["No HS diploma", "HS / GED", "Some college / Associate", "Bachelor's", "Graduate / Professional"],
          lambda g: [g.s("b15003", rng(2, 16)), g.s("b15003", [17, 18]), g.s("b15003", [19, 20, 21]),
                     g("b15003", 22), g.s("b15003", [23, 24, 25])], sub="adults 25+"),
        C("enroll", "School enrollment", "share",
          ["Preschool", "Kindergarten", "Grades 1-4", "Grades 5-8", "Grades 9-12", "College, undergraduate", "Graduate / professional"],
          lambda g: [g("b14001", n) for n in range(3, 10)], sub="% of students"),
    ]),
    dict(id="occupations", label="Occupations", metrics=[
        M("occ_" + k, l, "% of employed residents", "pct", (lambda c: lambda g: P(occ(g, [c]), g("c24010", 1)))(OCC_MAJOR[k]))
        for k, l in [("mgmt", "Management, business, science & arts"), ("service", "Service"),
                     ("sales", "Sales & office"), ("nrcm", "Construction, farming & maintenance"),
                     ("prod", "Production & transportation")]
    ], charts=[
        C("occ", "Occupations", "share", [l for l, _ in OCC], lambda g: [occ(g, n) for _, n in OCC],
          t=lambda g: g("c24010", 1), sub="% of employed residents"),
    ]),
    dict(id="industries", label="Industries", metrics=[
        M("ind_" + key, IND[i][0], "% of employed residents", "pct", (lambda n: lambda g: P(ind(g, n), g("c24030", 1)))(IND[i][1]))
        for key, i in [("manufacturing", 2), ("health", 10), ("education", 9), ("retail", 4), ("agriculture", 0),
                       ("construction", 1), ("professional", 8), ("leisure", 11), ("finance", 7), ("public", 13)]
    ], charts=[
        C("ind", "Industries", "share", [l for l, _ in IND], lambda g: [ind(g, n) for _, n in IND],
          t=lambda g: g("c24030", 1), sub="% of employed residents"),
    ]),
    dict(id="commute", label="Commute", metrics=[
        M("mean_commute", "Average commute", "minutes, one way", "min", mean_commute),
        M("pct_drive_alone", "Drive alone", "% of workers 16+", "pct", lambda g: P(g("b08301", 3), g("b08301", 1))),
        M("pct_carpool", "Carpool", "% of workers 16+", "pct", lambda g: P(g("b08301", 4), g("b08301", 1))),
        M("pct_transit", "Public transit", "% of workers 16+", "pct", lambda g: P(g("b08301", 10), g("b08301", 1))),
        M("pct_walk_bike", "Walk or bike", "% of workers 16+", "pct", lambda g: P(g.s("b08301", [18, 19]), g("b08301", 1))),
        M("pct_wfh", "Work from home", "% of workers 16+", "pct", lambda g: P(g("b08301", 21), g("b08301", 1))),
        M("pct_long_commute", "Commute 45+ minutes", "% of commuters", "pct",
          lambda g: P(g.s("b08303", [11, 12, 13]), g("b08303", 1))),
        M("pct_no_vehicle", "No vehicle", "% of households without a vehicle", "pct",
          lambda g: P(g.s("b25044", [3, 10]), g("b25044", 1))),
        M("avg_vehicles", "Vehicles per household", "average (5+ counted as 5)", "dec2", mean_vehicles),
    ], charts=[
        C("mode", "How people get to work", "share",
          ["Drove alone", "Carpooled", "Public transit", "Walked", "Bicycle", "Taxi, motorcycle, other", "Worked from home"],
          lambda g: [g("b08301", 3), g("b08301", 4), g("b08301", 10), g("b08301", 19), g("b08301", 18),
                     g.s("b08301", [16, 17, 20]), g("b08301", 21)], sub="workers 16+"),
        C("travel", "Travel time to work", "hist",
          ["<5", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-59", "60-89", "90+"],
          lambda g: [g("b08303", n) for n in range(2, 14)], sub="minutes, share of commuters"),
        C("vehicles", "Vehicles available", "hist", ["0", "1", "2", "3", "4", "5+"],
          lambda g: [g.s("b25044", [3 + k, 10 + k]) for k in range(6)], sub="share of households"),
    ]),
    dict(id="housing", label="Housing", metrics=[
        M("median_value", "Median home value", "dollars, owner-occupied homes", "money",
          lambda g: g("b25077", 1), lambda g: g.m("b25077", 1)),
        M("median_rent", "Median gross rent", "dollars per month", "money", lambda g: g("b25064", 1), lambda g: g.m("b25064", 1)),
        M("pct_owner", "Homeownership", "% of occupied homes that are owner-occupied", "pct",
          lambda g: P(g("b25003", 2), g("b25003", 1))),
        M("rent_burden", "Rent-burdened", "% of renters paying 30%+ of income on rent", "pct",
          lambda g: P(g.s("b25070", rng(7, 10)), (g("b25070", 1) or 0) - (g("b25070", 11) or 0))),
        M("median_year_built", "Median year built", "year", "year", lambda g: g("b25035", 1)),
        M("vacancy", "Vacancy rate", "% of housing units vacant", "pct", lambda g: P(g("b25002", 3), g("b25002", 1))),
        M("pct_seasonal", "Seasonal & vacation homes", "% of housing units", "pct", lambda g: P(g("b25004", 6), g("b25002", 1))),
    ], charts=[
        C("occupancy", "Housing units", "share",
          ["Owner-occupied", "Renter-occupied", "Vacant: for rent or sale", "Vacant: seasonal / vacation", "Vacant: other"],
          lambda g: [g("b25003", 2), g("b25003", 3), g.s("b25004", [2, 3, 4, 5]), g("b25004", 6), g.s("b25004", [7, 8])]),
        C("value", "Home values", "hist",
          ["<50k", "50-99k", "100-149k", "150-199k", "200-249k", "250-299k", "300-399k", "400-499k", "500-749k", "750k+"],
          lambda g: [g.s("b25075", rng(2, 9)), g.s("b25075", rng(10, 14)), g.s("b25075", [15, 16]), g.s("b25075", [17, 18]),
                     g("b25075", 19), g("b25075", 20), g("b25075", 21), g("b25075", 22), g("b25075", 23),
                     g.s("b25075", rng(24, 27))], sub="share of owner-occupied homes"),
        C("built", "Year built", "hist",
          ["<1940", "1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020+"],
          lambda g: [g("b25034", n) for n in range(11, 1, -1)], sub="share of housing units"),
    ]),
    dict(id="insurance", label="Health Insurance", metrics=[
        M("uninsured", "Uninsured", "% of residents without health insurance", "pct",
          lambda g: P(g.s("b27010", [17, 33, 50, 66]), g("b27010", 1))),
        M("uninsured_adults", "Uninsured, ages 19-64", "% of residents 19-64", "pct",
          lambda g: P(g.s("b27010", [33, 50]), g.s("b27010", [18, 34]))),
        M("ins_employer_only", "Employer-based only", "% of residents", "pct", lambda g: P(g.s("b27010", INS[0][1]), g("b27010", 1))),
        M("ins_medicaid_only", "Medicaid only", "% of residents", "pct", lambda g: P(g.s("b27010", INS[3][1]), g("b27010", 1))),
        M("ins_two_plus", "Two or more types", "% of residents", "pct", lambda g: P(g.s("b27010", INS[5][1]), g("b27010", 1))),
    ], charts=[
        C("ins", "Health insurance coverage", "share", [l for l, _ in INS], lambda g: [g.s("b27010", n) for _, n in INS],
          sub="civilian residents outside institutions"),
        C("ins_age", "Uninsured by age", "values", [l for l, _, _ in INS_AGES],
          lambda g: [P(g("b27010", n), g("b27010", d)) for _, n, d in INS_AGES]),
    ]),
    dict(id="veterans", label="Veterans", metrics=[
        M("pct_veteran", "Veterans", "% of civilian adults 18+", "pct", lambda g: P(g("b21001", 2), g("b21001", 1))),
        M("pct_veteran_men", "Veterans among men", "% of civilian men 18+", "pct", lambda g: P(g("b21001", 5), g("b21001", 4))),
        M("pct_vets_65plus", "Veterans 65 and older", "% of veterans who are 65+", "pct",
          lambda g: P(g.s("b21001", [17, 20, 35, 38]), g("b21001", 2))),
    ], charts=[
        C("vet_age", "Veterans by age", "share", ["18-34", "35-54", "55-64", "65-74", "75+"],
          lambda g: [g.s("b21001", [n, n + 18]) for n in (8, 11, 14, 17, 20)], sub="% of veterans"),
    ]),
]


def load():
    frames = []
    for t in TABLES:
        df = pd.read_csv(RAW / f"{t}.dat", sep="|", dtype={"GEO_ID": str}, low_memory=False)
        frames.append(df.set_index("GEO_ID"))
    df = pd.concat(frames, axis=1)
    df = df.apply(pd.to_numeric, errors="coerce")
    # Census uses large negative "jam values" (e.g. -666666666) for unavailable estimates
    return df.mask(df < 0)


def rnd(v, fmt):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    nd = {"pct": 1, "dec1": 1, "dec2": 2, "dec3": 3, "min": 1, "money": 0, "int": 0, "year": 0, "cat": 0}.get(fmt, 2)
    v = round(float(v), nd)
    return int(v) if nd == 0 else v


# Compact output: each place is [pop, metric values, margins of error, chart arrays, chart totals],
# each list in the fixed order given by these lists (also written to meta so the page can decode).
M_ORDER = [m for t in TOPICS for m in t["metrics"] if m["f"] is not None]
E_ORDER = [m for m in M_ORDER if m["moe"]]
D_ORDER = [c for t in TOPICS for c in t["charts"]]
T_ORDER = [c for c in D_ORDER if c["t"]]


def safe(f, g):
    try:
        return f(g)
    except TypeError:  # an input cell is missing
        return None


def build(df):
    out = {}
    for geo, row in df.iterrows():
        g = G(row.to_dict())
        p = pop(g)
        if p is None:
            continue
        M = [rnd(safe(m["f"], g), m["fmt"]) for m in M_ORDER]
        E = [rnd(safe(m["moe"], g), m["fmt"]) for m in E_ORDER]
        D = []
        for c in D_ORDER:
            vals = safe(c["f"], g)
            fmt = c["fmt"] if c["kind"] == "values" else "int"
            D.append(None if vals is None else [rnd(v, fmt) for v in vals])
        T = [rnd(safe(c["t"], g), "int") for c in T_ORDER]
        out[geo.split("US", 1)[1]] = [int(p), M, E, D, T]
    return out


def meta():
    topics = []
    for t in TOPICS:
        topics.append({
            "id": t["id"], "label": t["label"],
            "metrics": [{k: v for k, v in m.items() if k not in ("f", "moe")} | {"moe": bool(m["moe"])}
                        for m in t["metrics"]],
            "charts": [{k: v for k, v in c.items() if k not in ("f", "t")} | {"of_total": bool(c["t"])}
                       for c in t["charts"]],
        })
    return {"topics": topics, "race": [l for l, _ in RACE],
            "order": {"m": [m["id"] for m in M_ORDER], "e": [m["id"] for m in E_ORDER],
                      "d": [c["id"] for c in D_ORDER], "t": [c["id"] for c in T_ORDER]}}


def main():
    global RAW, OUT
    fips = sys.argv[1] if len(sys.argv) > 1 else "55"
    RAW = ROOT / "data" / "raw" / fips
    OUT = ROOT / "data" / "build" / fips
    OUT.mkdir(parents=True, exist_ok=True)
    stats = build(load())
    (OUT / "stats.json").write_text(json.dumps({"meta": meta(), "geo": stats}, separators=(",", ":")))
    print(f"wrote {len(stats)} geographies, {sum(len(t['metrics']) for t in TOPICS)} metrics, "
          f"{sum(len(t['charts']) for t in TOPICS)} charts", file=sys.stderr)


if __name__ == "__main__":
    main()
