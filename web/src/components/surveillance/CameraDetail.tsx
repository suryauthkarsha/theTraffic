import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Pill } from "@/components/ui/pills";
import { fmtDate } from "@/lib/format";
import { compassLabel, OSM_EDIT_URL, OSM_NODE_URL, type Camera } from "@/lib/surveillance/normalize";
import { cn } from "@/lib/utils";

/** What a record is called when it has no name: from `surveillance:type`, never invented. */
export function cameraTitle(c: Camera): string {
  if (c.name) return c.name;
  switch (c.kind) {
    case "camera":
      return "Camera";
    case "alpr":
      return "Number-plate reader";
    case "guard":
      return "Guard post";
    case "viewpoint":
      return "Viewpoint";
    case "other":
      return c.surveillanceType ?? "Surveillance point";
    case "none":
      return "Surveillance point";
  }
}

/** "90° E · 270° W", the raw text when it could not be read, or null when nothing is mapped. */
export function directionText(c: Camera): { text: string; mapped: boolean } | null {
  if (c.directions.length) return { text: c.directions.map((d) => `${Number.isInteger(d) ? d : d.toFixed(1)}° ${compassLabel(d)}`).join(" · "), mapped: true };
  if (c.directionRaw) return { text: `${c.directionRaw} (not readable as a heading)`, mapped: false };
  return null;
}

const NOT_MAPPED = "Not mapped";

function Row({ label, value, mono = false, muted = false }: { label: string; value: ReactNode; mono?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-gw-border/60 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-gw-secondary">{label}</dt>
      <dd className={cn("min-w-0 text-right", mono && "mono", muted ? "text-gw-muted" : "text-gw-text")}>{value}</dd>
    </div>
  );
}

/** A tag value or "Not mapped", muted. */
function Field({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return <Row label={label} value={value ?? NOT_MAPPED} mono={mono && value !== null} muted={value === null} />;
}

/**
 * One record, exactly as mapped: what kind of device, whom it watches, which way it points, who runs
 * it — or "Not mapped" for each thing nobody has recorded. Nothing here says a camera is on, recording
 * or owned by the police; the record is community-mapped and links back to OpenStreetMap to view or fix.
 */
export function CameraDetail({ camera, onClose, className }: { camera: Camera; onClose: () => void; className?: string }) {
  const root = useRef<HTMLElement | null>(null);
  const direction = directionText(camera);
  const tags = Object.entries(camera.tags);

  // Opening the panel moves focus into it so keyboard users land on what they just chose.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [camera.id]);

  return (
    <section ref={root} tabIndex={-1} aria-label={`Camera record ${camera.id}`} className={cn("flex flex-col gap-3 text-[13px] outline-none", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">
            <b>node</b> · {camera.id}
          </div>
          <h2 className="mt-1 truncate text-[17px] font-semibold text-gw-text">{cameraTitle(camera)}</h2>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] text-gw-secondary hover:bg-gw-hover hover:text-gw-text" aria-label="Close camera details">
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone="grey">Community-mapped record</Pill>
        {camera.surveyDate && (
          <Pill tone="grey" mono>
            surveyed {camera.surveyDate}
          </Pill>
        )}
      </div>

      <dl className="card-inset px-3 py-1">
        <Field label="Camera type" value={camera.cameraTypeRaw} />
        <Field label="Surveillance" value={camera.surveillance} />
        <Field label="Zone" value={camera.zoneRaw} />
        <Field label="Device" value={camera.surveillanceType} />
        <Row label="Direction" value={direction?.text ?? NOT_MAPPED} mono={direction?.mapped ?? false} muted={!direction} />
        <Field label="Mount" value={camera.mount} />
        <Field label="Operator" value={camera.operator} />
        <Field label="Reference" value={camera.ref} />
        {camera.description && <Row label="Description" value={camera.description} />}
        <Row
          label="Last OSM edit"
          value={
            <>
              v{camera.version} · {fmtDate(camera.updatedAt)}
            </>
          }
          mono
        />
        <Row label="Position" value={`${camera.lat.toFixed(5)}, ${camera.lon.toFixed(5)}`} mono />
      </dl>

      <div className="grid grid-cols-2 gap-2">
        <a href={OSM_NODE_URL(camera.id)} target="_blank" rel="noopener noreferrer" className="btn-secondary h-10 gap-1.5 px-3 text-[13px]">
          View on OpenStreetMap <ExternalLink size={12} aria-hidden />
        </a>
        <a href={OSM_EDIT_URL(camera.id)} target="_blank" rel="noopener noreferrer" className="btn-secondary h-10 gap-1.5 px-3 text-[13px]">
          Improve this record <ExternalLink size={12} aria-hidden />
        </a>
      </div>
      <p className="text-[12px] text-gw-muted">
        Editing needs a free OpenStreetMap account; changes land in OpenStreetMap, not here.{" "}
        <Link to={`/support?topic=camera&ref=${encodeURIComponent(`node/${camera.id}`)}&from=${encodeURIComponent(`/surveillance?camera=${camera.id}`)}`} className="text-gw-secondary underline decoration-gw-muted underline-offset-2 hover:text-gw-text">
          Report a problem
        </Link>{" "}
        instead if you would rather tell us.
      </p>

      <details className="card-inset text-[12.5px]">
        <summary className="cursor-pointer select-none px-3 py-2 text-gw-secondary hover:text-gw-text">All tags · {tags.length}</summary>
        <dl className="mono grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1 border-t border-gw-border px-3 py-2 text-[11.5px]">
          {tags.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="truncate text-gw-muted">{k}</dt>
              <dd className="break-words text-gw-text">{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
