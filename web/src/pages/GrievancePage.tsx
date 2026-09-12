import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Camera, Check, ImageUp, Megaphone, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { PlacePicker } from "@/components/grievance/PlacePicker";
import { AppShell } from "@/components/layout/AppShell";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { usePageTitle } from "@/hooks/usePageTitle";
import { findIntersection, useIntersectionDataset } from "@/lib/data/dataset";
import type { Intersection } from "@/lib/data/types";
import { apiErrorMessage, postGrievance } from "@/lib/grievance/api";
import { fmtBytes, GRIEVANCE_KINDS, isGrievanceKind, junctionPlace, toSubmission, validateGrievance, WORDS_MAX, type BoardGrievance, type GrievanceDraft, type GrievanceKind, type GrievancePhoto, type GrievancePlace } from "@/lib/grievance/grievance";
import { photoErrorMessage, shrinkPhoto } from "@/lib/grievance/photo";
import { useIsFramed } from "@/lib/system/frame";
import { cn } from "@/lib/utils";

/** One stable empty list while the dataset loads, so the picker's memos do not churn. */
const EMPTY: readonly Intersection[] = [];

/**
 * /grievance — what you face on the road: a pothole, a footpath that stops, standing water, nowhere to
 * cross, a signal or a light out. A photo, the place, or both, posted without an account to the public
 * board at /grievances. The form does not request identity, but visible content can still identify people.
 */
