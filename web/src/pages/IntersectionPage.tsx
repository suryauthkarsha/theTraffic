import type { Map as MlMap } from "maplibre-gl";
import { ArrowLeft, ChevronDown, Flag, MapPin, Megaphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApproachDiagram } from "@/components/intersection/ApproachDiagram";
import { AppShell } from "@/components/layout/AppShell";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { BaseMap } from "@/components/map/BaseMap";
import { COLORS, upsertLine, upsertSignalLayer } from "@/components/map/layers";
import { CoverageBadge } from "@/components/timing/CoverageBadge";
import { TimingClaimCard } from "@/components/timing/TimingClaimCard";
import { Pill } from "@/components/ui/pills";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useSignalModel } from "@/hooks/useSignalModel";
import { findIntersection, plansForIntersection, useIntersectionDataset } from "@/lib/data/dataset";
import type { Intersection } from "@/lib/data/types";
import { RESTORE_VIEW_STATE } from "@/lib/map/home";
import { recallSignalMapView, rememberSignalMapView } from "@/lib/map/viewMemory";

/** Plain words for the control regimes the datasets use. */
const CONTROL_LABEL: Record<string, string> = {
  fixed: "Fixed-time",
  fixed_coordinated: "Fixed-time, coordinated",
  time_of_day: "Time-of-day plans",
  actuated: "Vehicle-actuated",
  vehicle_actuated: "Vehicle-actuated",
  adaptive: "Adaptive",
  manual: "Manual",
  unknown: "Control type unknown",
};

/** Zoom the Signal Map opens at when "Show on map" is pressed. */
const SHOW_ON_MAP_ZOOM = 15.5;

