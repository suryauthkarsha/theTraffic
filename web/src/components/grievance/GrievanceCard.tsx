import { ClipboardCopy, ImageOff, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Pill } from "@/components/ui/pills";
import { photoUrl } from "@/lib/grievance/api";
import { boardLink, fmtBoardTime, fmtCoord, formatBoardGrievance, kindShort, osmLink, PLACE_SOURCE_LABEL, type BoardGrievance } from "@/lib/grievance/grievance";
import { cn } from "@/lib/utils";

export interface GrievanceCardProps {
  g: BoardGrievance;
  /** True when this card is the one a link (`#g-<id>`) points at. */
  highlighted?: boolean;
  /** Present only for a moderator who has unlocked removal. */
  onRemove?: (g: BoardGrievance) => void;
  removing?: boolean;
}

/**
 * One grievance on the board: the photo (when any) on top, then kind · time, the place with its
 * junction link, the words, and two quiet actions — share the link with its words, or copy them. A
 * moderator sees a third: Remove. Nothing on the card says who filed it; there is nothing to say.
 */
export function GrievanceCard({ g, highlighted = false, onRemove, removing = false }: GrievanceCardProps) {
  const [photoState, setPhotoState] = useState<"loading" | "ok" | "failed">(g.photo ? "loading" : "ok");
  const [done, setDone] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = boardLink(origin, g.id);
  const text = formatBoardGrievance(g, link);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const share = async () => {
    try {
      await navigator.share({ title: "theTraffic. — grievance", text });
    } catch (e) {
      if ((e as { name?: unknown } | null)?.name !== "AbortError") flash("Sharing did not work here — copy instead.");
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied.");
    } catch {
      flash("Clipboard blocked.");
    }
  };
  const flash = (msg: string) => {
    setDone(msg);
    window.setTimeout(() => setDone(null), 2_000);
  };

  return (
    <article id={`g-${g.id}`} className={cn("panel flex flex-col overflow-hidden", highlighted && "border-gw-orange/60")} aria-label={`${kindShort(g.kind)} grievance, ${fmtBoardTime(g.filedAt)}`}>
      {g.photo && photoState !== "failed" && (
        <a href={photoUrl(g.id)} target="_blank" rel="noopener noreferrer" className="relative block bg-gw-canvas" aria-label="Open the photo full size">
          {/* The board's own JPEG: shrunk and stripped of metadata in the browser, checked and stripped again on the server. */}
          <img src={photoUrl(g.id)} alt={`Photo of a ${kindShort(g.kind).toLowerCase()} grievance`} width={g.photo.width} height={g.photo.height} loading="lazy" decoding="async" onLoad={() => setPhotoState("ok")} onError={() => setPhotoState("failed")} className={cn("block max-h-[360px] w-full object-cover transition-opacity", photoState === "loading" ? "opacity-0" : "opacity-100")} style={{ aspectRatio: `${g.photo.width} / ${g.photo.height}` }} />
          {photoState === "loading" && <span className="pulse-dot absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gw-orange" aria-hidden />}
        </a>
      )}
      {g.photo && photoState === "failed" && (
        <div className="flex h-24 items-center justify-center gap-2 bg-gw-canvas text-[12px] text-gw-muted">
          <ImageOff size={14} aria-hidden /> photo unavailable
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="orange">{kindShort(g.kind)}</Pill>
          <time dateTime={new Date(g.filedAt).toISOString()} className="mono text-[11px] text-gw-muted">
            {fmtBoardTime(g.filedAt)} IST
          </time>
        </div>
        {g.place ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
            {g.place.junction ? (
              <Link to={`/intersection/${g.place.junction.id}`} className="text-gw-text underline decoration-gw-muted underline-offset-2 hover:decoration-gw-orange">
                {g.place.junction.distanceM > 0 ? `near ${g.place.junction.name}` : g.place.junction.name}
              </Link>
            ) : (
              <span className="text-gw-secondary">{PLACE_SOURCE_LABEL[g.place.source]}</span>
            )}
            <a href={osmLink([g.place.lng, g.place.lat])} target="_blank" rel="noopener noreferrer" className="mono text-[11px] text-gw-muted underline decoration-gw-border underline-offset-2 hover:text-gw-text">
              {fmtCoord([g.place.lng, g.place.lat])}
            </a>
            {g.place.accuracyM !== null && <span className="mono text-[11px] text-gw-muted">±{g.place.accuracyM} m</span>}
          </div>
        ) : (
          <div className="text-[12px] text-gw-muted">place not marked</div>
        )}
        {g.words && <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gw-text">{g.words}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1 text-[12px]">
          {canShare && (
            <button type="button" onClick={() => void share()} className="inline-flex min-h-[32px] items-center gap-1 rounded px-1.5 text-gw-secondary hover:text-gw-text coarse:min-h-[44px]">
              <Share2 size={13} aria-hidden /> Share
            </button>
          )}
          <button type="button" onClick={() => void copy()} className="inline-flex min-h-[32px] items-center gap-1 rounded px-1.5 text-gw-secondary hover:text-gw-text coarse:min-h-[44px]">
            <ClipboardCopy size={13} aria-hidden /> Copy
          </button>
          {onRemove && (
            <button type="button" onClick={() => onRemove(g)} disabled={removing} aria-busy={removing} className="ml-auto inline-flex min-h-[32px] items-center gap-1 rounded px-1.5 text-gw-red hover:text-gw-text disabled:opacity-50 coarse:min-h-[44px]">
              <Trash2 size={13} aria-hidden /> {removing ? "Removing…" : "Remove"}
            </button>
          )}
          {done && (
            <span className="mono ml-auto text-[11px] text-gw-orange" role="status">
              {done}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
