import { FlaskConical, Loader2 } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { Pill } from "@/components/ui/pills";
import { usePageTitle } from "@/hooks/usePageTitle";
import { fitGreenStarts, scanCycleLength, autocorrelationPeaks } from "@/lib/models/periodicity";
import { simulateSignal, type SimulatorConfig } from "@/lib/simulation/signalSimulator";

interface HarnessResult {
  cfg: SimulatorConfig;
  n_passages: number;
  n_green_starts: number;
  scan_C: number | null;
  scan_improvement: number;
  acf_top: { lag: number; r: number }[];
  gs_C: number | null;
  gs_O: number | null;
  gs_inliers: number | null;
  ms: number;
}

/** The method at equation level, as briefly as it can be said, plus a clearly-marked SYNTHETIC harness. */
export default function MethodologyPage() {
  usePageTitle("Methodology");
  const [running, setRunning] = useState<boolean>(false);
  const [res, setRes] = useState<HarnessResult | null>(null);
  const [preset, setPreset] = useState<"fixed120" | "fixed90" | "adaptive">("fixed120");

  const runHarness = () => {
    setRunning(true);
    setTimeout(() => {
      const base: SimulatorConfig = { cycle_s: 120, green_s: 42, offset_s: 17, arrivals_per_cycle: 4, n_cycles: 220, queue_stop_prob: 0.25, gps_noise_s: 2.5, missing_fraction: 0.15, seed: 42 };
      const cfg: SimulatorConfig = preset === "fixed120" ? base : preset === "fixed90" ? { ...base, cycle_s: 90, green_s: 35, offset_s: 61, seed: 7 } : { ...base, adaptive: true, seed: 3 };
      const t0 = performance.now();
      const sim = simulateSignal(cfg);
      const scan = scanCycleLength(sim.passages, { Cmin: 60, Cmax: 150, K: 2 });
      const acf = autocorrelationPeaks(sim.passages, 60, 150);
      const gs = fitGreenStarts(sim.green_starts.map((g) => g.g), { Cmin: 60, Cmax: 150 });
      setRes({ cfg, n_passages: sim.passages.length, n_green_starts: sim.green_starts.length, scan_C: scan.best?.C ?? null, scan_improvement: scan.improvement, acf_top: acf.slice(0, 3), gs_C: gs?.C ?? null, gs_O: gs?.O ?? null, gs_inliers: gs?.inlier_fraction ?? null, ms: performance.now() - t0 });
      setRunning(false);
    }, 20);
  };

  return (
    <AppShell>
      <article className="mx-auto max-w-[900px] px-4 pb-16 pt-6 sm:px-6">
        <div className="eyebrow mb-2">
          <b>04</b> · methodology
        </div>
        <h1 className="text-[30px] font-semibold tracking-[-0.01em] text-gw-text">Methodology</h1>
        <p className="card-inset mt-3 px-4 py-3 text-[14px] leading-relaxed text-gw-secondary">
          <span className="font-medium text-gw-text">What runs today:</span> the signal map (§1), timing plans with explicit committed link decisions (§2) and the predictions built from them (§8). §3–§7 and §9–§10 are design only — the estimators exist and run against the synthetic harness below, never on real data. The site collects no drives.
        </p>

        <Section title="1 · Signal mapping">
          <p>
            Every <code>highway=traffic_signals</code> node in the Bengaluru bounding box (77.38–77.82 E, 12.78–13.18 N) comes from OpenStreetMap via Overpass, with every <code>highway</code> way through it. DBSCAN (ε = 35 m) proposes clusters; a topology-aware merge joins nodes sharing a way within 90 m or a named road within 60 m. Each junction carries a <code>cluster_confidence</code> ∈ [0,1] with explained score components; below 0.6 it is flagged for review. Nothing is marked verified automatically.
          </p>
          <p>
            External signal lists (CSV exports of OSM nodes) are cross-checked by node id at build time: a listed light the extract lacks is attached to the nearest junction within 60 m, or added as a location-only junction flagged for review. No listed light is silently absent; no listed coordinate overrides the extract.
          </p>
          <p>
            Approaches are directional: the incoming bearing θ over ~60 m upstream of each way, respecting <code>oneway</code>.
          </p>
        </Section>

        <Section title="2 · Published timing plans">
          <p>
            124 Bengaluru Traffic Police timing documents on OpenCity are registered with source id, URL, publication and retrieval timestamps, then parsed heuristically into candidate rows (time window, phase durations, cycle length) with sanity checks (Σ phases ≈ cycle, 30 ≤ C ≤ 400 s). Every candidate needs review; junction names are fuzzy-matched to OSM junctions with an explained score and never auto-accepted. Documents are dated snapshots and may not reflect the current programme.
          </p>
        </Section>

        <Section title="3 · Trajectory collection (design — not running)">
          <p>
            Consented participants would record journeys at up to 1 Hz (timestamp, position, accuracy, speed, heading) under a random research identity; raw samples kept 7 days, the derived encounter the durable record, public exports junction-level only.
          </p>
          <Eq>{"q_i = exp(−acc_i² / 2σ_a²), σ_a = 18 m — samples with acc > 40 m barely influence stop-line inference."}</Eq>
        </Section>

        <Section title="4 · Encounter extraction (design)">
          <p>
            Speed smoothed with a 5 s rolling median; a stop is v &lt; 1.0 m/s for ≥ 3 s. An encounter runs from entering an approach corridor (≈180 m upstream) to the crossing boundary (≈40 m beyond), recording t_enter, t_stop, t_resume, t_cross. A stop is <em>not</em> a red light — queues, buses and GPS noise stop vehicles too — so labels stay probabilistic.
          </p>
          <Eq>D_total = max(0, T_obs − T_ff), T_ff = Q₀.₁₀(T_obs | high-quality encounters on the same approach); cold start uses maxspeed or 40 km/h.</Eq>
        </Section>

        <Section title="5 · Baseline model — kernel time-of-week (design)">
          <Eq>w_i = exp(−age_i/τ) · exp(−δ_t,i² / 2h²) · q_i, D̂(t) = Σ w_i D_i / Σ w_i, p̂_stop(t) = Σ w_i y_i / Σ w_i</Eq>
          <p>δ_t is circular on the day and week; h = 900 s, τ = 45 days. Uncertainty from weighted quantiles (p10–p90); an estimate needs a Kish effective sample size above 8 (4 at Level D).</p>
        </Section>

        <Section title="6 · Periodicity and fixed-time inference (design; verified on synthetic data below)">
          <p>
            For C ∈ [30, 240] s, a circular logistic model logit P(y=1) = β₀ + Σₖ aₖcos(kφ) + bₖsin(kφ), φ = 2π(t mod C)/C, K = 2, scored on held-out journeys (log loss, Brier). Autocorrelation of passage probabilities is a second method; green-start events a third: min over (C, O) of Σ ρ_Huber(min_k |g_i − O − kC|). A cycle is reported only when the methods agree and hold across days; uncertainty is a journey-level bootstrap (B ≥ 200).
          </p>
          <Eq>{"P(no_stop | green) = p_g, P(no_stop | red) = p_r, p_g > p_r — estimated from validation data, not fixed."}</Eq>
        </Section>

        <Section title="7 · Adaptive signals (design)">
          <p>{"Where periodic held-out performance is weak we predict P(stop | x) and E[D | x] with quantile losses L_τ(y,q) = τ(y−q) if y ≥ q else (1−τ)(q−y), τ ∈ {0.1, 0.25, 0.5, 0.75, 0.9}. Candidates (logistic, GAM, gradient boosting) must beat the kernel baseline on rolling-origin folds before activation."}</p>
        </Section>

        <Section title="8 · From an accepted plan link to a prediction (Level P)">
          <p>
            {"A sheet with an accepted junction link gives cycle length C and the green splits of the vehicle phases for a time window on a day type — never the offset, so arrival phase is uniform over the cycle. With effective red r on an approach, a vehicle stops with probability r/C and waits r²/(2C) on average; without a recorded approach-to-phase assignment the prediction marginalises over phases. Confidence is capped by document currency (stale × 0.6, historical × 0) and reduced when two accepted documents disagree."}
          </p>
          <Eq>{"P(stop) = r / C,   E[D] = r² / (2C),   r = C − g_approach"}</Eq>
          <p>Outside every published window, on an uncovered day type, or where the sheet says the signal blinks, there is no cycle to reason about: UNKNOWN (Level E).</p>
        </Section>

        <Section title="9 · Validation and activation (design)">
          <p>
            Chronological splits and rolling-origin folds, never random shuffles. Delay: MAE, RMSE, pinball loss, 90 % interval coverage. Stops: Brier, log loss, ROC-AUC, calibration error. Every model must beat six baselines (global median, approach median, hour-of-day, time-of-week, kernel, recent moving average, published timing where available); drift is monitored per junction with rolling MAE and CUSUM.
          </p>
        </Section>

        <Section title="10 · Predictability score (design)">
          <Eq>S = 100 · exp(−MAE/D_scale) · stability^0.4 · coverage^0.3 · calibration^0.3</Eq>
          <p>≥ 90 very high · 75–89 high · 55–74 moderate · 35–54 low · &lt; 35 insufficient.</p>
        </Section>

        <Section title="11 · Limitations">
          <ul className="list-disc space-y-1 pl-5">
            <li>Every prediction rests on published plans alone; §3–§7 and §9–§10 have no data.</li>
            <li>OSM signal coverage is incomplete; cluster confidence is heuristic.</li>
            <li>The timing documents are 2010–2018 snapshots; PDF extraction loses the phase diagrams.</li>
            <li>Inferring timing from probe trajectories is prior art (Fayazi &amp; Vahidi 2015; Yu &amp; Lu 2016).</li>
          </ul>
        </Section>

        <section className="panel mt-10 p-5" aria-labelledby="harness">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="harness" className="flex items-center gap-2 text-[17px] font-semibold text-gw-text">
              <FlaskConical size={18} className="text-gw-ember" /> Estimator harness
            </h2>
            <Pill tone="ember">SYNTHETIC</Pill>
          </div>
          <p className="mt-2 text-[14px] text-gw-secondary">A simulated pre-timed signal with queue noise, GPS jitter and missing samples: do the estimators recover its cycle and offset? Runs in your browser, writes nothing.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="segment flex-wrap" role="group" aria-label="Scenario">
              <button type="button" aria-pressed={preset === "fixed120"} onClick={() => setPreset("fixed120")}>
                Fixed · C 120 s · O 17 s
              </button>
              <button type="button" aria-pressed={preset === "fixed90"} onClick={() => setPreset("fixed90")}>
                Fixed · C 90 s · O 61 s
              </button>
              <button type="button" aria-pressed={preset === "adaptive"} onClick={() => setPreset("adaptive")}>
                Adaptive (random C)
              </button>
            </div>
            <button type="button" onClick={runHarness} className="btn-primary h-10 px-4 text-[14px]" disabled={running}>
              {running ? <Loader2 className="mr-2 animate-spin" size={15} /> : null} Run
            </button>
          </div>
          {res && (
            <dl className="mono mt-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k="Truth" v={res.cfg.adaptive ? "adaptive — no stable C exists" : `C = ${res.cfg.cycle_s} s · G = ${res.cfg.green_s} s · O = ${res.cfg.offset_s} s`} />
              <Row k="Synthetic passages / green-starts" v={`${res.n_passages} / ${res.n_green_starts}`} />
              <Row k="Method A · Fourier scan" v={res.scan_C === null ? "insufficient" : `C ≈ ${res.scan_C.toFixed(1)} s · held-out improvement ${(res.scan_improvement * 100).toFixed(1)} % ${res.scan_improvement >= 0.05 ? "→ periodic" : "→ not periodic"}`} />
              <Row k="Method B · autocorrelation" v={res.acf_top.length ? res.acf_top.map((a) => `${a.lag}s (r ${a.r.toFixed(2)})`).join(", ") : "—"} />
              <Row k="Method C · Huber green-starts" v={res.gs_C === null ? "insufficient" : `C ≈ ${res.gs_C.toFixed(1)} s · O ≈ ${res.gs_O?.toFixed(1)} s · inliers ${((res.gs_inliers ?? 0) * 100).toFixed(0)} %`} />
              <Row k="Compute" v={`${res.ms.toFixed(0)} ms in-browser`} />
            </dl>
          )}
        </section>
      </article>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[19px] font-semibold text-gw-text">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-gw-secondary [&_code]:mono [&_code]:text-gw-text [&_em]:text-gw-text">{children}</div>
    </section>
  );
}

function Eq({ children }: { children: React.ReactNode }) {
  return <p className="mono card-inset break-words px-3 py-2 text-[13px] text-gw-text">{children}</p>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-gw-secondary">{k}</dt>
      <dd className="text-gw-text">{v}</dd>
    </div>
  );
}