/** Junction page: what is on file for its timing, where every piece of it came from, and its geometry. */
export default function IntersectionPage() {
  const { id } = useParams<{ id: string }>();
  const dataset = useIntersectionDataset();
  const model = useSignalModel();
  const inter = findIntersection(dataset.data, id);
  // No title (and no page view) until the junction's name is known; a failed load leaves the pre-rendered head
  // as it is rather than calling the junction missing; null = not on file (noindex).
  usePageTitle(dataset.isLoading || dataset.isError ? undefined : inter ? inter.canonical_name : null);
  const [approachPick, setApproachPick] = useState<string | null>(null);
  // The small map is keyed by junction id and reports back with the id it was built for, so moving
  // between junction pages never draws one junction's corridors on another's map.
  const [mapFor, setMapFor] = useState<{ map: MlMap; id: string } | null>(null);

  // Derived, never stored: an approach picked on a previous junction cannot leak into this one.
  const approachId = inter ? (approachPick && inter.approaches.some((a) => a.id === approachPick) ? approachPick : inter.approaches[0]?.id ?? null) : null;

  const links = useMemo(() => plansForIntersection(model.plans, model.decisions, inter?.id ?? ""), [model.plans, model.decisions, inter?.id]);
  const decisions = model.decisions;

  useEffect(() => {
    if (!inter || !mapFor || mapFor.id !== inter.id) return;
    const map = mapFor.map;
    inter.approaches.forEach((a) => {
      if (a.upstream_geometry.length >= 2) upsertLine(map, `appr-${a.id}`, [...a.upstream_geometry, [inter.lon, inter.lat]], { color: a.id === approachId ? COLORS.orange : "#9A928A", width: a.id === approachId ? 3 : 1.5, opacity: 0.9, dash: [2, 2] });
    });
    // Each OSM signal node of the junction is a flat orange dot, like every signal on the maps.
    upsertSignalLayer(map, "nodes", {
      type: "FeatureCollection",
      features: inter.osm_node_ids.map((n, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: nodeCoord(inter, i) }, properties: { id: String(n), name: String(n), color: COLORS.orange, value: null, radius: 4, label: "" } })),
    });
  }, [mapFor, inter, approachId]);

  if (dataset.isLoading) return <AppShell><div className="p-6 text-gw-secondary sm:p-8">Loading…</div></AppShell>;
  if (dataset.isError) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl p-6 sm:p-8">
          <Breadcrumb parent={{ to: "/signals", label: "Signal Map" }} current="Unavailable" />
          <h1 className="mt-3 text-2xl font-semibold text-gw-text">Signal data could not be loaded</h1>
          <button type="button" className="btn-secondary mt-4" onClick={() => void dataset.refetch()}>
            Try again
          </button>
        </div>
      </AppShell>
    );
  }
  if (!inter) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl p-6 sm:p-8">
          <Breadcrumb parent={{ to: "/signals", label: "Signal Map" }} current="Not found" />
          <h1 className="mt-3 text-2xl font-semibold text-gw-text">Junction not found</h1>
          <p className="mt-2 text-gw-secondary">No junction has this id.</p>
          <Link to="/signals" className="mt-4 inline-flex min-h-[44px] items-center gap-2 text-gw-orange">
            <ArrowLeft size={16} /> Signal Map
          </Link>
        </div>
      </AppShell>
    );
  }

  const verifiedLink = links.find((l) => l.status === "verified") ?? null;
  const nowPrediction = model.predict(inter, approachId, Date.now());
  const category = model.coverageOf(inter);
  const claims = model.claimsFor(inter, Date.now());
  const conflict = model.conflicts.get(inter.id) ?? null;
  const clusterDecision = decisions.clusters[inter.id];
  const controlOverride = decisions.controlType[inter.id];
  const controlType = verifiedLink ? verifiedLink.junction.control_type_hint : controlOverride?.control_type ?? inter.control_type;
  const controlLabel = CONTROL_LABEL[controlType] ?? controlType.replace(/_/g, " ");
  const planDate = verifiedLink?.junction.document_date?.slice(0, 7) ?? null;
  const phaseMap = verifiedLink ? decisions.approachPhase[verifiedLink.junction.junction_key] ?? {} : {};
  const assignedApproaches = inter.approaches.filter((a) => phaseMap[a.id] !== undefined);
  const clusterVerified = inter.verified || clusterDecision?.decision === "verified";
  const ways = Array.from(new Set(inter.approaches.flatMap((a) => a.osm_way_ids)));

  /** The Signal Map opens centred on this junction, keeping the layer and filter the visitor had (the link carries the restore state). */
  const showOnMap = () => {
    const prev = recallSignalMapView();
    rememberSignalMapView({ center: [inter.lon, inter.lat], zoom: SHOW_ON_MAP_ZOOM, layer: prev?.layer ?? null, filter: prev?.filter ?? null });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1480px] px-4 pb-10 pt-2 sm:px-6 sm:pt-4">
        {/* "← Signal Map" is a return: the map reopens where the visitor left it, not on the city home. */}
        <Breadcrumb parent={{ to: "/signals", label: "Signal Map", state: RESTORE_VIEW_STATE }} current={inter.canonical_name} />

        <header className="mt-2 sm:mt-3">
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.01em] text-gw-text sm:text-[30px]">{inter.canonical_name}</h1>
          <p className="mt-1 text-[14px] text-gw-secondary sm:text-[15px]">
            {inter.road_names.length ? inter.road_names.join(" × ") : "Unnamed roads"} · <span className="capitalize">{inter.intersection_type.replace(/_/g, " ")}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CoverageBadge category={category} />
            <Pill tone={controlType === "unknown" ? "grey" : "neutral"} mono>
              {controlLabel}
              {planDate ? ` · plan ${planDate}` : controlOverride && !verifiedLink ? " · reviewer label" : ""}
            </Pill>
            {inter.review_needed && <Pill tone="red">In review</Pill>}
            {clusterDecision && clusterDecision.decision !== "verified" && <Pill tone="ember">{clusterDecision.decision} requested</Pill>}
            {conflict && <Pill tone="red">Conflicting timing plans · {conflict.blocks.length} blocks</Pill>}
          </div>
          {nowPrediction.mean_delay_s !== null && (
            <p className="mono mt-3 text-[13px] text-gw-text">
              Right now · expected wait ~{Math.round(nowPrediction.mean_delay_s)} s · stop probability {nowPrediction.p_stop?.toFixed(2)}
              {nowPrediction.plan?.mode === "timed" ? ` · C ${nowPrediction.plan.cycle_s} s` : ""}
              {nowPrediction.plan?.currency_status && nowPrediction.plan.currency_status !== "current" ? <span className="text-gw-ember"> · {nowPrediction.plan.currency_status} plan</span> : null}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/signals" state={RESTORE_VIEW_STATE} onClick={showOnMap} className="btn-secondary flex-1 sm:flex-none">
              <MapPin size={13} className="mr-1.5" aria-hidden /> Show on map
            </Link>
            <Link to={`/support?topic=junction&ref=${encodeURIComponent(inter.id)}&from=${encodeURIComponent(`/intersection/${inter.id}`)}`} className="btn-secondary flex-1 sm:flex-none">
              <Flag size={13} className="mr-1.5 text-gw-ember" aria-hidden /> Report a problem
            </Link>
            {/* The road itself, not the data: a grievance opens with this junction already marked. */}
            <Link to={`/grievance?junction=${encodeURIComponent(inter.id)}`} className="btn-secondary flex-1 sm:flex-none">
              <Megaphone size={13} className="mr-1.5 text-gw-orange" aria-hidden /> Grievance
            </Link>
          </div>
        </header>

        <section className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_1.3fr]" aria-label="Geometry">
          {/* Always imagery, dimmed: the junction's real layout is the context and its orange signal nodes are the subject (user decision 2026-09-09). */}
          <div className="panel relative h-[220px] overflow-hidden sm:h-[300px]">
            <BaseMap key={inter.id} center={[inter.lon, inter.lat]} zoom={16.6} showNav={false} fixedBasemap="satellite" imagery="dim" cooperativeGestures onLoad={(m) => setMapFor({ map: m, id: inter.id })} ariaLabel={`Satellite map of ${inter.canonical_name}`} />
          </div>
          <div className="panel p-3 sm:p-4">
            <ApproachDiagram approaches={inter.approaches} selectedId={approachId} onSelect={setApproachPick} />
            {assignedApproaches.length > 0 && <p className="mono mt-2 text-[12px] text-gw-muted">Phases · {assignedApproaches.map((a) => `${a.direction} → ${(phaseMap[a.id] ?? 0) + 1}`).join(" · ")}</p>}
          </div>
        </section>

        <section className="panel mt-3 p-3 sm:mt-4 sm:p-4" aria-label="Timing on file">
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-gw-text">
            Timing on file
            {claims.length > 0 && (
              <span className="mono text-[12px] font-normal text-gw-muted">
                {claims.length} claim{claims.length === 1 ? "" : "s"}
              </span>
            )}
          </h2>
          {claims.length === 0 ? (
            <p className="mt-2 text-[13px] text-gw-secondary">Nothing on file — timing unknown, not untimed.</p>
          ) : (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {claims.map((c) => (
                <TimingClaimCard key={c.id} claim={c} />
              ))}
            </div>
          )}
        </section>

        {verifiedLink && verifiedLink.junction.approach_rows.length > 0 && (
          <section className="panel mt-3 p-3 sm:mt-4 sm:p-4" aria-label="Document approach table">
            <h2 className="text-[15px] font-semibold text-gw-text">Approach × phase table</h2>
            <div className="-mx-1 mt-2 overflow-x-auto px-1">
              <table className="mono w-full min-w-[520px] text-[12.5px]">
                <thead>
                  <tr className="label text-left">
                    <th className="py-1 pr-3">Letter</th>
                    <th className="py-1 pr-3">From</th>
                    {Array.from({ length: verifiedLink.junction.phase_count }, (_, k) => (
                      <th key={k} className="py-1 pr-3">
                        Phase {k + 1}
                        {verifiedLink.junction.pedestrian_phase_index === k ? " (ped.)" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {verifiedLink.junction.approach_rows.map((r) => (
                    <tr key={r.letter} className="border-t border-gw-border">
                      <td className="py-1 pr-3 text-gw-text">{r.letter}</td>
                      <td className="py-1 pr-3 text-gw-secondary">{r.landmark ?? "—"}</td>
                      {Array.from({ length: verifiedLink.junction.phase_count }, (_, k) => (
                        <td key={k} className={r.movements_by_phase[String(k)] ? "py-1 pr-3 text-gw-orange" : "py-1 pr-3 text-gw-muted"}>
                          {r.movements_by_phase[String(k)]?.join(" ") ?? "·"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <details className="card-inset group mt-3 text-[12px] sm:mt-4" aria-label="Provenance">
          <summary className="flex min-h-[44px] cursor-pointer select-none items-center justify-between px-3 text-[13px] text-gw-secondary hover:text-gw-text">
            Provenance
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <dl className="mono grid grid-cols-[84px_1fr] gap-x-3 gap-y-1.5 break-words border-t border-gw-border px-3 py-3 text-gw-secondary sm:grid-cols-[120px_1fr]">
            <dt className="text-gw-muted">Junction id</dt>
            <dd className="text-gw-text">{inter.id}</dd>
            <dt className="text-gw-muted">Position</dt>
            <dd>
              {inter.lat.toFixed(5)} N · {inter.lon.toFixed(5)} E
            </dd>
            <dt className="text-gw-muted">Cluster</dt>
            <dd>
              {clusterVerified ? "verified" : "unverified"} · {inter.node_count} OSM signal node{inter.node_count > 1 ? "s" : ""} merged · confidence {inter.cluster_confidence.toFixed(2)}
            </dd>
            <dt className="text-gw-muted">OSM nodes</dt>
            <dd>
              {inter.osm_node_ids.map((n, i) => (
                <span key={n}>
                  {i > 0 ? ", " : ""}
                  <a href={`https://www.openstreetmap.org/node/${n}`} target="_blank" rel="noopener noreferrer" className="underline decoration-gw-muted underline-offset-2 hover:text-gw-text">
                    {n}
                  </a>
                </span>
              ))}
              {inter.seed_node_ids && inter.seed_node_ids.length > 0 ? ` · also listed as ${inter.seed_node_ids.join(", ")} in an external signal list` : ""}
              {inter.seed_source ? ` · location only, added from ${inter.seed_source}` : ""}
            </dd>
            <dt className="text-gw-muted">OSM ways</dt>
            <dd>{ways.join(", ") || "—"}</dd>
            <dt className="text-gw-muted">Method</dt>
            <dd>
              {dataset.data?.meta.method.candidate_clustering} + {dataset.data?.meta.method.topology_merge} · OSM base {dataset.data?.meta.source.osm_timestamp_base.slice(0, 10)}
            </dd>
            {verifiedLink && (
              <>
                <dt className="text-gw-muted">Plan parse</dt>
                <dd>
                  matrix {verifiedLink.junction.movement_matrix_confidence.toFixed(2)} · parse {verifiedLink.junction.parse_confidence.toFixed(2)}
                </dd>
              </>
            )}
            <dt className="text-gw-muted">Score</dt>
            <dd>
              {Object.entries(inter.score_components)
                .map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`)
                .join(", ")}
            </dd>
            {Object.keys(inter.osm_tags).length > 0 && (
              <>
                <dt className="text-gw-muted">Tags</dt>
                <dd>
                  {Object.entries(inter.osm_tags)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; ")}
                </dd>
              </>
            )}
          </dl>
        </details>
      </div>
    </AppShell>
  );
}

function nodeCoord(inter: Pick<Intersection, "lon" | "lat" | "approaches" | "osm_node_ids">, idx: number): [number, number] {
  const nodeId = inter.osm_node_ids[idx];
  const a = inter.approaches.find((x) => x.source_node_ids.includes(nodeId) && x.upstream_geometry.length);
  return a ? a.upstream_geometry[a.upstream_geometry.length - 1] : [inter.lon, inter.lat];
}
