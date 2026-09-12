# Methodology (engineering reference)

Section numbers follow the project specification so code comments (`docs/METHODOLOGY.md §n`) resolve.
The readable version with prose lives in the app at `/methodology`; this file records parameters and
where each piece is implemented. **Since 2026-09-08 the site collects no trajectories and has no
modelling or visitor-profile backend**: the separate grievance board added on 2026-09-11 stores only
what people deliberately post. Rows marked *design* describe estimators that exist in `web/src/lib/models` and are tested
against the synthetic simulator but have no real data; rows marked *removed* name code that was deleted
with the collector and the Supabase schema, or — §37–§46 — with the route / departure planner
(user decision, 2026-09-08). What runs today is §7–§11 (map, plans, coverage, Level P prior).

| § | Topic | Implementation | Parameters (initial, to be tuned) |
| --- | --- | --- | --- |
| 7–8 | OSM extraction, clustering | `scripts/build-intersections.ts` | DBSCAN ε 35 m; topology merge 90 m shared way / 60 m same road; review if confidence < 0.6 or > 6 nodes |
| 9 | Approach bearing | same | bearing over ~60 m upstream (the Δθ ≤ 40° heading match lived in `optimizer/routeSignals.ts`, *removed* with the planner) |
| 10–11 | Published plans, matching | `scripts/ingest_opencity_timing.py` (v3) | per-panel parse by word position (each BTP PDF = 2 junction panels); columns by x, day groups by y; rows consistent when \|C − Σphases\| ≤ 3 s; pedestrian stage = EXCLUSIVE column (horizontal or rotated); movement matrix = letters A–D (ROAD column, size ≥ 6) × L/S/R letters within 26 pt of a phase column centre; document date = PDF `/CreationDate`; junction match = road-descriptor/landmark soft-token similarity + geocoded proximity (Photon/Nominatim, trusted only for junction-like labels; business POIs sharing the name are not evidence) |
| 11a | Pre-validation rule set v1 | same, `prevalidate()` + `review_state()` | `pre_validated` iff match tier strong ∧ ≥ 1 complete consistent row (40 ≤ C ≤ 300) ∧ windows ordered ∧ control label ∈ {FIXED, VAC, SYNC} ∧ phase columns detected ∧ no unlabelled day group ∧ no duplicate/conflict flag. **Never accepts a link**: `dataset.ts effectivePlanStatus` treats every block as `candidate` until `review_decisions.v1.json` records an explicit `accepted` decision |
| 11d | Quality pass | same, `quality_pass()`; TS mirror `timing/quality.ts` | duplicate = same normalised name + police station, identical timing signature; conflicting_timings = same name, different signature; conflicting_target = strong/moderate matches to one intersection with different signatures; weak_match = tier weak/none; stale/undated by currency rule |
| 11e | Currency rule (currency-v1) | `document_currency()` / `timing/currency.ts` | effective date = document date else portal date; current ≤ 180 d, aging ≤ 365 d, stale > 365 d, undated; historical documents are never current; live samples judged by freshness ≤ 30 s. Level P confidence × {current 1, aging 0.85, stale 0.6, undated 0.5} |
| 11f | Coverage categories | `timing/coverage.ts` | priority order live → accepted published link → awaiting review (plausible match ≥ 0.3, not rejected) → control type known (OSM/reviewer label) → unknown (unresolved or rejected cluster) → location only; “with timing data” = first three (the empirical category went with collection) |
| 11b | Published-plan prior (Level P) | `models/publishedPlan.ts`, `models/predict.ts` | plans accepted by a committed review decision only; uniform arrival phase (offset unknown): P(stop) = r/C, E[D] = r²/2C, quantile_q = max(0, qC − g); marginal over vehicle phases with weights ∝ g (pedestrian stage removed); no queue term; confidence 0.45 fixed / 0.30 VAC, ×0.85 if C from Σphases, ×0.8 if day plan assumed, × currency factor (§11e), ×0.7 when two accepted documents disagree |
| 11c | Offset calibration (Level A) | `models/predict.ts` `synchronisedPrediction` | O fitted on the window-relative clock (s since window start) with C fixed: ≥ 12 green-starts, Huber δ = 4 s, inliers ≥ 0.7; requires reviewer-assigned approach phase; skipped when arrival σ > C/2; confidence × exp(−2(σ/C)²) |
| 12 | Schema | *removed* (was `supabase/migrations/0001_init.sql`); the only data files are the versioned JSON under `web/public/data` | — |
| 13 | Privacy | `docs/PRIVACY.md` — no account or identity field; grievances and short-lived daily-salted abuse counters are stored | the 7-day raw retention / k ≥ 5 design is *removed* with the store |
| 14–15 | Collection, GPS quality | *removed* (was `hooks/useJourneyCollector.ts`, `encounters/extract.ts`); design: ≤ 2 Hz cap; q = exp(−acc²/2σ²), σ_a = 18 m | — |
| 16 | Map matching | *removed* (was `matching/osrmMatch.ts` → `encounters/fromMatched.ts`; the route→signal node matching in `routing/nodeKeys.ts` went with the planner) | — |
| 17–20 | Encounters, delay | *removed*; design: t_enter 180 m upstream, heading over 40 m with Δθ ≤ 40°, stop < 1.0 m/s ≥ 3 s, median window 5 s, T_ff = p10 (≥ 20 enc.) else maxspeed/40 km/h | — |
| 21–22 | Kernel baseline, cyclic features | `models/kernelBaseline.ts`, `models/features.ts` (*design*: `useSignalModel` passes zero encounters) | h_day 900 s, h_week 3 d, τ 45 d, min effective N 8 (4 at Level D) |
| 23–28 | Periodicity, offsets, bootstrap | `models/periodicity.ts` (*design*; exercised by the `/methodology` synthetic harness) | C ∈ [30,240] s @1 s then 0.1 s; K = 2; Huber δ = 4 s; largest-C tie-break (approximate GCD); B ≥ 200 |
| 25–26 | Fixed-time model, noise | `models/fixedTime.ts` (*design*) | p_g, p_r from validation |
| 29–30 | Fixed/adaptive classification, change-points | *design only* (the `services/model-api` scaffold was removed) | — |
| 31–33 | Adaptive, quantile, zero-inflated | *design only* | τ ∈ {.1,.25,.5,.75,.9} |
| 34 | Recent residual update | `models/predict.ts` `recentResidual` | τ_r 1800 s, λ 0.5, clip p99 |
| 36 | Predictability | `models/predictability.ts` | S = 100·e^{−e}·stab^.4·cov^.3·cal^.3 |
| 37 | Route candidates | *removed* with the planner (was `routing/*`: Mapbox Directions driving-traffic → Google Routes proxy → OSRM → Valhalla, TomTom opt-in; PCHIP-interpolated departure samples; OSM-node route→signal match) | — |
| 38–39 | Residual ETA, recursion | *removed* with the planner (was `optimizer/departure.ts`, `optimizer/alpha.ts`: R_j(t) = E[D_j \| t, a, x] − D̄_j, ETA = ETA_provider + α Σ R_j, α = 1) | — |
| 42a | Route ranking with uneven coverage | *removed* with the planner (`useSignalModel.rankingPrior` still computes the accepted-corpus median but nothing consumes it) | — |
| 44a | “No advantage” rule | *removed* with the planner | — |
| 44b | Coverage-gated confidence label | *removed* with the planner (was `RouteCards.routeConfidenceLabel`) | — |
| 40 | Uncertainty propagation | *removed* with the planner (route-level Monte Carlo); Level P quantiles per junction remain (§11b) | — |
| 41–44 | Departure search, robustness | *removed* with the planner | — |
| 45–46 | Stops, Green-Wave score | *removed* with the planner | — |
| 47 | No speeding | product rule — no speed advice anywhere | — |
| 57–59 | Validation, metrics, calibration | `models/stats.ts` (MAE, RMSE, pinball, Brier, log loss, ECE) | chronological/rolling-origin only |
| 61–62 | Drift, activation | *design only* (the schema tables went with the backend) | CUSUM; champion/challenger |
| 74–75 | Tests, simulator | `src/lib/**/*.test.ts`, `simulation/signalSimulator.ts` | synthetic only, never persisted |
| 80 | Cold start | `models/predict.ts` `coldStartLevel` | E < 10 < D < 60 < C < 300 ≤ B; P = accepted plan link without observations; A = synchronised phase model (accepted plan + calibrated offset + assigned approach phase); kernel with an accepted plan is reported as B |
