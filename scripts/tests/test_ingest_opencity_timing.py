"""
Ingestion tests for scripts/ingest_opencity_timing.py (v3) and scripts/ingest_secondary_sources.py.

Run:  python3 -m unittest discover -s scripts/tests -v

The PDF-parsing tests build a real single-page PDF fixture (two BTP-style junction panels, laid out
like the OpenCity sheets) with a tiny hand-written PDF writer, so pdfplumber/pypdf run end to end
without network or binary fixtures. Matching, duplicate, conflict, weak-match and staleness tests
drive the pure functions directly.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import ingest_opencity_timing as ing  # noqa: E402
import ingest_secondary_sources as sec  # noqa: E402

try:
    import pdfplumber  # noqa: F401
    import pypdf  # noqa: F401

    HAVE_PDF = True
except ImportError:  # pragma: no cover
    HAVE_PDF = False


# ---------------------------------------------------------------------------------------------
# Minimal PDF writer (Helvetica, positioned text) — enough for pdfplumber word extraction
# ---------------------------------------------------------------------------------------------
def write_pdf(path: str, items: list[tuple[float, float, float, str]]) -> None:
    """items: (x, y_from_top, font_size, text). Page is US Letter 612 × 792."""

    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    ops = ["BT"]
    for x, top, size, text in items:
        y = 792.0 - top
        ops.append(f"/F1 {size:.1f} Tf 1 0 0 1 {x:.1f} {y:.1f} Tm ({esc(text)}) Tj")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    with open(path, "wb") as f:
        f.write(out)


def panel_items(top0: float, name: str, ps: str, control: str, descriptor: str, rows: list[tuple[str, str, list[int], int, str]], landmarks: list[str], ped_col: int | None = None, sunday_from_row: int | None = None, header_top: float | None = None):
    """
    Lay out one BTP-style panel whose table starts at `top0`: header (10 pt; above the table for the
    top panel, below it for the bottom panel — as in the real sheets), descriptor (6 pt), PHASE /
    CYCLE TIME labels, 'ROAD FROM 1 2 3 4' header line (7.4 pt), approach rows A–D with landmark and
    L/S/R letters under phase columns, then timing rows (start end p1..pn cycle [label]).
    """
    items = []
    items.append((172, header_top if header_top is not None else top0, 10.0, f"{name} JUNCTION, {ps} POLICE STATION - {control}"))
    items.append((130, top0 + 50, 5.9, descriptor))
    items.append((331, top0 + 50, 8.9, "PHASE"))
    items.append((457, top0 + 44, 7.4, "CYCLE"))
    items.append((461, top0 + 53, 7.4, "TIME"))
    cols = [267, 319, 371, 420]
    n = len(rows[0][2])
    hdr = top0 + 69
    items.append((160, hdr, 7.4, "ROAD"))
    items.append((190, hdr, 7.4, "FROM"))
    for k in range(n):
        items.append((cols[k], hdr, 7.4, str(k + 1)))
    if ped_col is not None:
        items.append((cols[ped_col] - 6, hdr + 30, 5.0, "EXCLUSIVE"))
    letters = "ABCD"
    moves = {0: {0: "LS", 2: "L"}, 1: {1: "LSR"}, 2: {2: "LSR"}, 3: {0: "LS", 1: "L"}}
    for ai, lm in enumerate(landmarks):
        top = hdr + 21 + ai * 21
        items.append((167, top, 7.4, letters[ai]))
        items.append((190, top + 0.5, 5.9, lm))
        for col, mv in moves.get(ai, {}).items():
            if col >= n:
                continue
            for mi, ch in enumerate(mv):
                items.append((cols[col] - 3 + mi * 18 - 9 * (len(mv) - 1), top, 7.4, ch))
    first_row_top = hdr + 21 + len(landmarks) * 21 + 6
    for ri, (start, end, phases, cycle, label) in enumerate(rows):
        top = first_row_top + ri * 14
        if label:
            items.append((122, top, 7.4, label))
        items.append((159, top, 7.4, start))
        items.append((204, top, 7.4, end))
        for k, p in enumerate(phases):
            items.append((cols[k] - 2, top, 7.4, str(p)))
        items.append((461, top, 7.4, str(cycle)))
        if sunday_from_row is not None and ri == sunday_from_row:
            items.append((122, top + 8, 7.4, "(sunday)"))
    return items


def make_fixture(path: str) -> None:
    top = panel_items(
        55,
        "ADUGODI",
        "ADUGODI",
        "VAC",
        "HOSUR LASKAR RD X NEW MICO RD",
        [("07:00", "08:00", [40, 20, 30, 10], 100, ""), ("08:00", "11:00", [90, 35, 55, 10], 190, "TIMINGS"), ("11:00", "16:30", [65, 25, 35, 10], 135, "weekdays"), ("16:30", "21:00", [90, 35, 55, 10], 190, ""), ("21:00", "23:00", [40, 20, 30, 8], 98, "")],
        ["UCO BANK", "KORAMANGALA", "MICO BANDE", "ANEPALYA"],
        ped_col=3,
    )
    bottom = panel_items(
        480,
        "AISHWARYA",
        "ADUGODI",
        "FIXED",
        "HOSUR RD X SERVICE RD",
        [("07:00", "11:00", [60, 40, 10], 110, ""), ("11:00", "16:00", [50, 30, 10], 91, ""), ("16:00", "22:00", [60, 40, 10], 110, ""), ("22:00", "23:00", [0, 0, 0], 0, "BLINKING")],
        ["JAKKASANDRA", "KRUPANIDHI", "SERVICE ROAD"],
        ped_col=2,
        header_top=760,
    )
    write_pdf(path, top + bottom)


def inter(id_: str, name: str, roads: list[str], lat: float, lon: float, highway: str = "primary"):
    return {"id": id_, "canonical_name": name, "lat": lat, "lon": lon, "road_names": roads, "approaches": [{"highway": highway}]}


INTERS = [
    inter("gw-adugodi", "New MICO Link Road × Hosur Road", ["Hosur Road", "New MICO Link Road"], 12.944031, 77.607584),
    inter("gw-bannerghatta", "Bannerghatta Road × New MICO Link Road", ["Bannerghatta Road", "New MICO Link Road"], 12.94436, 77.602869),
    inter("gw-silkboard", "Silk Board Junction", ["Hosur Road", "Outer Ring Road"], 12.9176, 77.6227),
    inter("gw-far", "Hebbala Flyover", ["Bellary Road"], 13.0359, 77.5970),
]
CACHE = {
    "HOSUR LASKAR RD and NEW MICO RD, Bengaluru": None,
    "ADUGODI junction, Bengaluru": {"provider": "photon", "lat": 12.9440179, "lon": 77.6075681, "label": "Adugodi Police Station Junction", "osm": "junction=yes"},
    "HOSUR RD and SERVICE RD, Bengaluru": None,
    "AISHWARYA junction, Bengaluru": None,
    "AISHWARYA, Bengaluru": {"provider": "photon", "lat": 12.95, "lon": 77.61, "label": "Aishwarya Boutique", "osm": "shop=clothes"},
}


class OfflineGeocoder(ing.Geocoder):
    def __init__(self, cache):
        super().__init__(cache_path="", enabled=False)
        self.cache = dict(cache)


def block(key: str, name: str, ps: str, windows, tier: str = "strong", target: str | None = "gw-adugodi", doc_date: str | None = "2010-03-17", portal: str | None = "2025-11-25T11:57:06"):
    return {
        "junction_key": key,
        "original_junction_name": name,
        "police_station": ps,
        "day_plans": [{"day_type": "weekday_default", "windows": [{"mode": "timed", "start": s, "end": e, "phases": p, "cycle_s": c} for s, e, p, c in windows], "windows_ordered": True}],
        "match": {"tier": tier, "best": {"intersection_id": target} if target else None},
        "document_currency": ing.document_currency(doc_date, portal, "2026-09-06"),
    }


W1 = [("07:00", "11:00", [40, 20, 30, 10], 100), ("11:00", "22:00", [50, 20, 30, 10], 110)]
W2 = [("07:00", "11:00", [45, 20, 30, 10], 105), ("11:00", "22:00", [50, 20, 30, 10], 110)]


# ---------------------------------------------------------------------------------------------
@unittest.skipUnless(HAVE_PDF, "pdfplumber/pypdf not installed")
class PdfParsingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.pdf = os.path.join(cls.tmp, "fixture.pdf")
        make_fixture(cls.pdf)
        cls.panels, cls.status, cls.plain = ing.extract_panels(cls.pdf)

    def test_two_panels_are_split_by_header_position(self):
        self.assertEqual(self.status, "ok")
        self.assertEqual(len(self.panels), 2)
        self.assertEqual(self.panels[0]["header"]["name"], "ADUGODI")
        self.assertEqual(self.panels[1]["header"]["name"], "AISHWARYA")
        self.assertEqual(self.panels[0]["header"]["control_type_hint"], "vehicle_actuated")
        self.assertEqual(self.panels[1]["header"]["control_type_hint"], "fixed")
        self.assertEqual(self.panels[0]["header"]["police_station"], "ADUGODI")

    def test_phase_columns_rows_cycle_and_consistency(self):
        p = self.panels[0]
        self.assertEqual(p["phase_count"], 4)
        self.assertEqual(p["descriptor"], "HOSUR LASKAR RD X NEW MICO RD")
        rows = p["day_plans"][0]["windows"]
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0]["start"], "07:00")
        self.assertEqual(rows[0]["end"], "08:00")
        self.assertEqual(rows[0]["phases"], [40, 20, 30, 10])
        self.assertEqual(rows[0]["cycle_s"], 100)
        self.assertEqual(rows[0]["cycle_source"], "stated_in_row")
        self.assertTrue(all(r["consistent"] for r in rows))
        self.assertEqual(rows[1]["cycle_s"], 190)

    def test_pedestrian_phase_is_detected_and_reported_per_window(self):
        p = self.panels[0]
        self.assertEqual(p["pedestrian_phase_index"], 3)
        self.assertEqual(p["day_plans"][0]["windows"][0]["pedestrian_phase_s"], 10)
        self.assertEqual(p["day_plans"][0]["windows"][4]["pedestrian_phase_s"], 8)
        self.assertIn("pedestrian (EXCLUSIVE)", p["phase_labels"][3])

    def test_movement_matrix_gives_document_approach_phase_labels(self):
        p = self.panels[0]
        letters = [r["letter"] for r in p["approach_rows"]]
        self.assertEqual(letters, ["A", "B", "C", "D"])
        a = p["approach_rows"][0]
        self.assertEqual(a["landmark"], "UCO BANK")
        self.assertEqual(a["movements_by_phase"]["0"], ["L", "S"])
        self.assertEqual(a["movements_by_phase"]["2"], ["L"])
        self.assertEqual(p["approach_rows"][1]["movements_by_phase"]["1"], ["L", "S", "R"])
        self.assertEqual(p["phase_labels"][0], "A·LS + D·LS")
        self.assertGreaterEqual(p["movement_matrix_confidence"], 0.8)

    def test_blinking_row_and_parse_confidence(self):
        p = self.panels[1]
        rows = p["day_plans"][0]["windows"]
        self.assertEqual(rows[-1]["mode"], "blinking")
        self.assertEqual(rows[1]["cycle_s"], 91)
        self.assertTrue(rows[1]["consistent"])  # 50+30+10 = 90 vs stated 91 → within the 3 s tolerance
        self.assertTrue(rows[0]["consistent"])
        self.assertGreaterEqual(p["parse_confidence"], 0.8)
        self.assertLessEqual(p["parse_confidence"], 1.0)
        self.assertEqual(set(p["parse_confidence_components"]), {"header_parsed", "phase_columns_detected", "timed_rows_present", "rows_consistent", "rows_without_unassigned_numbers", "day_groups_labelled", "road_descriptor_found"})

    def test_pdf_metadata_dates_and_hash(self):
        meta = ing.pdf_metadata(self.pdf)
        self.assertEqual(meta["page_count"], 1)
        self.assertTrue(meta["has_text_layer"])
        self.assertEqual(len(meta["sha256"]), 64)
        self.assertIsNone(meta["creation_date"])  # fixture has no /CreationDate → undated document
        self.assertEqual(ing.parse_pdf_date("D:20100317115245+05'30'"), "2010-03-17")
        self.assertIsNone(ing.parse_pdf_date("garbage"))


class JunctionMatchingTests(unittest.TestCase):
    def setUp(self):
        self.index = ing.build_inter_index(INTERS)
        self.geo = OfflineGeocoder(CACHE)

    def panel(self, name, ps, descriptor, landmarks=()):
        return {"header": {"name": name, "police_station": ps, "control_label": "FIXED", "control_type_hint": "fixed", "raw": ""}, "descriptor": descriptor, "approach_landmarks": list(landmarks), "phase_count": 4, "pedestrian_phase_index": None, "day_plans": []}

    def test_descriptor_and_trusted_geocode_produce_moderate_or_strong_match(self):
        m = ing.match_junction(self.panel("ADUGODI", "ADUGODI", "HOSUR LASKAR RD X NEW MICO RD"), self.index, self.geo)
        self.assertEqual(m["best"]["intersection_id"], "gw-adugodi")
        self.assertIn(m["tier"], ("strong", "moderate"))
        self.assertTrue(m["geocode"]["trusted"])
        self.assertEqual(m["best"]["distance_m"], 2)

    def test_shop_geocode_is_not_trusted_as_junction_evidence(self):
        m = ing.match_junction(self.panel("AISHWARYA", "ADUGODI", "HOSUR RD X SERVICE RD"), self.index, self.geo)
        self.assertIsNotNone(m["geocode"])
        self.assertFalse(m["geocode"]["trusted"])
        self.assertTrue(all(c["distance_m"] is None for c in m["candidates"]))

    def test_unrelated_name_is_weak_or_none(self):
        m = ing.match_junction(self.panel("ZZZ UNKNOWN", "NOWHERE", None), self.index, self.geo)
        self.assertIn(m["tier"], ("weak", "none"))

    def test_weak_match_never_prevalidates(self):
        panel = self.panel("ZZZ UNKNOWN", "NOWHERE", None)
        panel["day_plans"] = [{"day_type": "weekday_default", "windows_ordered": True, "windows": [{"mode": "timed", "start": "07:00", "end": "22:00", "phases": [40, 20, 30, 10], "cycle_s": 100, "cycle_source": "stated_in_row", "consistent": True, "flags": []}]}]
        m = ing.match_junction(panel, self.index, self.geo)
        ver = ing.prevalidate(panel, m)
        self.assertEqual(ver["status"], "needs_review")
        self.assertIn("match_strong", ver["blocking"])
        review = ing.review_state(ver, m, ["weak_match"])
        self.assertEqual(review["status"], "pending_review")
        self.assertIsNone(review["proposed_intersection_id"])
        self.assertFalse(review["affects_recommendations"])
        self.assertTrue(review["requires_explicit_review_decision"])


class PrevalidationNeverVerifiesTests(unittest.TestCase):
    def test_perfect_block_is_only_pre_validated(self):
        panel = {"header": {"name": "X", "police_station": "Y", "control_label": "FIXED", "control_type_hint": "fixed", "raw": ""}, "descriptor": "A X B", "approach_landmarks": [], "phase_count": 4, "pedestrian_phase_index": 3,
                 "day_plans": [{"day_type": "weekday_default", "windows_ordered": True, "windows": [{"mode": "timed", "start": "07:00", "end": "22:00", "phases": [40, 20, 30, 10], "cycle_s": 100, "cycle_source": "stated_in_row", "consistent": True, "flags": []}]}]}
        match = {"tier": "strong", "best": {"intersection_id": "gw-adugodi"}}
        ver = ing.prevalidate(panel, match)
        self.assertEqual(ver["status"], "rule_set_passed")
        self.assertNotIn("verified", json.dumps(ver))
        review = ing.review_state(ver, match, [])
        self.assertEqual(review["status"], "pre_validated")
        self.assertEqual(review["proposed_intersection_id"], "gw-adugodi")
        self.assertFalse(review["affects_recommendations"])
        self.assertTrue(review["requires_explicit_review_decision"])

    def test_atcs_control_label_blocks_prevalidation(self):
        panel = {"header": {"name": "X", "police_station": "Y", "control_label": "ATCS", "control_type_hint": "adaptive", "raw": ""}, "descriptor": None, "approach_landmarks": [], "phase_count": 4, "pedestrian_phase_index": None,
                 "day_plans": [{"day_type": "weekday_default", "windows_ordered": True, "windows": [{"mode": "timed", "start": "07:00", "end": "22:00", "phases": [40, 20, 30, 10], "cycle_s": 100, "cycle_source": "stated_in_row", "consistent": True, "flags": []}]}]}
        ver = ing.prevalidate(panel, {"tier": "strong", "best": {"intersection_id": "gw-adugodi"}})
        self.assertEqual(ver["status"], "needs_review")
        self.assertIn("control_label_usable", ver["blocking"])


class DuplicateAndConflictTests(unittest.TestCase):
    def test_identical_blocks_for_same_junction_are_duplicates(self):
        a = block("doc1#0", "ADUGODI", "ADUGODI", W1)
        b = block("doc2#1", "Adugodi Jn", "Adugodi", W1)
        ing.quality_pass([a, b])
        self.assertIsNone(a["duplicate_of"])
        self.assertEqual(b["duplicate_of"], "doc1#0")
        self.assertIn("duplicate", b["quality_flags"])
        self.assertNotIn("duplicate", a["quality_flags"])

    def test_same_junction_different_timings_conflict(self):
        a = block("doc1#0", "ADUGODI", "ADUGODI", W1)
        b = block("doc2#0", "ADUGODI", "ADUGODI", W2)
        ing.quality_pass([a, b])
        self.assertIn("conflicting_timings", a["quality_flags"])
        self.assertIn("conflicting_timings", b["quality_flags"])
        self.assertEqual(a["conflicts_with"], ["doc2#0"])
        self.assertEqual(b["conflicts_with"], ["doc1#0"])

    def test_different_names_same_target_different_timings_conflict_on_target(self):
        a = block("doc1#0", "ADUGODI", "ADUGODI", W1, tier="strong")
        b = block("doc3#0", "MICO CIRCLE", "ADUGODI", W2, tier="moderate")
        ing.quality_pass([a, b])
        self.assertIn("conflicting_target", a["quality_flags"])
        self.assertIn("conflicting_target", b["quality_flags"])

    def test_weak_targets_do_not_create_target_conflicts(self):
        a = block("doc1#0", "ADUGODI", "ADUGODI", W1, tier="strong")
        b = block("doc3#0", "MICO CIRCLE", "ADUGODI", W2, tier="weak")
        ing.quality_pass([a, b])
        self.assertNotIn("conflicting_target", a["quality_flags"])
        self.assertIn("weak_match", b["quality_flags"])

    def test_conflicts_block_prevalidation(self):
        a = block("doc1#0", "ADUGODI", "ADUGODI", W1)
        b = block("doc2#0", "ADUGODI", "ADUGODI", W2)
        ing.quality_pass([a, b])
        ver = {"status": "rule_set_passed", "blocking": [], "rule_set": "v1"}
        review = ing.review_state(ver, a["match"], a["quality_flags"])
        self.assertEqual(review["status"], "pending_review")
        self.assertIn("conflicting_timings", review["blocking"])


class StaleDocumentTests(unittest.TestCase):
    def test_currency_rule_thresholds(self):
        self.assertEqual(ing.document_currency("2026-08-01", None, "2026-09-06")["status"], "current")
        self.assertEqual(ing.document_currency("2026-01-01", None, "2026-09-06")["status"], "aging")
        self.assertEqual(ing.document_currency("2010-03-17", "2025-11-25T11:57:06", "2026-09-06")["status"], "stale")
        self.assertEqual(ing.document_currency(None, None, "2026-09-06")["status"], "undated")

    def test_document_date_wins_over_portal_date(self):
        c = ing.document_currency("2010-03-17", "2025-11-25T11:57:06", "2026-09-06")
        self.assertEqual(c["effective_date"], "2010-03-17")
        self.assertEqual(c["effective_date_source"], "pdf_metadata")
        self.assertGreater(c["age_days"], 365 * 16)
        p = ing.document_currency(None, "2025-11-25T11:57:06", "2026-09-06")
        self.assertEqual(p["effective_date_source"], "portal_resource")
        self.assertEqual(p["status"], "aging")

    def test_stale_and_undated_documents_are_flagged(self):
        a = block("doc1#0", "ADUGODI", "ADUGODI", W1)
        b = block("doc9#0", "SILK BOARD", "MADIWALA", W2, target="gw-silkboard", doc_date=None, portal=None)
        ing.quality_pass([a, b])
        self.assertIn("stale_document", a["quality_flags"])
        self.assertIn("undated_document", b["quality_flags"])
        self.assertNotIn("stale_document", b["quality_flags"])


class SecondarySourcesTests(unittest.TestCase):
    def test_historical_mentions_are_matched_by_name_and_never_carry_timing_values(self):
        index = [{"id": i["id"], "canonical_name": i["canonical_name"], "name_toks": ing.tokens(i["canonical_name"]), "toks": ing.tokens(i["canonical_name"]) | set().union(*[ing.tokens(r) for r in i["road_names"]])} for i in INTERS]
        pages = [(155, "Hudson Circle- 4 arm Signalized intersection. The Silk Board junction signal timings need to be optimized during peak hours. Anand Rao Circle to K.R. Circle speeds drop due to signal delays.")]
        items = sec.extract_mentions(pages, index, "test-doc")
        by_name = {e["mention_text"]: e for e in items}
        self.assertIn("Silk Board junction", by_name)
        e = by_name["Silk Board junction"]
        self.assertEqual(e["kind"], "historical")
        self.assertIsNone(e["timing_values"])
        self.assertEqual(e["claim_type"], "qualitative_recommendation")
        self.assertEqual(e["match"]["best"]["intersection_id"], "gw-silkboard")
        self.assertIn(e["match"]["tier"], ("strong", "moderate"))
        self.assertEqual(e["page"], 155)
        self.assertNotIn("Signalized intersection", by_name)

    def test_generic_words_are_not_junction_names(self):
        self.assertIsNone(sec.clean_name("Signalized"))
        self.assertIsNone(sec.clean_name("Two Way"))
        self.assertEqual(sec.clean_name("Two Way Silk Board"), "Silk Board")
        self.assertEqual(sec.clean_name("T Dickenson Road Cubbon Road"), "Dickenson Road Cubbon Road")


if __name__ == "__main__":
    unittest.main()
