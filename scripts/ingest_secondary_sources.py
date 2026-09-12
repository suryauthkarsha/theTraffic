#!/usr/bin/env python3
"""
theTraffic. · Bengaluru — secondary (historical), live-candidate and location-only source registry.

Historical / planning documents are evidence about junctions and about how the city's signals are
run — never a current timing. This script reads local, gitignored text extracts under
data/raw/historical/ and data/raw/live/, records page-referenced factual mentions without
redistributing source prose, matches junction names to the master map by name similarity only
(tiered, never auto-linked), and writes:

  web/public/data/historical_sources.v1.json   factual mentions with page and document date
  web/public/data/source_registry.v1.json      one row per source class: published · live ·
                                               historical · location, with status and dates

Rules encoded here (and shown verbatim in the app):
  * a historical statement carries the document date and is labelled "historical" — the UI may not
    present it as a current timing;
  * Mappls live signal timers are registered as a partnership / data-access opportunity with the
    public claim quoted from the press release; no feed is scraped, nothing is claimed as coverage;
  * data.gov.in "Bangalore: Traffic Lights" is a location-only source; the probe that found no
    retrievable per-location resource is recorded with its date so the status is reproducible.

Usage
  python3 scripts/ingest_secondary_sources.py --date 2026-09-06
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_opencity_timing import token_similarity, tokens  # noqa: E402

GENERIC = {"signalized", "junction", "traffic", "pedestrian", "critical", "key", "major", "the", "manual", "stage", "ft", "d", "c", "pelican", "two way", "one way", "from", "delay- towards", "two way cmp", "two way junction", "one way junction", "junction road", "two way road", "mile"}
NAME_RE = re.compile(r"((?:[A-Z][\w.'&-]*\s){0,4}[A-Z][\w.'&-]*)\s+(Junction|junction|Circle|circle|Cross|cross|Signal|signal|intersection|Intersection)")
SIGNAL_RE = re.compile(r"signal", re.I)


def pages_of(path: str):
    txt = open(path, encoding="utf-8", errors="ignore").read()
    out = []
    for chunk in txt.split("\n=== page ")[1:]:
        i = chunk.find("===\n")
        if i < 0:
            continue
        out.append((int(chunk[: i - 1].strip() or 0), chunk[i + 4 :]))
    return out


def sentences(body: str):
    body = re.sub(r"\s+", " ", body)
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z➢✓•])|(?=[➢✓•])", body) if s.strip()]


def clean_name(raw: str) -> str | None:
    n = re.sub(r"\s+", " ", raw).strip(" -–")
    for pre in ("Two Way ", "One Way ", "Delay- Towards ", "From ", "Towards ", "Near "):
        if n.startswith(pre):
            n = n[len(pre) :]
    # table fragments arrive as stray single letters, a leading 'Junction' word or sentence openers
    parts = n.split()
    while parts and (len(parts[0]) == 1 or parts[0].lower() in {"junction", "signal", "circle", "the", "two", "one", "way", "from", "towards", "near", "at"}):
        parts = parts[1:]
    n = " ".join(parts)
    if not n or n.lower() in GENERIC or len(n) < 3:
        return None
    return n


def match_name(name: str, kind: str, index):
    """Name-only matching: the canonical name first, road names as weaker support (never geocoded, never auto-linked)."""
    q = tokens(f"{name} {kind}")
    if not q:
        return None
    scored = []
    for it in index:
        s = max(token_similarity(q, it.get("name_toks", it["toks"])), 0.85 * token_similarity(q, it["toks"]))
        if s > 0:
            scored.append((s, it))
    scored.sort(key=lambda x: -x[0])
    if not scored:
        return {"tier": "none", "best": None, "candidates": []}
    best_s, best = scored[0]
    second = scored[1][0] if len(scored) > 1 else 0.0
    margin = best_s - second
    tier = "strong" if best_s >= 0.75 and margin >= 0.2 else "moderate" if best_s >= 0.5 else "weak" if best_s >= 0.3 else "none"
    return {
        "tier": tier,
        "best": {"intersection_id": best["id"], "canonical_name": best["canonical_name"], "name_similarity": round(best_s, 3), "margin": round(margin, 3)},
        "candidates": [{"intersection_id": it["id"], "canonical_name": it["canonical_name"], "name_similarity": round(s, 3)} for s, it in scored[:3]],
    }


def classify_claim(sentence: str) -> str:
    s = sentence.lower()
    if re.search(r"recommend|need to be|needs to be|should|optimi[sz]|propos|suggest", s):
        return "qualitative_recommendation"
    if re.search(r"kmph|km/h|speed|delay|queue|congestion|observed|survey", s):
        return "observation"
    return "mention"


def extract_mentions(pages, index, source_id: str):
    items = []
    seen = set()
    for page_no, body in pages:
        if not SIGNAL_RE.search(body):
            continue
        for sent in sentences(body):
            if not SIGNAL_RE.search(sent):
                continue
            for m in NAME_RE.finditer(sent):
                name = clean_name(m.group(1))
                if not name:
                    continue
                kind = m.group(2).lower()
                key = (page_no, name.lower(), kind)
                if key in seen:
                    continue
                seen.add(key)
                quote = sent if len(sent) <= 320 else sent[: 317].rstrip() + "…"
                items.append({
                    "id": f"{source_id}:p{page_no}:{len(items) + 1}",
                    "page": page_no,
                    "mention_text": f"{name} {kind}",
                    # Do not redistribute source prose; the page + mention preserve reproducible factual provenance.
                    "quote": None,
                    "claim_type": classify_claim(sent),
                    "kind": "historical",
                    "timing_values": None,
                    "match": match_name(name, kind, index),
                })
    return items


def jica_statements(pages):
    """Page-referenced city-wide statements about the signal regime (2014–2015 meeting minutes)."""
    wanted = [
        (r"There are 360 Traffic signals in total", "signal_count"),
        (r"352 traffic signals installed", "signal_count"),
        (r"Out of 352 traffic signals, 11 have been removed", "signal_count"),
        (r"More than 270 Signals are connected", "connectivity"),
        (r"time-of-day control function", "control_regime"),
        (r"programmed to work from 7am to 12pm", "operating_hours"),
        (r"blinking mode and show amber blinking", "operating_hours"),
        (r"No vehicle detector is used", "control_regime"),
        (r"signal timing is continuously reviewed", "control_regime"),
        (r"area traffic control system for the signal system may be completed", "control_regime"),
        (r"Most of the signals are operated manually by police", "control_regime"),
    ]
    out = []
    for page_no, body in pages:
        flat = re.sub(r"\s+", " ", body)
        for pat, typ in wanted:
            m = re.search(pat, flat, re.I)
            if m:
                s = max(0, m.start() - 160)
                e = min(len(flat), m.end() + 200)
                out.append({"page": page_no, "statement_type": typ, "quote": None, "kind": "historical"})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="retrieval date (YYYY-MM-DD)")
    ap.add_argument("--intersections", default="web/public/data/intersections.v1.json")
    ap.add_argument("--published", default="web/public/data/published_timing_plans.v3.json")
    ap.add_argument("--out-historical", default="web/public/data/historical_sources.v1.json")
    ap.add_argument("--out-registry", default="web/public/data/source_registry.v1.json")
    args = ap.parse_args()
    retrieved_at = f"{args.date}T02:31:00Z"

    inters = json.load(open(args.intersections))
    index = [{"id": it["id"], "canonical_name": it["canonical_name"], "name_toks": tokens(it["canonical_name"]), "toks": tokens(it["canonical_name"]) | set().union(*[tokens(r) for r in it.get("road_names", [])]) if it.get("road_names") else tokens(it["canonical_name"])} for it in inters["intersections"]]

    ctmp_pages = pages_of("data/raw/historical/bbmp_ctmp_final_feasibility_2024-12.txt")
    jica_pages = pages_of("data/raw/historical/jica_12235198_04_its_master_plan_appendix.txt")

    ctmp = {
        "source_id": "bbmp-ctmp-2024-12",
        "source_kind": "historical",
        "source_type": "planning_report",
        "title": "Comprehensive Bengaluru City Traffic Management Infrastructure Plan — Proposals for Vehicular Tunnel / Grade Separator / Road Widening in Selected Corridors. Final Feasibility Report",
        "publisher": "Bruhat Bengaluru Mahanagara Palike (BBMP); prepared by Altinok",
        "document_date": "2024-12",
        "date_precision": "month",
        "date_evidence": "Cover page: 'FINAL FEASIBILITY REPORT December 2024'",
        "published_at": None,
        "retrieved_at": retrieved_at,
        "portal": "OpenCity (data.opencity.in)",
        "source_reference": "https://data.opencity.in/dataset/2c324650-7caa-40b6-82ef-f99509d5b376/resource/be5f1ca6-4252-432b-b32a-caa54db69dd6/download/305c1726-cae5-43dc-81c1-c0ae0db22c92.pdf",
        "sha256": "c6a0b8b0695a087ba65f65b2f9ffe63c7180b2f4de3ab63f3bc74f6f65d0f8fa",
        "pages": len(ctmp_pages),
        "license_notes": "Licence not stated on portal; report carries the consultant's disclaimer — reference material only",
        "validity": "historical / planning evidence only — junction mentions and qualitative recommendations; never a current signal timing",
        "junction_level_timing_tables_found": False,
        "evidence": extract_mentions(ctmp_pages, index, "bbmp-ctmp-2024-12"),
        "city_wide_statements": [],
    }
    jica = {
        "source_id": "jica-its-master-plan-appendix-2015",
        "source_kind": "historical",
        "source_type": "survey_report",
        "title": "Master Plan Study on the Introduction of ITS in Bengaluru Metropolitan Area and Mysore in India — Final Report, Appendices (12235198_04)",
        "publisher": "Japan International Cooperation Agency (JICA) Study Team",
        "document_date": "2015-04-27",
        "date_precision": "day",
        "date_evidence": "Appendix 1 (Bengaluru Congestion Pricing Scheme Final Report) 'Submission Date: 27 April 2015'; meeting minutes dated 2014–2015",
        "published_at": None,
        "retrieved_at": retrieved_at,
        "portal": "JICA Open Report library (openjicareport.jica.go.jp)",
        "source_reference": "https://openjicareport.jica.go.jp/pdf/12235198_04.pdf",
        "sha256": "a3f8ab9f9247be58b00dd3e2c7057c0aad35f446f3f66a14bf900e1a8fddda49",
        "pages": len(jica_pages),
        "license_notes": "JICA report; reference material only",
        "validity": "historical / survey evidence (2014–2015) about the city-wide signal regime — never a current signal timing",
        "junction_level_timing_tables_found": False,
        "evidence": extract_mentions(jica_pages, index, "jica-its-master-plan-appendix-2015"),
        "city_wide_statements": jica_statements(jica_pages),
    }
    historical = {
        "meta": {
            "dataset": "theTraffic. · Bengaluru — historical / planning sources (evidence only)",
            "version": "v1",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "retrieved_at": retrieved_at,
            "method": "text extraction (pdfplumber) → sentences mentioning 'signal' → junction/circle name mentions → name-similarity match against the master map (tiered; never auto-linked)",
            "rule": "Historical statements are shown with their document date and the label 'historical'. They never become a timing prior and never change a recommendation.",
            "counts": {
                "sources": 2,
                "evidence_items": len(ctmp["evidence"]) + len(jica["evidence"]),
                "matched_strong": sum(1 for e in ctmp["evidence"] + jica["evidence"] if e["match"] and e["match"]["tier"] == "strong"),
                "matched_moderate": sum(1 for e in ctmp["evidence"] + jica["evidence"] if e["match"] and e["match"]["tier"] == "moderate"),
                "city_wide_statements": len(jica["city_wide_statements"]),
            },
        },
        "sources": [ctmp, jica],
    }
    with open(args.out_historical, "w") as f:
        json.dump(historical, f, ensure_ascii=False)

    pub = json.load(open(args.published))
    pc = pub["meta"]["counts"]
    osm_meta = inters["meta"]
    registry = {
        "meta": {"dataset": "theTraffic. · Bengaluru — source registry", "version": "v1", "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": args.date},
        "sources": [
            {
                "id": "osm-traffic-signals",
                "class": "location",
                "name": "OpenStreetMap — highway=traffic_signals nodes and connected ways",
                "publisher": "OpenStreetMap contributors",
                "status": "ingested",
                "timing_source": False,
                "url": "https://www.openstreetmap.org/",
                "dates": {"osm_base": osm_meta["source"]["osm_timestamp_base"], "retrieved_at": osm_meta["source"]["retrieved_at"]},
                "counts": {"signal_nodes": osm_meta["counts"]["source_signal_nodes"], "ways": osm_meta["counts"]["ways_touching_signals"], "logical_intersections": osm_meta["counts"]["logical_intersections"], "approaches": osm_meta["counts"]["approaches"]},
                "license": osm_meta["source"]["license"],
                "note": "Location and geometry only. OSM does not carry signal timings; control-type tags are absent for every mapped node.",
            },
            {
                "id": "datagov-bangalore-traffic-lights",
                "class": "location",
                "name": 'data.gov.in — "Bangalore: Traffic Lights" (catalog nid 602922725)',
                "publisher": "Open Government Data (OGD) Platform India",
                "status": "registered_not_retrievable",
                "timing_source": False,
                "url": "https://ap.data.gov.in/catalog/bangalore-traffic-lights",
                "dates": {"probed_at": retrieved_at},
                "counts": {"rows_ingested": 0},
                "license": "GODL-India (platform default); resource-level licence unverified",
                "note": f"Probe on {args.date}: the catalog page describes 'the number of traffic lights and their location', but the OGD API exposes no per-location resource for it — the only matching resource ('Traffic lights', d0637ff8-…) is a city-level count table and returned 0 rows for Bangalore. Ingestion note: no compatible location-level resource was available. If one is published, transform it to the OSM-style signal CSV schema documented in scripts/README.md and place it under data/raw/osm/ for reconciliation; never treat it as timing.",
            },
            {
                "id": "btp-opencity-timing-pdfs",
                "class": "published",
                "name": "Bengaluru Traffic Police — signal timing data sheets (PDF) via OpenCity",
                "publisher": pub["meta"].get("publisher") or "Bengaluru Traffic Police (BTP)",
                "status": "ingested_pending_review",
                "timing_source": True,
                "url": pub["meta"]["portal_dataset_url"],
                "dates": {"document_creation_years": pc["document_creation_years"], "portal_published": "2025-11-25", "portal_metadata_modified": pub["meta"]["portal_metadata_modified"], "retrieved_at": pub["meta"]["retrieved_at"]},
                "counts": {"documents": pc["sources"], "junction_blocks": pc["junction_blocks_detected"], "timing_rows": pc["timing_rows_detected"], "pre_validated": pc["pre_validated"], "pending_review": pc["pending_review"], "image_only_documents": pc["image_only_documents"], "conflicting_target": pc["quality_flags"].get("conflicting_target", 0), "weak_match": pc["quality_flags"].get("weak_match", 0)},
                "currency": pc["document_currency"],
                "license": pub["meta"].get("license") or "not stated on portal",
                "note": "Every block is a dated snapshot (121 documents authored March 2010 per PDF metadata) and stays 'published timing awaiting review' until an explicit decision accepts the junction match and parse. Only accepted blocks feed the Level P prior.",
            },
            {
                "id": "mappls-live-signal-timers",
                "class": "live",
                "name": "Mappls (MapmyIndia) — AI-powered Live Traffic Signal Timers, Bengaluru",
                "publisher": "MapmyIndia (Mappls), with Bengaluru Traffic Police and Arcadis",
                "status": "not_authorized",
                "timing_source": True,
                "url": "https://about.mappls.com/app/",
                "public_claim": {
                    "text": "In collaboration with Bangalore Traffic Police and Arcadis, MapmyIndia has integrated 125+ smart signals across Bengaluru into the app, enabling users to view live traffic signal status up to 500 meters in advance. Real-time signal countdowns (green, amber, red) are now visible on the navigation screen.",
                    "document": "MapmyIndia press release, New Delhi, 25 September 2025 (NSE corporate filing)",
                    "date": "2025-09-25",
                    "url": "https://nsearchives.nseindia.com/corporate/MAPMYINDIA_25092025094753_Press_Release_25_Sept_2025.pdf",
                    "sha256": "803d605e8d39a432d7b83eeb6c2c340b1d820ffcd3213b88fb50e68f886f69aa",
                },
                "dates": {"claim_date": "2025-09-25", "retrieved_at": retrieved_at},
                "counts": {"intersections_with_live_timing_in_app": 0},
                "license": "none — no data-access agreement exists",
                "note": "Partnership / data-access opportunity only. theTraffic. does not scrape the Mappls app or call private APIs. When an authorised feed exists, the adapter contract in web/src/lib/timing/live.ts carries current state, green/amber/red countdown, timestamp, junction id, approach, freshness, source and licence. Until then the app reports 0 intersections with live timing and never names Mappls as coverage.",
            },
            {
                "id": ctmp["source_id"],
                "class": "historical",
                "name": "BBMP Comprehensive Traffic Management Plan — Final Feasibility Report",
                "publisher": ctmp["publisher"],
                "status": "ingested_evidence_only",
                "timing_source": False,
                "url": ctmp["source_reference"],
                "dates": {"document_date": ctmp["document_date"], "retrieved_at": retrieved_at},
                "counts": {"pages": ctmp["pages"], "evidence_items": len(ctmp["evidence"]), "matched_strong": sum(1 for e in ctmp["evidence"] if e["match"] and e["match"]["tier"] == "strong")},
                "license": ctmp["license_notes"],
                "note": ctmp["validity"] + ". No cycle, phase or green-time table exists in the report.",
            },
            {
                "id": jica["source_id"],
                "class": "historical",
                "name": "JICA — ITS Master Plan Study for Bengaluru & Mysore, appendices",
                "publisher": jica["publisher"],
                "status": "ingested_evidence_only",
                "timing_source": False,
                "url": jica["source_reference"],
                "dates": {"document_date": jica["document_date"], "retrieved_at": retrieved_at},
                "counts": {"pages": jica["pages"], "evidence_items": len(jica["evidence"]), "city_wide_statements": len(jica["city_wide_statements"])},
                "license": jica["license_notes"],
                "note": jica["validity"] + ". Records the 2014–2015 regime (time-of-day plans 07:00–24:00, amber blinking overnight, ~360 signals); no junction-level timing table.",
            },
        ],
    }
    with open(args.out_registry, "w") as f:
        json.dump(registry, f, ensure_ascii=False, indent=1)
    print(json.dumps(historical["meta"]["counts"], indent=2))
    print("wrote", args.out_historical, round(os.path.getsize(args.out_historical) / 1e3, 1), "KB;", args.out_registry)


if __name__ == "__main__":
    main()