export default function GrievancePage() {
  usePageTitle("Grievance");
  const id = useId();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const framed = useIsFramed();
  const dataset = useIntersectionDataset();
  const intersections = dataset.data?.intersections ?? EMPTY;

  const wantedKind = params.get("kind");
  const [draft, setDraft] = useState<GrievanceDraft>({ kind: isGrievanceKind(wantedKind) ? wantedKind : "pothole", message: "", website: "" });
  const [place, setPlace] = useState<GrievancePlace | null>(null);
  const [photo, setPhoto] = useState<GrievancePhoto | null>(null);
  const [shrinking, setShrinking] = useState<boolean>(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [touched, setTouched] = useState<boolean>(false);
  const [posted, setPosted] = useState<BoardGrievance | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // `?junction=<id>` pre-marks a junction on file — once, so Clear is not undone when the data settles.
  const wanted = params.get("junction");
  const prefilled = useRef<boolean>(false);
  useEffect(() => {
    if (prefilled.current || !wanted || !dataset.data) return;
    prefilled.current = true;
    const i = findIntersection(dataset.data, wanted);
    if (i) setPlace(junctionPlace(i));
  }, [wanted, dataset.data]);

  // The preview needs an object URL; it is released when the photo changes or the page closes.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo.blob);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const validation = validateGrievance(draft, place, photo !== null);

  const post = useMutation({
    mutationFn: () => postGrievance(toSubmission(draft, place), photo),
    onSuccess: (g) => {
      setPosted(g);
      setDraft({ kind: draft.kind, message: "", website: "" });
      setPlace(null);
      setPhoto(null);
      setTouched(false);
      // The board's cached pages are stale now: the next visit fetches afresh, so the post is there.
      void queryClient.invalidateQueries({ queryKey: ["grievances"] });
    },
  });

  const edit = (patch: Partial<GrievanceDraft>) => {
    post.reset();
    setDraft((d) => ({ ...d, ...patch }));
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    post.reset();
    setShrinking(true);
    try {
      setPhoto(await shrinkPhoto(file));
    } catch (e) {
      setPhotoError(photoErrorMessage(e));
    } finally {
      setShrinking(false);
    }
  };
  /** The input is reset at once, so picking the same photo again fires again. */
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    void pick(file);
  };

  const submit = () => {
    setTouched(true);
    if (validation || post.isPending || shrinking || framed) return;
    setPosted(null);
    post.mutate();
  };

  const secondary = "btn-secondary h-11 text-[13px]";

  return (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-4 pb-12 pt-4 sm:px-6">
        <Breadcrumb parent={{ to: "/grievances", label: "Grievances" }} current="File one" />
        <header className="mt-4">
          <div className="eyebrow">
            <b>06</b> · grievances · file one
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.01em] text-gw-text">File a grievance</h1>
          <p className="mt-2 max-w-[62ch] text-[13.5px] text-gw-secondary">A photo, the place, or both. It goes on the public board without an account. The post itself may identify a person or private place.</p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
          aria-describedby={`${id}-validation`}
          noValidate
        >
          <div className="space-y-6">
            <section className="panel p-4 sm:p-5" aria-labelledby={`${id}-photo`}>
              <h2 id={`${id}-photo`} className="text-[15px] font-semibold text-gw-text">
                Photo
              </h2>
              <div className="rule mt-3" aria-hidden />
              <p className="mt-3 text-[12px] leading-relaxed text-gw-secondary">Before posting, crop or avoid faces, vehicle plates, house numbers, documents, and other identifying details. Metadata is removed, but visible pixels are not blurred.</p>
              {/* The operating system's picker does the capturing: no live camera, no permission prompt of ours. */}
              <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden onChange={onFile} />
              <input ref={fileInput} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden onChange={onFile} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={cn(secondary, "fine:hidden")} onClick={() => cameraInput.current?.click()} disabled={shrinking}>
                  <Camera size={14} className="mr-1.5" aria-hidden /> Take a photo
                </button>
                <button type="button" className={secondary} onClick={() => fileInput.current?.click()} disabled={shrinking}>
                  <ImageUp size={14} className="mr-1.5" aria-hidden /> {photo ? "Choose another" : "Choose a photo"}
                </button>
                {shrinking && (
                  <span className="chip self-center" role="status">
                    <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gw-orange" aria-hidden /> shrinking
                  </span>
                )}
              </div>
              {photoError && (
                <p className="mt-2 text-[12px] text-gw-ember" role="alert">
                  {photoError}
                </p>
              )}
              {photo && photoUrl && (
                <figure className="mt-3">
                  <div className="card-inset flex max-h-[300px] items-center justify-center overflow-hidden bg-gw-canvas">
                    <img src={photoUrl} alt="The photo you attached" className="max-h-[300px] w-auto max-w-full object-contain" />
                  </div>
                  <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gw-muted">
                    <span className="mono">
                      {photo.width}×{photo.height} · {fmtBytes(photo.bytes)} · from {fmtBytes(photo.originalBytes)}
                    </span>
                    <span>metadata dropped</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPhoto(null);
                        post.reset();
                      }}
                      className="ml-auto inline-flex min-h-[32px] items-center text-gw-secondary hover:text-gw-text coarse:min-h-[44px]"
                    >
                      Remove
                    </button>
                  </figcaption>
                </figure>
              )}
            </section>

            <section className="panel p-4 sm:p-5" aria-labelledby={`${id}-place`}>
              <h2 id={`${id}-place`} className="text-[15px] font-semibold text-gw-text">
                Place
              </h2>
              <div className="rule mt-3" aria-hidden />
              {dataset.isError && (
                <p className="mt-3 text-[12px] text-gw-ember" role="alert">
                  Junction names could not be loaded — the map still works.
                </p>
              )}
              <div className="mt-3">
                <PlacePicker
                  intersections={intersections}
                  place={place}
                  onPick={(p) => {
                    post.reset();
                    setPlace(p);
                  }}
                  onClear={() => setPlace(null)}
                />
              </div>
            </section>
          </div>

          <section className="panel panel-hud self-start p-4 sm:p-5" aria-labelledby={`${id}-words`}>
            <div className="flex items-center gap-2">
              <Megaphone size={17} className="text-gw-orange" aria-hidden />
              <h2 id={`${id}-words`} className="text-[17px] font-semibold text-gw-text">
                What you face
              </h2>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="label">About</span>
                <select value={draft.kind} onChange={(e) => edit({ kind: e.target.value as GrievanceKind })} className="mt-1 h-11 w-full rounded-[4px] border border-gw-border bg-gw-card px-3 text-[14px] text-gw-text outline-none focus:border-gw-orange">
                  {GRIEVANCE_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label">In your words{draft.kind === "other" && !photo ? "" : " (optional)"}</span>
                <textarea value={draft.message} onChange={(e) => edit({ message: e.target.value })} onBlur={() => setTouched(true)} rows={5} maxLength={WORDS_MAX + 200} placeholder="What it is, since when, who it affects." className="mt-1 w-full resize-y rounded-[4px] border border-gw-border bg-gw-card px-3 py-2.5 text-[14px] leading-relaxed text-gw-text outline-none placeholder:text-gw-muted focus:border-gw-orange" />
                <span className="mono mt-1 block text-right text-[11px] text-gw-muted">
                  {draft.message.trim().length.toLocaleString("en-IN")} / {WORDS_MAX.toLocaleString("en-IN")}
                </span>
              </label>

              {/* Honeypot: hidden from people, filled by naive bots. */}
              <label className="sr-only" aria-hidden>
                Website
                <input tabIndex={-1} autoComplete="off" value={draft.website} onChange={(e) => edit({ website: e.target.value })} />
              </label>

              {touched && validation && (
                <p id={`${id}-validation`} className="text-[12px] text-gw-ember" role="alert">
                  {validation}
                </p>
              )}

              {framed && (
                <p className="text-[12px] text-gw-ember" role="alert">
                  Open this page directly to post. Posting is disabled inside an embedded frame.
                </p>
              )}

              <button type="submit" className="btn-primary h-11 w-full text-[14px]" disabled={post.isPending || shrinking || framed} aria-busy={post.isPending}>
                {post.isPending ? (
                  <>
                    <span className="pulse-dot mr-2 h-1.5 w-1.5 rounded-full bg-gw-canvas" aria-hidden /> Posting…
                  </>
                ) : (
                  <>
                    <Send size={15} className="mr-2" aria-hidden /> Post to the board
                  </>
                )}
              </button>

              {post.isError && (
                <p className="text-[12px] text-gw-ember" role="alert">
                  {apiErrorMessage(post.error)}
                </p>
              )}
              {posted && (
                <div className="card-inset p-3 text-[13px]" role="status">
                  <p className="text-gw-orange">
                    <Check size={14} className="mr-1 inline" aria-hidden /> Posted. It is on the board now.
                  </p>
                  <Link to={`/grievances#g-${posted.id}`} className="mt-2 inline-flex min-h-[32px] items-center text-gw-text underline decoration-gw-muted underline-offset-2 hover:decoration-gw-orange coarse:min-h-[44px]">
                    See it on the board <ArrowRight size={13} className="ml-1" aria-hidden />
                  </Link>
                </div>
              )}
            </div>
          </section>
        </form>
      </div>
    </AppShell>
  );
}
