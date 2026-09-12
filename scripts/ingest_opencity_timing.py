#!/usr/bin/env python3
"""
theTraffic. · Bengaluru — OpenCity / BTP published signal-timing ingestion, v3.

v2 made the parser layout-aware (every BTP PDF is one page holding TWO junction panels; word
positions split the panels, assign numbers to phase/cycle columns by x and detect day groups by y).

v3 adds what the review workflow needs to judge a document instead of trusting the parser:
  * document dating — PDF metadata dates (121/124 files were authored in March 2010 and only
    uploaded to the portal in November 2025), portal publication date, retrieval date, age and a
    currency status (current / aging / stale / undated) computed with an explicit rule;
  * the approach × phase movement matrix (letters A–D with their landmark and the L/S/R movement
    letters under each phase column) — the document's own approach/phase labels, kept as reviewer
    hints, never applied automatically;
  * pedestrian phase per window, a parse-confidence score with its components, per-file SHA-256;
  * duplicate, conflicting, weak-match and stale flags computed over every block;
  * NO automatic verification. The rule set is a pre-validation only ("pre_validated" vs
    "pending_review"); a plan affects recommendations solely through a reviewer decision.

Pipeline
  PDF -> positioned words -> panels (header + table + movement matrix) -> rows -> day plans
      -> junction matching (road descriptor + landmark name + geocode-assisted proximity)
      -> rule-set pre-validation v1 -> quality pass (duplicates, conflicts, weak, stale)
      -> review queue ordering

Outputs
  web/public/data/published_timing_plans.v3.json     consumed by the web app
  data/raw/opencity/text/<resource_id>.txt           local plain text (gitignored; not redistributed)
  data/raw/opencity/geocode_cache.json               geocoder responses (polite re-runs)

Usage
  python3 scripts/ingest_opencity_timing.py --pdf-dir /tmp/gw/pdfs --date 2026-09-06 [--no-geocode]
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

PAGE_H = 792.0
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
NUM_RE = re.compile(r"^(\d{1,3})(?:\((\d{1,3})\))?$")
HEADER_RE = re.compile(r"^(?P<name>.+?)\s*,\s*(?P<ps>.+?)\s*POLICE\s*STATION\s*-?\s*(?P<ctl>[A-Z ./]*)$", re.I)
PDF_DATE_RE = re.compile(r"D:(\d{4})(\d{2})(\d{2})")
# CKAN resource ids are UUIDs; anything else from the portal is refused before it can become a file name.
CKAN_RESOURCE_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
CONTROL_MAP = {"FIXED": "fixed", "VAC": "vehicle_actuated", "VA": "vehicle_actuated", "ATCS": "adaptive", "SEMI VAC": "vehicle_actuated", "SYNC": "fixed_coordinated"}
USABLE_CONTROL = {"FIXED", "VAC", "VA", "SYNC"}
JUNCTION_WORDS = {"junction", "circle", "cross", "signal", "gate", "market", "police", "station", "square", "chowk", "flyover", "underpass", "bridge", "stop", "bus", "check", "post"}
# Geocoder hits of these OSM keys are businesses/buildings: sharing the junction's name is not evidence of where the signal is.
NON_JUNCTION_OSM_KEYS = {"shop", "office", "craft", "healthcare", "tourism", "leisure", "building"}
STOP = {"junction", "jn", "junc", "road", "rd", "circle", "cross", "the", "and", "&", "of", "signal", "x", "ft", "feet", "main", "mn", "jct"}
ABBREV = {
    "rd": "road", "orr": "outer ring road", "outer ring rd": "outer ring road", "old airport rd": "hal old airport road",
    "mn": "main", "ft": "feet", "80ft": "80 feet", "100ft": "100 feet", "jn": "", "junction": "", "twds": "", "from": "",
    "kr puram": "krishnarajapura", "k.r.puram": "krishnarajapura", "kr": "", "cmh rd": "cmh road",
}
SPELLING = [("marathalli", "marathahalli"), ("yemlur", "yemalur"), ("yamalur", "yemalur"), ("byappanahalli", "baiyappanahalli"),
            ("nagara", "nagar"), ("palmgroove", "palm grove"), ("shooley", "shoolay"), ("koramangala", "koramangala"), ("bannergatta", "bannerghatta"),
            ("bannerghata", "bannerghatta"), ("hosur rd", "hosur road"), ("tumkur", "tumakuru"), ("mysore", "mysuru"), ("hebbal", "hebbala")]
MOVEMENT_LETTERS = {"L", "S", "R", "U"}
APPROACH_LETTERS = set("ABCDEFGH")

# Currency rule shared with web/src/lib/timing/currency.ts — keep the thresholds identical.
CURRENCY_CURRENT_DAYS = 180
CURRENCY_AGING_DAYS = 365
CURRENCY_RULE = {
    "id": "currency-v1",
    "effective_date": "PDF metadata creation date when present, else the portal resource date",
    "current_max_days": CURRENCY_CURRENT_DAYS,
    "aging_max_days": CURRENCY_AGING_DAYS,
    "statuses": ["current (≤ 180 d)", "aging (181–365 d)", "stale (> 365 d)", "undated (no date at all)"],
    "note": "Even a 'current' document is a snapshot; nothing here is confirmed against the live programme.",
}


def dedouble(s: str) -> str:
    """'BBLLIINNKKIINNGG' -> 'BLINKING' (fonts rendered twice); leaves normal text untouched."""
    if len(s) >= 4 and len(s) % 2 == 0 and all(s[i] == s[i + 1] for i in range(0, len(s), 2)):
        return s[::2]
    return s


def norm(s: str) -> str:
    s = s.lower().replace("×", " x ")
    for a, b in SPELLING:
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    toks = []
    for t in s.split():
        toks.append(ABBREV.get(t, t))
    return re.sub(r"\s+", " ", " ".join(toks)).strip()


def tokens(s: str) -> set:
    return {t for t in norm(s).split() if t and t not in STOP and len(t) > 1}


def token_similarity(a: set, b: set) -> float:
    """Soft Jaccard: tokens match when difflib ratio >= 0.84 (handles transliteration variants)."""
    if not a or not b:
        return 0.0
    matched = 0
    used = set()
    for t in a:
        best, bi = 0.0, None
        for i, u in enumerate(b):
            if i in used:
                continue
            r = difflib.SequenceMatcher(None, t, u).ratio()
            if r > best:
                best, bi = r, i
        if best >= 0.84 and bi is not None:
            matched += 1
            used.add(bi)
    return matched / (len(a) + len(b) - matched)


# ---------------------------------------------------------------------------------------------
# Dating / currency (rule shared with the web app)
# ---------------------------------------------------------------------------------------------
def parse_pdf_date(raw) -> str | None:
    """'D:20100317115245+05'30'' -> '2010-03-17' (date only; the time zone is irrelevant here)."""
    if not raw:
        return None
    m = PDF_DATE_RE.search(str(raw))
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def document_currency(document_date: str | None, portal_date: str | None, as_of: str) -> dict:
    """Explicit currency rule: status + age in days from the effective date to `as_of` (ISO)."""
    eff = document_date or (portal_date[:10] if portal_date else None)
    if not eff:
        return {"status": "undated", "effective_date": None, "effective_date_source": None, "age_days": None, "rule": CURRENCY_RULE["id"]}
    src = "pdf_metadata" if document_date else "portal_resource"
    try:
        age = (date.fromisoformat(as_of[:10]) - date.fromisoformat(eff[:10])).days
    except ValueError:
        return {"status": "undated", "effective_date": eff, "effective_date_source": src, "age_days": None, "rule": CURRENCY_RULE["id"]}
    status = "current" if age <= CURRENCY_CURRENT_DAYS else "aging" if age <= CURRENCY_AGING_DAYS else "stale"
    return {"status": status, "effective_date": eff, "effective_date_source": src, "age_days": age, "rule": CURRENCY_RULE["id"]}


def pdf_metadata(pdf_path: str) -> dict:
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    info = reader.metadata or {}
    with open(pdf_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    text_len = 0
    try:
        text_len = len(reader.pages[0].extract_text() or "")
    except Exception:  # noqa: BLE001
        text_len = 0
    return {
        "creation_date": parse_pdf_date(info.get("/CreationDate")),
        "modification_date": parse_pdf_date(info.get("/ModDate")),
        "title": str(info.get("/Title") or "") or None,
        "creator": str(info.get("/Creator") or "") or None,
        "producer": str(info.get("/Producer") or "") or None,
        "page_count": len(reader.pages),
        "sha256": digest,
        "bytes": os.path.getsize(pdf_path),
        "has_text_layer": text_len > 0,
    }


# ---------------------------------------------------------------------------------------------
# PDF layer
# ---------------------------------------------------------------------------------------------
def positioned_labels(pdf_path: str):
    """pypdf visitor: clean label strings (header, road descriptor, FROM/TWDS) with y from top."""
    from pypdf import PdfReader

    out = []
    reader = PdfReader(pdf_path)
    page = reader.pages[0]

    def visit(text, cm, tm, fd, fs):  # noqa: ANN001
        t = text.strip()
        if not t:
            return
        x = cm[0] * tm[4] + cm[2] * tm[5] + cm[4]
        y = cm[1] * tm[4] + cm[3] * tm[5] + cm[5]
        if round(x) == 0 and round(y) == 0:
            return
        out.append({"top": PAGE_H - y, "x": x, "text": re.sub(r"\s+", " ", t)})

    page.extract_text(visitor_text=visit)
    plain = page.extract_text() or ""
    return out, plain


def parse_header(text: str):
    t = re.sub(r"\s+", " ", text).strip()
    m = HEADER_RE.match(t)
    if not m:
        return None
    ctl = m.group("ctl").strip().upper() or "UNSPECIFIED"
    name = m.group("name").strip(" -,")
    name = re.sub(r"\s*(JUNCTION|JUCTION)\s*$", "", name, flags=re.I).strip(" -,")
    return {"name": name, "police_station": m.group("ps").strip(), "control_label": ctl, "control_type_hint": CONTROL_MAP.get(ctl, "unknown" if ctl in ("UNSPECIFIED",) else ctl.lower())}


def group_by_top(words, tol=3.5):
    rows = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and abs(rows[-1]["top"] - w["top"]) <= tol:
            rows[-1]["words"].append(w)
            rows[-1]["top"] = (rows[-1]["top"] * (len(rows[-1]["words"]) - 1) + w["top"]) / len(rows[-1]["words"])
        else:
            rows.append({"top": w["top"], "words": [w]})
    return rows


def extract_words(pdf_path: str):
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        words = page.extract_words(x_tolerance=1.0, y_tolerance=2.0, extra_attrs=["size"])
    for w in words:
        w["text"] = dedouble(w["text"])
    return words


def extract_panels(pdf_path: str):
    labels, plain = positioned_labels(pdf_path)
    words = extract_words(pdf_path)
    return panels_from_words(words, labels) + (plain,)


def panels_from_words(words, labels):
    """Pure function over positioned words + clean labels (unit-testable without a PDF)."""
    # headers: big words (size >= 8.5) grouped by line containing POLICE/STATION
    big = [w for w in words if w.get("size", 0) >= 8.5]
    headers = []
    for line in group_by_top(big, 4):
        txt = " ".join(w["text"] for w in sorted(line["words"], key=lambda w: w["x0"]))
        if re.search(r"POLICE|STATION|JUNCTION", txt, re.I):
            # prefer the clean pypdf label at the same height when available
            clean = [l for l in labels if abs(l["top"] - line["top"]) < 14 and re.search(r"POLICE\s*STATION", l["text"], re.I)]
            h = parse_header(clean[0]["text"] if clean else txt)
            if h:
                h["top"] = line["top"]
                h["raw"] = clean[0]["text"] if clean else txt
                h["clean_label"] = bool(clean)
                headers.append(h)
    headers.sort(key=lambda h: h["top"])
    if not headers:
        return [], "no_junction_header_found"
    # panel ranges: with two headers, split at the midpoint between them (top header sits above its
    # table, bottom header sits below its table, so the tables occupy the halves)
    if len(headers) == 1:
        ranges = [(0, PAGE_H)]
    else:
        mid = (headers[0]["top"] + headers[-1]["top"]) / 2 if len(headers) == 2 else PAGE_H / 2
        ranges = [(0, mid), (mid, PAGE_H)]
        if len(headers) > 2:
            headers = [headers[0], headers[-1]]
    panels = []
    for h, (y0, y1) in zip(headers, ranges):
        pw = [w for w in words if y0 <= w["top"] < y1]
        pl = [l for l in labels if y0 <= l["top"] < y1]
        panels.append(parse_panel(h, pw, pl))
    return panels, "ok"


def _pedestrian_phase_index(words, lines, header_line, phase_cols):
    """
    The all-red / exclusive pedestrian stage is marked by a vertical 'EXCLUSIVE PEDESTRIAN' label
    inside that phase's column. Horizontal text is matched directly; rotated text arrives as a
    column of tiny one- or two-letter words at the same x, which is matched by shape (≥ 6 tiny
    fragments stacked over ≥ 25 pt) and must sit within 15 pt of a phase column centre.
    """
    if not phase_cols:
        return None
    exclusive_words = [w for w in words if w["text"].upper().startswith("EXCLUSIVE")]
    if exclusive_words:
        # horizontal label: the column whose centre is nearest the label's centre (the label is printed
        # inside its column); fall back to the last column left of the label when nothing is close
        ex0 = min(w["x0"] for w in exclusive_words)
        ex1 = max(w["x1"] for w in exclusive_words)
        cx = (ex0 + ex1) / 2
        d, idx = min((abs(c["x"] - cx), i) for i, c in enumerate(phase_cols))
        if d <= 40:
            return idx
        left = [i for i, c in enumerate(phase_cols) if c["x"] < ex0]
        return left[-1] if left else None
    if not header_line:
        return None
    times = [ln["top"] for ln in lines if sum(1 for w in ln["words"] if TIME_RE.match(w["text"])) >= 2]
    y0 = header_line["top"]
    y1 = min(times) if times else y0 + 130
    tiny = [w for w in words if y0 < w["top"] < y1 and w.get("size", 9) <= 5.6 and len(w["text"]) <= 2 and w["text"].isalpha()]
    columns: dict[int, list] = {}
    for w in tiny:
        columns.setdefault(round(w["x0"] / 6), []).append(w)
    best = None
    for ws in columns.values():
        if len(ws) < 6:
            continue
        tops = [w["top"] for w in ws]
        if max(tops) - min(tops) < 25:
            continue
        x = sum(w["x0"] for w in ws) / len(ws)
        d, idx = min((abs(c["x"] - x), i) for i, c in enumerate(phase_cols))
        if d <= 15 and (best is None or len(ws) > best[0]):
            best = (len(ws), idx)
    return best[1] if best else None


def _movement_matrix(lines, header_line, phase_cols, first_row_top):
    """
    The document's own approach/phase labels: rows A, B, C, D (ROAD column) with the landmark of the
    approach (FROM …) and the movement letters L / S / R placed under the phase columns in which
    that approach moves. Letters are the document's labels — mapping A–D to compass approaches is a
    reviewer task; nothing here feeds the models automatically.
    """
    if not header_line or not phase_cols:
        return [], 0.0
    road = next((w for w in header_line["words"] if w["text"] == "ROAD"), None)
    if not road:
        return [], 0.0
    road_cx = (road["x0"] + road["x1"]) / 2
    first_col_x = min(c["x"] for c in phase_cols)
    y0 = header_line["top"] + 4
    y1 = first_row_top - 4 if first_row_top is not None else header_line["top"] + 130
    region = [w for ln in lines for w in ln["words"] if y0 < w["top"] < y1]
    letters = sorted(
        [w for w in region if w["text"] in APPROACH_LETTERS and w.get("size", 0) >= 6.0 and abs((w["x0"] + w["x1"]) / 2 - road_cx) <= 20],
        key=lambda w: w["top"],
    )
    rows = []
    for i, lw in enumerate(letters):
        top = lw["top"]
        nxt = letters[i + 1]["top"] if i + 1 < len(letters) else y1
        band_hi = min(nxt - 2, top + 22)
        landmark_words = [w for w in region if top - 6 <= w["top"] < band_hi and road["x1"] - 2 <= w["x0"] < first_col_x - 22 and w["text"] not in APPROACH_LETTERS and w.get("size", 0) < 7.0]
        landmark_words.sort(key=lambda w: (round(w["top"] / 6), w["x0"]))
        landmark = " ".join(dedouble(w["text"]) for w in landmark_words).strip()
        moves: dict[int, list[str]] = {}
        for w in region:
            if w["text"] not in MOVEMENT_LETTERS or w.get("size", 0) < 6.0 or not (top - 5 <= w["top"] < band_hi):
                continue
            xc = (w["x0"] + w["x1"]) / 2
            if xc < first_col_x - 26:
                continue
            best_i, best_d = None, 1e9
            for ci, c in enumerate(phase_cols):
                d = abs(c["x"] - xc)
                if d < best_d:
                    best_i, best_d = ci, d
            if best_i is not None and best_d <= 26:
                moves.setdefault(best_i, [])
                if w["text"] not in moves[best_i]:
                    moves[best_i].append(w["text"])
        rows.append({"letter": lw["text"], "landmark": landmark or None, "movements_by_phase": {str(k): sorted(v, key="LSRU".index) for k, v in sorted(moves.items())}})
    if len(rows) < 2:
        return rows, 0.0 if not rows else 0.3
    with_moves = sum(1 for r in rows if r["movements_by_phase"])
    conf = round(0.5 * with_moves / len(rows) + 0.3 * (1 if all(r["landmark"] for r in rows) else 0.5) + 0.2, 2)
    return rows, min(conf, 1.0)


def parse_panel(header, words, labels):
    lines = group_by_top(words, 3.5)
    # phase columns: digits on the 'ROAD FROM 1 2 3' line (may spill onto a neighbouring line)
    phase_cols = []
    cycle_x = None
    for ln in lines:
        txt = [w["text"] for w in ln["words"]]
        if "CYCLE" in txt:
            cw = next(w for w in ln["words"] if w["text"] == "CYCLE")
            cycle_x = (cw["x0"] + cw["x1"]) / 2
    header_line = next((ln for ln in lines if any(w["text"] in ("ROAD", "FROM") for w in ln["words"]) and any(w["text"].isdigit() and len(w["text"]) == 1 for w in ln["words"])), None)
    if header_line:
        cand = [w for ln in lines if abs(ln["top"] - header_line["top"]) <= 6 for w in ln["words"] if w["text"].isdigit() and len(w["text"]) == 1 and 1 <= int(w["text"]) <= 9]
        cand.sort(key=lambda w: w["x0"])
        seen = set()
        for w in cand:
            if w["text"] in seen:
                continue
            seen.add(w["text"])
            phase_cols.append({"n": int(w["text"]), "x": (w["x0"] + w["x1"]) / 2})
        phase_cols.sort(key=lambda c: c["n"])
    n_phases = len(phase_cols)
    descriptor = next((l["text"] for l in labels if re.search(r"\b[A-Z][A-Z. ]+ X [A-Z]", l["text"]) and "POLICE" not in l["text"]), None)
    approaches = sorted({re.sub(r"^(FROM|TWDS)\s*", "", l["text"]).strip() for l in labels if re.match(r"^(FROM|TWDS)\s+\S", l["text"])})
    ped_phase_idx = _pedestrian_phase_index(words, lines, header_line, phase_cols)

    rows = []
    for ln in lines:
        ws = sorted(ln["words"], key=lambda w: w["x0"])
        times = [w for w in ws if TIME_RE.match(w["text"])]
        if len(times) < 2:
            continue
        near = [w for l2 in lines if abs(l2["top"] - ln["top"]) <= 4.5 for w in l2["words"]]
        near.sort(key=lambda w: w["x0"])
        label_tokens = {w["text"].upper() for w in near if not TIME_RE.match(w["text"]) and not NUM_RE.match(w["text"])}
        blinking = any("BLINK" in t for t in label_tokens)
        phases = [None] * n_phases
        alternates = [None] * n_phases
        cycle = None
        unassigned = []
        t_x1 = max(w["x1"] for w in times[:2])
        for w in near:
            m = NUM_RE.match(w["text"])
            if not m or w["x0"] < t_x1 - 1:
                continue
            xc = (w["x0"] + w["x1"]) / 2
            val = int(m.group(1))
            alt = int(m.group(2)) if m.group(2) else None
            best_i, best_d = None, 1e9
            for i, c in enumerate(phase_cols):
                d = abs(c["x"] - xc)
                if d < best_d:
                    best_i, best_d = i, d
            cyc_d = abs(cycle_x - xc) if cycle_x is not None else 1e9
            if cyc_d < best_d and cyc_d <= 22:
                cycle = val
            elif best_i is not None and best_d <= 22 and phases[best_i] is None:
                phases[best_i] = val
                alternates[best_i] = alt
            else:
                unassigned.append(val)
        # fallback for panels without detectable column headers: positional order
        if n_phases == 0:
            nums = [int(NUM_RE.match(w["text"]).group(1)) for w in near if NUM_RE.match(w["text"]) and w["x0"] >= t_x1 - 1]
            if len(nums) >= 3 and nums[-1] >= 30 and abs(sum(nums[:-1]) - nums[-1]) <= 3:
                phases, cycle, alternates = nums[:-1], nums[-1], [None] * (len(nums) - 1)
            elif len(nums) >= 2:
                phases, alternates = nums, [None] * len(nums)
            unassigned = []
        present = [p for p in phases if p is not None]
        cycle_source = None
        consistent = None
        flags = []
        if blinking:
            mode = "blinking"
        elif not present:
            mode = "unknown"
        else:
            mode = "timed"
            if cycle is not None:
                if len(present) == len(phases):
                    diff = cycle - sum(present)
                    consistent = abs(diff) <= 3
                    cycle_source = "stated_in_row"
                    if not consistent:
                        flags.append(f"cycle_mismatch_{diff:+d}s")
                elif len(present) == len(phases) - 1:
                    missing = cycle - sum(present)
                    if 3 <= missing <= 200:
                        i = phases.index(None)
                        phases[i] = missing
                        flags.append("one_phase_inferred_from_cycle")
                        consistent = True
                        cycle_source = "stated_in_row"
                    else:
                        flags.append("incomplete_row")
                else:
                    flags.append("incomplete_row")
            else:
                if len(present) == len(phases) and len(present) >= 2:
                    cycle = sum(present)
                    cycle_source = "sum_of_phases"
                    consistent = True
                else:
                    flags.append("incomplete_row")
            if cycle is not None and not (30 <= cycle <= 400):
                flags.append("cycle_out_of_range")
            if any(p is not None and p > 200 for p in phases):
                flags.append("phase_over_200s")
        if unassigned:
            flags.append("unassigned_numbers")
        start, end = times[0]["text"], times[1]["text"]
        if len(start) == 4:
            start = "0" + start
        if len(end) == 4:
            end = "0" + end
        ped_s = phases[ped_phase_idx] if (ped_phase_idx is not None and ped_phase_idx < len(phases)) else None
        rows.append({
            "top": ln["top"],
            "start": start,
            "end": end,
            "mode": mode,
            "phases": phases,
            "alternates": alternates,
            "cycle_s": cycle,
            "cycle_source": cycle_source,
            "consistent": consistent,
            "pedestrian_phase_s": ped_s if mode == "timed" else None,
            "labels": sorted(t for t in label_tokens if t not in {"TIMINGS", "DATA"}),
            "flags": flags,
            "unassigned": unassigned,
            "raw": " ".join(w["text"] for w in near),
        })
    rows.sort(key=lambda r: r["top"])
    first_row_top = rows[0]["top"] if rows else None
    approach_rows, matrix_conf = _movement_matrix(lines, header_line, phase_cols, first_row_top)
    phase_labels = []
    for ci in range(n_phases):
        parts = [f"{r['letter']}·{''.join(r['movements_by_phase'][str(ci)])}" for r in approach_rows if str(ci) in r["movements_by_phase"]]
        if ci == ped_phase_idx:
            parts.append("pedestrian (EXCLUSIVE)")
        phase_labels.append(" + ".join(parts) if parts else None)
    # day groups: a new group starts when the start time goes backwards
    groups = []
    for r in rows:
        if groups and r["start"] < groups[-1]["rows"][-1]["end"] and r["start"] <= groups[-1]["rows"][-1]["start"]:
            groups.append({"rows": [r]})
        elif not groups:
            groups.append({"rows": [r]})
        else:
            groups[-1]["rows"].append(r)
    day_labels = [(l["top"], l["text"].upper()) for l in labels if re.search(r"SUNDAY|SATURDAY|WEEKDAY|HOLIDAY", l["text"], re.I) and not re.search(r"\d{2}:\d{2}", l["text"])]
    for w in words:
        if re.search(r"SUNDAY|SATURDAY|WEEKDAY|HOLIDAY", w["text"], re.I):
            day_labels.append((w["top"], w["text"].upper()))
    day_plans = []
    for gi, g in enumerate(groups):
        tops = [r["top"] for r in g["rows"]]
        lo, hi = min(tops) - 8, max(tops) + 8
        inline = " ".join(" ".join(r["labels"]) for r in g["rows"])
        nearby = " ".join(t for top, t in day_labels if lo <= top <= hi)
        lab = (inline + " " + nearby).upper()
        if "SUNDAY" in lab and ("WEEKDAY" in lab or "&" in lab):
            day_type = "all_days"
        elif "SUNDAY" in lab and "SATURDAY" in lab:
            day_type = "weekend"
        elif "SUNDAY" in lab:
            day_type = "sunday"
        elif "SATURDAY" in lab:
            day_type = "saturday"
        elif "HOLIDAY" in lab:
            day_type = "holiday"
        else:
            day_type = "weekday_default" if gi == 0 else "unlabelled_group"
        windows = []
        for r in g["rows"]:
            windows.append({k: v for k, v in r.items() if k != "top"})
        ordered = all(windows[i]["end"] <= windows[i + 1]["start"] for i in range(len(windows) - 1))
        day_plans.append({"day_type": day_type, "windows": windows, "windows_ordered": ordered})
    panel = {
        "header": header,
        "descriptor": descriptor,
        "approach_landmarks": approaches,
        "phase_count": n_phases,
        "pedestrian_phase_index": ped_phase_idx,
        "phase_labels": phase_labels,
        "approach_rows": approach_rows,
        "movement_matrix_confidence": matrix_conf,
        "day_plans": day_plans,
        "row_count": len(rows),
    }
    panel["parse_confidence"], panel["parse_confidence_components"] = parse_confidence(panel)
    return panel


def parse_confidence(panel) -> tuple[float, dict]:
    """How much of the document the parser could read unambiguously — NOT how current or how well matched it is."""
    timed = [w for dp in panel["day_plans"] for w in dp["windows"] if w["mode"] == "timed"]
    rows = [w for dp in panel["day_plans"] for w in dp["windows"]]
    comp = {
        "header_parsed": 1.0 if panel["header"].get("clean_label", True) else 0.6,
        "phase_columns_detected": 1.0 if panel["phase_count"] >= 2 else 0.0,
        "timed_rows_present": 1.0 if timed else 0.0,
        "rows_consistent": (sum(1 for w in timed if w["consistent"] is True) / len(timed)) if timed else 0.0,
        "rows_without_unassigned_numbers": (sum(1 for w in rows if not w["unassigned"]) / len(rows)) if rows else 0.0,
        "day_groups_labelled": 1.0 if panel["day_plans"] and all(dp["day_type"] != "unlabelled_group" for dp in panel["day_plans"]) else (0.0 if panel["day_plans"] else 0.0),
        "road_descriptor_found": 1.0 if panel["descriptor"] else 0.0,
    }
    weights = {"header_parsed": 0.15, "phase_columns_detected": 0.2, "timed_rows_present": 0.15, "rows_consistent": 0.25, "rows_without_unassigned_numbers": 0.1, "day_groups_labelled": 0.1, "road_descriptor_found": 0.05}
    score = sum(weights[k] * comp[k] for k in weights)
    return round(score, 3), {k: round(v, 3) for k, v in comp.items()}


# ---------------------------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------------------------
def haversine(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


class Geocoder:
    def __init__(self, cache_path: str, enabled: bool):
        self.path = cache_path
        self.enabled = enabled
        self.cache = json.load(open(cache_path)) if cache_path and os.path.exists(cache_path) else {}
        self.last = 0.0

    def save(self):
        if self.path:
            with open(self.path, "w") as fh:
                json.dump(self.cache, fh, indent=0)

    def query(self, q: str):
        if q in self.cache:
            return self.cache[q]
        if not self.enabled:
            return None
        wait = 1.1 - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        res = None
        for provider in ("photon", "nominatim"):
            try:
                if provider == "photon":
                    url = "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": q, "limit": 3, "bbox": "77.38,12.78,77.82,13.18", "lang": "en"})
                    req = urllib.request.Request(url, headers={"User-Agent": "theTraffic-Bengaluru/0.3 research ingest"})
                    js = json.load(urllib.request.urlopen(req, timeout=20))
                    feats = js.get("features", [])
                    if feats:
                        f = feats[0]
                        res = {"provider": "photon", "lat": f["geometry"]["coordinates"][1], "lon": f["geometry"]["coordinates"][0], "label": f["properties"].get("name"), "osm": f"{f['properties'].get('osm_key')}={f['properties'].get('osm_value')}"}
                        break
                else:
                    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 1, "viewbox": "77.38,13.18,77.82,12.78", "bounded": 1})
                    req = urllib.request.Request(url, headers={"User-Agent": "theTraffic-Bengaluru/0.3 research ingest"})
                    js = json.load(urllib.request.urlopen(req, timeout=20))
                    if js:
                        res = {"provider": "nominatim", "lat": float(js[0]["lat"]), "lon": float(js[0]["lon"]), "label": js[0].get("display_name", "")[:80], "osm": js[0].get("type")}
                        break
            except Exception as e:  # noqa: BLE001
                res = None
                print("  geocode error", provider, q, type(e).__name__, file=sys.stderr)
        self.cache[q] = res
        return res


def descriptor_roads(desc: str | None):
    if not desc:
        return []
    d = re.sub(r"\bJN\b|\bJUNCTION\b", "", desc, flags=re.I)
    parts = [p.strip(" .-") for p in re.split(r"\s+X\s+", d) if p.strip()]
    return parts


def build_inter_index(inters):
    return [
        {
            "id": it["id"],
            "canonical_name": it["canonical_name"],
            "lat": it["lat"],
            "lon": it["lon"],
            "road_names": it.get("road_names", []),
            "toks": tokens(it["canonical_name"]) | set().union(*[tokens(r) for r in it.get("road_names", [])]) if it.get("road_names") else tokens(it["canonical_name"]),
            "importance": corridor_importance(it),
            "approaches": it.get("approaches", []),
        }
        for it in inters
    ]


def match_junction(panel, inter_index, geocoder: Geocoder):
    h = panel["header"]
    roads = descriptor_roads(panel["descriptor"])
    name_toks = tokens(h["name"])
    road_toks = [tokens(r) for r in roads]
    land_toks = set()
    for a in panel["approach_landmarks"]:
        land_toks |= tokens(a)
    cands = []
    for it in inter_index:
        s_name = token_similarity(name_toks, it["toks"])
        s_roads = 0.0
        if road_toks:
            per = [max([token_similarity(rt, tokens(rn)) for rn in it["road_names"]] + [0.0]) for rt in road_toks]
            s_roads = sum(per) / len(per)
        score = max(s_name, 0.85 * s_roads + 0.15 * s_name)
        if score > 0:
            cands.append({"intersection_id": it["id"], "canonical_name": it["canonical_name"], "lat": it["lat"], "lon": it["lon"], "name_similarity": round(s_name, 3), "road_similarity": round(s_roads, 3), "score": round(score, 3)})
    cands.sort(key=lambda c: -c["score"])
    geo = None
    geo_untrusted = None
    queries = []
    if roads:
        queries.append(f"{roads[0]} and {roads[1]}, Bengaluru" if len(roads) > 1 else f"{roads[0]}, Bengaluru")
    queries.append(f"{h['name']} junction, Bengaluru")
    queries.append(f"{h['name']}, Bengaluru")
    for q in queries:
        geo = geocoder.query(q)
        if geo:
            geo = {**geo, "query": q}
            break
    # A geocoder hit is only trusted as junction evidence when its label relates to the junction
    # (shares a token with the name/roads/landmarks or is itself a junction-type feature); a shop or
    # clinic that happens to share the name is NOT evidence of where the signal is.
    if geo:
        label = geo.get("label") or ""
        lab_toks = tokens(label)
        raw_words = set(re.sub(r"[^a-z ]", " ", label.lower()).split())
        osm = geo.get("osm") or ""
        junction_like = bool(raw_words & JUNCTION_WORDS) or osm.startswith("highway=") or osm.startswith("junction=")
        shares_name = token_similarity(lab_toks, name_toks | set().union(*road_toks) if road_toks else name_toks) > 0
        is_business = osm.split("=")[0] in NON_JUNCTION_OSM_KEYS
        related = junction_like or (shares_name and not is_business)
        geo = {**geo, "trusted": related}
        if not related:
            geo_untrusted = geo
            geo = None
    spatial = []
    if geo:
        for it in inter_index:
            d = haversine(geo["lat"], geo["lon"], it["lat"], it["lon"])
            if d <= 300:
                spatial.append({"intersection_id": it["id"], "canonical_name": it["canonical_name"], "distance_m": round(d)})
        spatial.sort(key=lambda s: s["distance_m"])
    # combine: geocode proximity is strong evidence when the name/roads also agree at all
    combined = {}
    for c in cands[:8]:
        combined[c["intersection_id"]] = {**c, "distance_m": None, "combined": c["score"]}
    for s in spatial[:5]:
        prox = max(0.0, 1 - s["distance_m"] / 300)
        e = combined.get(s["intersection_id"])
        if e:
            e["distance_m"] = s["distance_m"]
            e["combined"] = round(min(1.0, e["score"] + 0.5 * prox), 3)
        else:
            it = next(i for i in inter_index if i["id"] == s["intersection_id"])
            combined[s["intersection_id"]] = {"intersection_id": it["id"], "canonical_name": it["canonical_name"], "lat": it["lat"], "lon": it["lon"], "name_similarity": 0.0, "road_similarity": 0.0, "score": 0.0, "distance_m": s["distance_m"], "combined": round(0.45 * prox, 3)}
    ranked = sorted(combined.values(), key=lambda c: -c["combined"])
    best = ranked[0] if ranked else None
    second = ranked[1]["combined"] if len(ranked) > 1 else 0.0
    tier = "none"
    if best:
        strong_name = best["road_similarity"] >= 0.6 or best["name_similarity"] >= 0.75
        near = best["distance_m"] is not None and best["distance_m"] <= 90
        very_near = best["distance_m"] is not None and best["distance_m"] <= 40
        margin = best["combined"] - second
        if (strong_name and near) or (best["road_similarity"] >= 0.8 and margin >= 0.15) or (very_near and best["name_similarity"] >= 0.5 and margin >= 0.2):
            tier = "strong"
        elif strong_name or (near and best["score"] >= 0.25) or best["combined"] >= 0.6:
            tier = "moderate"
        elif best["combined"] >= 0.3:
            tier = "weak"
    return {"candidates": ranked[:5], "best": best, "second_best_combined": second, "tier": tier, "geocode": geo or geo_untrusted, "descriptor_roads": roads}


# ---------------------------------------------------------------------------------------------
# Rule set v1 — PRE-VALIDATION ONLY (never verification)
# ---------------------------------------------------------------------------------------------
def prevalidate(panel, match):
    """
    Explicit, reproducible criteria. Passing them makes a block `pre_validated`: it goes to the top
    of the review queue with a green checklist. It does not accept a junction link and it never
    affects recommendations — only an explicit committed decision does (web/src/lib/data/dataset.ts).
    """
    criteria = {}
    h = panel["header"]
    criteria["control_label_usable"] = h["control_label"] in USABLE_CONTROL
    timed = [w for dp in panel["day_plans"] for w in dp["windows"] if w["mode"] == "timed"]
    complete = [w for w in timed if w["consistent"] is True and not any(f.startswith("incomplete") or f.startswith("cycle_mismatch") or f == "cycle_out_of_range" for f in w["flags"]) and w["cycle_s"] and 40 <= w["cycle_s"] <= 300]
    criteria["has_complete_consistent_row"] = len(complete) > 0
    criteria["all_timed_rows_consistent"] = len(timed) > 0 and all(w["consistent"] is True for w in timed)
    criteria["windows_ordered"] = all(dp["windows_ordered"] for dp in panel["day_plans"]) if panel["day_plans"] else False
    criteria["phase_columns_detected"] = panel["phase_count"] >= 2
    criteria["match_strong"] = match["tier"] == "strong"
    criteria["match_at_least_moderate"] = match["tier"] in ("strong", "moderate")
    criteria["no_unlabelled_groups"] = all(dp["day_type"] != "unlabelled_group" for dp in panel["day_plans"])
    score = 0.0
    score += 0.35 if criteria["match_strong"] else (0.15 if criteria["match_at_least_moderate"] else 0.0)
    score += 0.25 if criteria["has_complete_consistent_row"] else 0.0
    score += 0.15 if criteria["all_timed_rows_consistent"] else 0.0
    score += 0.10 if criteria["windows_ordered"] else 0.0
    score += 0.10 if criteria["control_label_usable"] else 0.0
    score += 0.05 if criteria["phase_columns_detected"] and criteria["no_unlabelled_groups"] else 0.0
    passed = criteria["match_strong"] and criteria["has_complete_consistent_row"] and criteria["windows_ordered"] and criteria["control_label_usable"] and criteria["phase_columns_detected"] and criteria["no_unlabelled_groups"]
    reasons = [k for k, v in criteria.items() if not v]
    return {
        "status": "rule_set_passed" if passed else "needs_review",
        "score": round(score, 2),
        "criteria": criteria,
        "blocking": reasons,
        "rule_set": "v1",
        "complete_windows": len(complete),
        "timed_windows": len(timed),
    }


def review_state(ver, match, quality_flags):
    """Reviewer-facing state. `affects_recommendations` is always False at ingest time."""
    blocked_by_quality = [f for f in quality_flags if f in ("duplicate", "conflicting_timings", "conflicting_target")]
    passed = ver["status"] == "rule_set_passed" and not blocked_by_quality
    best = match["best"]
    return {
        "status": "pre_validated" if passed else "pending_review",
        "rule_set": ver["rule_set"],
        "rule_set_passed": ver["status"] == "rule_set_passed",
        "blocking": ver["blocking"] + blocked_by_quality,
        "proposed_intersection_id": best["intersection_id"] if best and match["tier"] in ("strong", "moderate") else None,
        "requires_explicit_review_decision": True,
        "affects_recommendations": False,
    }


# ---------------------------------------------------------------------------------------------
# Quality pass over every block: duplicates, conflicts, weak matches, stale documents
# ---------------------------------------------------------------------------------------------
def timing_signature(day_plans) -> str:
    return json.dumps(sorted([dp["day_type"], w["start"], w["end"], w["phases"], w["cycle_s"]] for dp in day_plans for w in dp["windows"] if w["mode"] == "timed"), sort_keys=True)


def quality_pass(blocks):
    """
    blocks: list of dicts with junction_key, original_junction_name, police_station, day_plans,
    match (tier/best), document_currency. Mutates each block: quality_flags, duplicate_of,
    conflicts_with. Rules:
      duplicate           same normalised name + police station AND identical timing signature
      conflicting_timings same normalised name + police station, different timing signature
      conflicting_target  different junction names whose strong/moderate match proposes the same
                          intersection with different timings
      weak_match          tier weak or none
      stale_document      currency status stale; undated_document when no date at all
    """
    for b in blocks:
        b["quality_flags"] = []
        b["duplicate_of"] = None
        b["conflicts_with"] = []
        b["_sig"] = timing_signature(b["day_plans"])
        b["_name_key"] = f"{norm(b['original_junction_name'])}|{norm(b['police_station'])}"
    by_name: dict[str, list] = {}
    for b in blocks:
        by_name.setdefault(b["_name_key"], []).append(b)
    for group in by_name.values():
        if len(group) < 2:
            continue
        group.sort(key=lambda b: b["junction_key"])
        canonical_by_sig: dict[str, dict] = {}
        for b in group:
            if b["_sig"] in canonical_by_sig and b["_sig"] != "[]":
                b["duplicate_of"] = canonical_by_sig[b["_sig"]]["junction_key"]
                b["quality_flags"].append("duplicate")
            else:
                canonical_by_sig.setdefault(b["_sig"], b)
        sigs = {b["_sig"] for b in group if b["_sig"] != "[]"}
        if len(sigs) > 1:
            for b in group:
                if b["_sig"] == "[]":
                    continue
                others = [o["junction_key"] for o in group if o is not b and o["_sig"] != b["_sig"] and o["_sig"] != "[]"]
                if others:
                    b["conflicts_with"].extend(others)
                    b["quality_flags"].append("conflicting_timings")
    by_target: dict[str, list] = {}
    for b in blocks:
        best = b["match"]["best"]
        if best and b["match"]["tier"] in ("strong", "moderate") and b["_sig"] != "[]" and not b["duplicate_of"]:
            by_target.setdefault(best["intersection_id"], []).append(b)
    for group in by_target.values():
        if len({b["_name_key"] for b in group}) < 2 or len({b["_sig"] for b in group}) < 2:
            continue
        for b in group:
            others = [o["junction_key"] for o in group if o is not b and o["_sig"] != b["_sig"]]
            if others:
                b["conflicts_with"].extend(k for k in others if k not in b["conflicts_with"])
                if "conflicting_target" not in b["quality_flags"]:
                    b["quality_flags"].append("conflicting_target")
    for b in blocks:
        if b["match"]["tier"] in ("weak", "none"):
            b["quality_flags"].append("weak_match")
        cur = b.get("document_currency", {}).get("status")
        if cur == "stale":
            b["quality_flags"].append("stale_document")
        elif cur == "undated":
            b["quality_flags"].append("undated_document")
        b["quality_flags"] = sorted(set(b["quality_flags"]))
        b.pop("_sig", None)
        b.pop("_name_key", None)
    return blocks


# ---------------------------------------------------------------------------------------------
def corridor_importance(it):
    rank = {"motorway": 5, "trunk": 5, "primary": 4, "secondary": 3, "tertiary": 2}
    return max([rank.get((a.get("highway") or "").replace("_link", ""), 1) for a in it.get("approaches", [])] + [1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    ap.add_argument("--date", required=True, help="retrieval date (YYYY-MM-DD); package_show_<date>.json must exist")
    ap.add_argument("--intersections", default="web/public/data/intersections.v1.json")
    ap.add_argument("--out", default="web/public/data/published_timing_plans.v3.json")
    ap.add_argument("--no-geocode", action="store_true")
    args = ap.parse_args()

    pkg = json.load(open(f"data/raw/opencity/package_show_{args.date}.json"))["result"]
    inters = json.load(open(args.intersections))["intersections"]
    inter_index = build_inter_index(inters)
    geocoder = Geocoder("data/raw/opencity/geocode_cache.json", enabled=not args.no_geocode)
    os.makedirs("data/raw/opencity/text", exist_ok=True)
    retrieved_at = f"{args.date}T02:31:00Z"

    sources = []
    stats = {
        "sources": 0, "junction_blocks_detected": 0, "timing_rows_detected": 0, "rows_with_stated_cycle": 0, "complete_consistent_rows": 0,
        "pre_validated": 0, "pending_review": 0, "parse_failures": 0, "image_only_documents": 0,
        "match_tiers": {"strong": 0, "moderate": 0, "weak": 0, "none": 0},
        "document_currency": {"current": 0, "aging": 0, "stale": 0, "undated": 0},
        "document_creation_years": {},
        "quality_flags": {},
        "blocks_with_movement_matrix": 0,
    }
    all_blocks = []
    for res in pkg["resources"]:
        rid = res["id"]
        # The id comes from the portal's JSON and becomes a file name below: only a CKAN UUID may pass, so a
        # spoofed or corrupted response can never write outside data/raw/opencity ("../" is not a UUID).
        if not isinstance(rid, str) or not CKAN_RESOURCE_ID.fullmatch(rid):
            raise ValueError(f"resource id {rid!r} is not a CKAN UUID; refusing to use it as a file name")
        pdf = os.path.join(args.pdf_dir, f"{rid}.pdf")
        entry = {
            "source_id": rid,
            "source_type": "published_timing_plan",
            "source_kind": "published",
            "source_name": res["name"],
            "publisher": pkg.get("organization", {}).get("title", "Bengaluru Traffic Police (BTP)"),
            "portal": "OpenCity (data.opencity.in)",
            "dataset_url": "https://data.opencity.in/dataset/bengaluru-city-traffic-signal-data",
            "source_reference": res["url"],
            "resource_page": f"https://data.opencity.in/dataset/bengaluru-city-traffic-signal-data/resource/{rid}",
            "format": res.get("format"),
            "published_at": res.get("created"),
            "portal_last_modified": res.get("last_modified"),
            "document_date": None,
            "document_metadata": None,
            "document_currency": None,
            "retrieved_at": retrieved_at,
            "license_notes": pkg.get("license_title") or "Licence not stated on portal — treat as reference material; verify before redistribution",
            "extraction_method": "pdfplumber word positions + pypdf labels; panel split by header position; column assignment by x; day groups by y; movement matrix by letter position (ingest v3)",
            "junctions": [],
            "parse_status": "ok",
        }
        stats["sources"] += 1
        if not os.path.exists(pdf) or os.path.getsize(pdf) < 500:
            entry["parse_status"] = "missing_pdf"
            stats["parse_failures"] += 1
            sources.append(entry)
            continue
        try:
            meta = pdf_metadata(pdf)
        except Exception as e:  # noqa: BLE001
            meta = {"creation_date": None, "modification_date": None, "title": None, "creator": None, "producer": None, "page_count": None, "sha256": None, "bytes": os.path.getsize(pdf), "has_text_layer": False, "error": f"{type(e).__name__}: {e}"[:120]}
        entry["document_metadata"] = meta
        entry["document_date"] = meta.get("creation_date")
        entry["document_currency"] = document_currency(entry["document_date"], entry["published_at"], args.date)
        stats["document_currency"][entry["document_currency"]["status"]] += 1
        y = (entry["document_date"] or "unknown")[:4]
        stats["document_creation_years"][y] = stats["document_creation_years"].get(y, 0) + 1
        try:
            panels, status, plain = extract_panels(pdf)
        except Exception as e:  # noqa: BLE001
            entry["parse_status"] = f"extract_error: {type(e).__name__}: {e}"[:160]
            stats["parse_failures"] += 1
            sources.append(entry)
            continue
        with open(f"data/raw/opencity/text/{rid}.txt", "w") as f:
            f.write(plain)
        if status != "ok" and not meta.get("has_text_layer"):
            status = "image_only_no_text_layer"
            stats["image_only_documents"] += 1
        entry["parse_status"] = status
        for pi, panel in enumerate(panels):
            match = match_junction(panel, inter_index, geocoder)
            ver = prevalidate(panel, match)
            stats["junction_blocks_detected"] += 1
            stats["match_tiers"][match["tier"]] += 1
            for dp in panel["day_plans"]:
                for w in dp["windows"]:
                    stats["timing_rows_detected"] += 1
                    if w["cycle_source"] == "stated_in_row":
                        stats["rows_with_stated_cycle"] += 1
            stats["complete_consistent_rows"] += ver["complete_windows"]
            if panel["approach_rows"]:
                stats["blocks_with_movement_matrix"] += 1
            best = match["best"]
            importance = next((i["importance"] for i in inter_index if best and i["id"] == best["intersection_id"]), 1)
            priority = round(ver["score"] * 0.6 + (importance / 5) * 0.25 + (0.15 if ver["complete_windows"] > 0 else 0), 3)
            # Publish normalized facts, not near-verbatim OCR rows or headers from the source sheets.
            public_day_plans = [
                {
                    **dp,
                    "windows": [
                        {k: v for k, v in window.items() if k not in {"raw", "labels", "unassigned"}}
                        for window in dp["windows"]
                    ],
                }
                for dp in panel["day_plans"]
            ]
            block = {
                "junction_key": f"{rid}#{pi}",
                "source_id": rid,
                "panel_index": pi,
                "original_junction_name": panel["header"]["name"],
                "police_station": panel["header"]["police_station"],
                "control_label_in_document": panel["header"]["control_label"],
                "control_type_hint": panel["header"]["control_type_hint"],
                "road_descriptor": panel["descriptor"],
                "approach_landmarks": panel["approach_landmarks"],
                "phase_count": panel["phase_count"],
                "pedestrian_phase_index": panel["pedestrian_phase_index"],
                "phase_labels": panel["phase_labels"],
                "approach_rows": panel["approach_rows"],
                "movement_matrix_confidence": panel["movement_matrix_confidence"],
                "day_plans": public_day_plans,
                "parse_confidence": panel["parse_confidence"],
                "parse_confidence_components": panel["parse_confidence_components"],
                "match": match,
                "verification": ver,
                "review": None,  # filled after the quality pass
                "document_date": entry["document_date"],
                "published_at": entry["published_at"],
                "retrieved_at": retrieved_at,
                "document_currency": entry["document_currency"],
                "review_priority": priority,
                "corridor_importance": importance,
                "notes": "Letters A–D and the L/S/R movement matrix are the document's own labels; mapping them to compass approaches is a separate review action. Offsets are never published; only cycle structure is used, and only after a committed decision accepts the junction link.",
            }
            entry["junctions"].append(block)
            all_blocks.append(block)
        sources.append(entry)
    geocoder.save()

    quality_pass(all_blocks)
    for b in all_blocks:
        b["review"] = review_state(b["verification"], b["match"], b["quality_flags"])
        stats[b["review"]["status"]] += 1
        for f in b["quality_flags"]:
            stats["quality_flags"][f] = stats["quality_flags"].get(f, 0) + 1

    out = {
        "meta": {
            "dataset": "theTraffic. · Bengaluru — published timing plans (BTP via OpenCity)",
            "version": "v3",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "retrieved_at": retrieved_at,
            "portal_dataset": pkg.get("title"),
            "portal_dataset_url": "https://data.opencity.in/dataset/bengaluru-city-traffic-signal-data",
            "portal_metadata_modified": pkg.get("metadata_modified"),
            "publisher": pkg.get("organization", {}).get("title"),
            "license": pkg.get("license_title") or None,
            "counts": stats,
            "pre_validation_rule_set": {
                "id": "v1",
                "role": "pre-validation only — a passing block is queued first for review; it never affects recommendations without an explicit committed decision",
                "passes_when": ["match tier strong (road descriptor / landmark name similarity + geocoded proximity ≤ 90 m, unambiguous vs second-best)", "≥ 1 complete row: all phases present, cycle stated or equal to phase sum, |cycle − Σphases| ≤ 3 s, 40 ≤ C ≤ 300", "windows ordered within each day group", "control label FIXED, VAC or SYNC", "phase columns detected, no unlabelled day groups", "no duplicate or conflicting block"],
                "not_recovered": ["compass direction of the document's approach letters A–D (movement matrix is extracted, mapping requires a separate review decision)", "offset / wall-clock synchronisation", "current validity of the document (see document_currency)"],
            },
            "currency_rule": CURRENCY_RULE,
            "caveat": "121 of 124 PDFs carry a March 2010 creation date in their metadata and were uploaded to the portal in November 2025; every plan is therefore a dated snapshot and is labelled stale by the currency rule. Nothing in this file is accepted for prediction: a plan reaches Level P only through an explicit decision recorded in review_decisions, and offsets are never inferred from documents.",
        },
        "sources": sources,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, ensure_ascii=False)
    print(json.dumps(stats, indent=2))
    print("wrote", args.out, round(os.path.getsize(args.out) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
