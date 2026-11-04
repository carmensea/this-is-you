"""Known laboratory tests: their names, units and safe unit conversions. No web imports, no I/O.

Identifiers are this app's own (`CODE_SYSTEM`), not LOINC. LOINC depends on specimen and method,
which reports often leave out, so mapping to it is left until it can be done honestly.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

CODE_SYSTEM = "this-is-you-v1"
THOUSANDS, MILLIONS = "×10³/µL", "×10⁶/µL"

# Different spellings of the same unit. Nothing here changes a number.
_SPELLINGS = {
    "g/dl": "g/dL", "g/l": "g/L", "mg/dl": "mg/dL", "mg/l": "mg/L", "mmol/l": "mmol/L", "meq/l": "mEq/L", "u/l": "U/L", "iu/l": "IU/L",
    "fl": "fL", "pg": "pg", "%": "%", "ng/dl": "ng/dL", "ng/ml": "ng/mL", "pg/ml": "pg/mL", "pmol/l": "pmol/L", "nmol/l": "nmol/L",
    "ug/dl": "µg/dL", "µg/dl": "µg/dL", "mcg/dl": "µg/dL", "umol/l": "µmol/L", "µmol/l": "µmol/L",
    "k/ul": THOUSANDS, "k/µl": THOUSANDS, "x10e3/ul": THOUSANDS, "x10^3/ul": THOUSANDS, "10^3/ul": THOUSANDS, "10*3/ul": THOUSANDS, "10e3/ul": THOUSANDS, "x103/ul": THOUSANDS, "thou/ul": THOUSANDS, "×10³/µl": THOUSANDS,
    "m/ul": MILLIONS, "m/µl": MILLIONS, "x10e6/ul": MILLIONS, "x10^6/ul": MILLIONS, "10^6/ul": MILLIONS, "10*6/ul": MILLIONS, "10e6/ul": MILLIONS, "x106/ul": MILLIONS, "mil/ul": MILLIONS, "million/ul": MILLIONS, "×10⁶/µl": MILLIONS,
    # One microunit per millilitre is exactly one milliunit per litre.
    "miu/l": "mIU/L", "mu/l": "mIU/L", "uiu/ml": "mIU/L", "µiu/ml": "mIU/L", "miu/ml": "mIU/mL",
    "ml/min/1.73m2": "mL/min/1.73m²", "ml/min/1.73m²": "mL/min/1.73m²", "ml/min/1.73": "mL/min/1.73m²", "ml/min": "mL/min",
}
# The same few units are written many ways in blood counts. "uL", "mcL" and "µL" are one volume, in either micro sign.
BILLIONS_PER_L, TRILLIONS_PER_L, CELLS = "×10⁹/L", "×10¹²/L", "cells/µL"
_MICROLITRE = ("/ul", "/µl", "/μl", "/mcl")
for _prefix in ("x10e3", "x10^3", "10^3", "10*3", "10e3", "x103", "x10(3)", "10(3)", "x10*3", "k", "thou", "thousand", "tho"):
    _SPELLINGS.update({_prefix + _volume: THOUSANDS for _volume in _MICROLITRE})
for _prefix in ("x10e6", "x10^6", "10^6", "10*6", "10e6", "x106", "x10(6)", "10(6)", "x10*6", "m", "mil", "mill", "million"):
    _SPELLINGS.update({_prefix + _volume: MILLIONS for _volume in _MICROLITRE})
_SPELLINGS.update({_prefix + "/l": BILLIONS_PER_L for _prefix in ("x10e9", "x10^9", "10^9", "10*9", "10e9", "x109", "x10(9)", "x10*9")})
_SPELLINGS.update({_prefix + "/l": TRILLIONS_PER_L for _prefix in ("x10e12", "x10^12", "10^12", "10*12", "10e12", "x1012", "x10(12)", "x10*12")})
_SPELLINGS.update({"cells" + _volume: CELLS for _volume in _MICROLITRE})
_SPELLINGS.update({_volume: CELLS for _volume in _MICROLITRE})
_SPELLINGS.update({"gm/dl": "g/dL", "/100 wbc": "/100 WBC", "/100wbc": "/100 WBC", "%wbc": "%"})
UNIT_WORDS = frozenset(_SPELLINGS)


def canonical_unit(unit: str | None) -> str | None:
    """The same unit in one spelling, or the original when it is not a known spelling."""
    if not unit:
        return None
    return _SPELLINGS.get(unit.strip().lower(), unit.strip())


@dataclass(frozen=True)
class LabTest:
    code: str
    category: str
    name: str
    short: str
    unit: str
    names: tuple[str, ...]
    # Multiply a value in this unit by the factor to get `unit`. Per test, because it depends on the molecule.
    conversions: dict[str, float] = field(default_factory=dict)
    expected_units: tuple[str, ...] = ()
    compare_group: str | None = None  # Tests with a group may be drawn on one chart, if units also match.


def _t(code, category, name, short, unit, names, conversions=None, also=(), group=None) -> LabTest:
    conversions = conversions or {}
    return LabTest(code, category, name, short, unit, tuple(names), conversions, (unit, *conversions, *also), group)


def _differential(code: str, name: str, spellings: list[str], *absolute_names: str) -> tuple[LabTest, LabTest]:
    """A white cell type as a share of the count, and as a count. Different tests, with very different numbers."""
    percent = [f"{word} %" for word in spellings] + [f"{word}%" for word in spellings] + [f"% {word}" for word in spellings] + [f"{word} percent" for word in spellings] + [f"{word}, %" for word in spellings] + [f"{word} (%)" for word in spellings]
    count = [form for word in spellings for form in (f"absolute {word}", f"{word} absolute", f"{word}, absolute", f"{word} (absolute)", f"abs {word}", f"{word} abs", f"{word}, abs", f"{word} #", f"{word}#", f"{word} (abs)")]
    return (
        _t(f"{code}_pct", "cbc", f"{name}, percent", f"{name} %", "%", percent),
        _t(f"{code}_abs", "cbc", f"{name}, absolute", f"{name} abs.", THOUSANDS, [*count, *absolute_names], {BILLIONS_PER_L: 1.0, CELLS: 0.001}),
    )


CATEGORIES = [("cbc", "Complete blood count", "CBC"), ("cmp", "Metabolic panel", "metabolic"), ("lipid", "Lipid panel", "lipids"), ("thyroid", "Thyroid function", "thyroid"), ("other", "Other results", "other")]

TESTS: tuple[LabTest, ...] = (
    _t("wbc", "cbc", "White blood cell count", "WBC", THOUSANDS, ["wbc", "white blood cell count", "white blood cells", "white blood cell", "leukocytes", "wbc count", "leukocyte count"], {BILLIONS_PER_L: 1.0}),
    _t("rbc", "cbc", "Red blood cell count", "RBC", MILLIONS, ["rbc", "red blood cell count", "red blood cells", "red blood cell", "erythrocytes", "rbc count", "erythrocyte count"], {TRILLIONS_PER_L: 1.0}),
    _t("hgb", "cbc", "Hemoglobin", "Hemoglobin", "g/dL", ["hemoglobin", "hgb", "hb", "haemoglobin"], {"g/L": 0.1}),
    _t("hct", "cbc", "Hematocrit", "Hematocrit", "%", ["hematocrit", "hct", "haematocrit"]),
    _t("mcv", "cbc", "Mean corpuscular volume", "MCV", "fL", ["mcv", "mean corpuscular volume", "mean cell volume"]),
    _t("mch", "cbc", "Mean corpuscular hemoglobin", "MCH", "pg", ["mch", "mean corpuscular hemoglobin", "mean cell hemoglobin"]),
    _t("mchc", "cbc", "Mean corpuscular hemoglobin concentration", "MCHC", "g/dL", ["mchc", "mean corpuscular hemoglobin concentration", "mean cell hemoglobin concentration"], {"g/L": 0.1}),
    _t("rdw", "cbc", "Red cell distribution width", "RDW", "%", ["rdw", "red cell distribution width", "rdw-cv", "rdw cv", "rbc distribution width"]),
    _t("rdwsd", "cbc", "Red cell distribution width, SD", "RDW-SD", "fL", ["rdw-sd", "rdw sd"]),
    _t("plt", "cbc", "Platelet count", "Platelets", THOUSANDS, ["platelets", "platelet count", "plt", "platelet"], {BILLIONS_PER_L: 1.0}),
    _t("mpv", "cbc", "Mean platelet volume", "MPV", "fL", ["mpv", "mean platelet volume"]),
    *_differential("neut", "Neutrophils", ["neutrophils", "neutrophil", "neut", "neuts", "segs", "segmented neutrophils", "seg neutrophils", "polys"], "anc", "absolute neutrophil count"),
    *_differential("lymph", "Lymphocytes", ["lymphocytes", "lymphocyte", "lymph", "lymphs"], "alc", "absolute lymphocyte count"),
    *_differential("mono", "Monocytes", ["monocytes", "monocyte", "mono", "monos"], "amc", "absolute monocyte count"),
    *_differential("eos", "Eosinophils", ["eosinophils", "eosinophil", "eos", "eosin"], "aec", "absolute eosinophil count"),
    *_differential("baso", "Basophils", ["basophils", "basophil", "baso", "basos"], "abc", "absolute basophil count"),
    *_differential("ig", "Immature granulocytes", ["immature granulocytes", "immature granulocyte", "imm granulocytes", "immature grans", "ig"]),
    _t("nrbc", "cbc", "Nucleated red blood cells", "nRBC", "/100 WBC", ["nrbc", "nucleated rbc", "nucleated red blood cells", "nucleated rbcs"], also=("%",)),
    _t("glu", "cmp", "Glucose", "Glucose", "mg/dL", ["glucose", "glucose, fasting", "fasting glucose", "glucose, serum", "glucose fasting", "glu"], {"mmol/L": 18.016}),
    _t("bun", "cmp", "Blood urea nitrogen", "BUN", "mg/dL", ["bun", "blood urea nitrogen", "urea nitrogen", "urea nitrogen (bun)"], {"mmol/L": 2.801}),
    _t("creat", "cmp", "Creatinine", "Creatinine", "mg/dL", ["creatinine", "creatinine, serum", "creat"], {"µmol/L": 1 / 88.4}),
    _t("egfr", "cmp", "Estimated glomerular filtration rate", "eGFR", "mL/min/1.73m²", ["egfr", "estimated gfr", "estimated glomerular filtration rate", "gfr, estimated", "egfr (ckd-epi)"]),
    _t("na", "cmp", "Sodium", "Sodium", "mmol/L", ["sodium", "na", "sodium, serum"], {"mEq/L": 1.0}),
    _t("k", "cmp", "Potassium", "Potassium", "mmol/L", ["potassium", "k", "potassium, serum"], {"mEq/L": 1.0}),
    _t("cl", "cmp", "Chloride", "Chloride", "mmol/L", ["chloride", "cl", "chloride, serum"], {"mEq/L": 1.0}),
    _t("co2", "cmp", "Carbon dioxide", "CO2", "mmol/L", ["carbon dioxide", "co2", "bicarbonate", "carbon dioxide, total", "total co2", "hco3"], {"mEq/L": 1.0}),
    _t("ca", "cmp", "Calcium", "Calcium", "mg/dL", ["calcium", "ca", "calcium, serum"], {"mmol/L": 4.008}),
    _t("tp", "cmp", "Total protein", "Total protein", "g/dL", ["total protein", "protein, total", "protein total"], {"g/L": 0.1}),
    _t("alb", "cmp", "Albumin", "Albumin", "g/dL", ["albumin", "albumin, serum"], {"g/L": 0.1}),
    _t("bili", "cmp", "Bilirubin, total", "Bilirubin", "mg/dL", ["bilirubin, total", "total bilirubin", "bilirubin total", "bilirubin"], {"µmol/L": 1 / 17.1}),
    _t("alp", "cmp", "Alkaline phosphatase", "ALP", "U/L", ["alkaline phosphatase", "alk phos", "alp"], also=("IU/L",)),
    _t("ast", "cmp", "Aspartate aminotransferase", "AST", "U/L", ["ast", "ast (sgot)", "sgot", "aspartate aminotransferase"], also=("IU/L",)),
    _t("alt", "cmp", "Alanine aminotransferase", "ALT", "U/L", ["alt", "alt (sgpt)", "sgpt", "alanine aminotransferase"], also=("IU/L",)),
    _t("a1c", "cmp", "Hemoglobin A1c", "HbA1c", "%", ["hemoglobin a1c", "hba1c", "a1c", "hgb a1c", "glycated hemoglobin"]),
    _t("tc", "lipid", "Total cholesterol", "Total chol.", "mg/dL", ["total cholesterol", "cholesterol, total", "cholesterol total", "cholesterol"], {"mmol/L": 38.67}, group="lipid"),
    _t("ldl", "lipid", "LDL cholesterol", "LDL", "mg/dL", ["ldl", "ldl cholesterol", "ldl-c", "ldl chol calc", "ldl cholesterol calc", "ldl calculated", "ldl chol calc (nih)", "ldl-cholesterol"], {"mmol/L": 38.67}, group="lipid"),
    _t("hdl", "lipid", "HDL cholesterol", "HDL", "mg/dL", ["hdl", "hdl cholesterol", "hdl-c", "hdl chol", "hdl-cholesterol"], {"mmol/L": 38.67}, group="lipid"),
    _t("tg", "lipid", "Triglycerides", "Triglycerides", "mg/dL", ["triglycerides", "triglyceride", "trig", "tg"], {"mmol/L": 88.57}, group="lipid"),
    _t("nonhdl", "lipid", "Non-HDL cholesterol", "Non-HDL", "mg/dL", ["non-hdl cholesterol", "non hdl cholesterol", "non-hdl", "non hdl chol"], {"mmol/L": 38.67}, group="lipid"),
    _t("tsh", "thyroid", "Thyroid stimulating hormone", "TSH", "mIU/L", ["tsh", "thyroid stimulating hormone", "thyrotropin", "tsh, 3rd generation", "thyroid-stimulating hormone"]),
    _t("ft4", "thyroid", "Free thyroxine", "Free T4", "ng/dL", ["free t4", "t4, free", "t4 free", "free thyroxine", "ft4", "thyroxine, free", "t4,free(direct)"], {"pmol/L": 0.0777}),
    _t("ft3", "thyroid", "Free triiodothyronine", "Free T3", "pg/mL", ["free t3", "t3, free", "t3 free", "free triiodothyronine", "ft3"], {"pmol/L": 0.651}),
    _t("t4", "thyroid", "Total thyroxine", "T4", "µg/dL", ["t4", "total t4", "thyroxine", "t4, total", "thyroxine (t4)"]),
    _t("t3", "thyroid", "Total triiodothyronine", "T3", "ng/dL", ["t3", "total t3", "triiodothyronine", "t3, total"]),
)
_BY_NAME = {name: test for test in TESTS for name in test.names}
BY_CODE = {test.code: test for test in TESTS}
# A bare "Neutrophils" could be a percentage or a count. Only the unit printed beside it says which, so with no unit it stays unknown.
_NEEDS_UNIT = {
    word: {"%": BY_CODE[f"{code}_pct"], THOUSANDS: BY_CODE[f"{code}_abs"], BILLIONS_PER_L: BY_CODE[f"{code}_abs"], CELLS: BY_CODE[f"{code}_abs"]}
    for code, words in (
        ("neut", ("neutrophils", "neutrophil", "neut", "neuts", "segs", "segmented neutrophils", "seg neutrophils", "polys")),
        ("lymph", ("lymphocytes", "lymphocyte", "lymph", "lymphs")),
        ("mono", ("monocytes", "monocyte", "mono", "monos")),
        ("eos", ("eosinophils", "eosinophil", "eos", "eosin")),
        ("baso", ("basophils", "basophil", "baso", "basos")),
        ("ig", ("immature granulocytes", "immature granulocyte", "imm granulocytes", "immature grans", "ig")),
    )
    for word in words
}
_MAX_NAME_WORDS = max(len(name.split()) for name in (*_BY_NAME, *_NEEDS_UNIT))


def _key(name: str) -> str:
    return " ".join(name.lower().replace("(", "(").split()).strip(" .:;*")


def find_test(name: str | None, unit: str | None = None) -> LabTest | None:
    """An exact match on a known name. Similar-looking names are not matched: HbA1c is not hemoglobin."""
    if not name:
        return None
    key = _key(name)
    if key in _NEEDS_UNIT:
        return _NEEDS_UNIT[key].get(canonical_unit(unit) or "")
    return _BY_NAME.get(key)


def needs_unit(name: str) -> bool:
    return _key(name) in _NEEDS_UNIT


def longest_known_prefix(words: list[str]) -> int:
    """How many leading words form a known test name, or 0."""
    for count in range(min(_MAX_NAME_WORDS, len(words)), 0, -1):
        key = _key(" ".join(words[:count]))
        if key in _BY_NAME or key in _NEEDS_UNIT:
            return count
    return 0


def normalize(test: LabTest | None, number: float | None, unit: str | None) -> tuple[float | None, str | None]:
    """Value in the test's standard unit, only when that is safe. Otherwise nothing."""
    canonical = canonical_unit(unit)
    if test is None or number is None or canonical is None:
        return None, None
    if canonical == test.unit:
        return number, test.unit
    factor = test.conversions.get(canonical)
    return (round(number * factor, 4), test.unit) if factor else (None, None)


_RANGE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*$", re.I)
_BOUND = re.compile(r"^\s*(<=?|>=?|≤|≥)\s*(\d+(?:\.\d+)?)\s*$")


def parse_range(text: str | None) -> tuple[float | None, float | None]:
    """Bounds of a printed reference range. Anything else stays as text with no bounds."""
    if not text:
        return None, None
    if match := _RANGE.match(text):
        low, high = float(match[1]), float(match[2])
        return (low, high) if low <= high else (None, None)
    if match := _BOUND.match(text):
        return (None, float(match[2])) if match[1][0] in "<≤" else (float(match[2]), None)
    return None, None


_PLAIN_NUMBER = re.compile(r"^\d+(?:\.\d+)?$")
_THOUSANDS_NUMBER = re.compile(r"^\d{1,3}(?:,\d{3})+$")


def parse_value(text: str) -> float | None:
    """The number, only when the printed value is one exact number. "<0.5" and "Negative" are not."""
    stripped = text.strip()
    if _PLAIN_NUMBER.match(stripped):
        return float(stripped)
    if _THOUSANDS_NUMBER.match(stripped):
        return float(stripped.replace(",", ""))
    return None
