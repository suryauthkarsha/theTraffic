import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LockOpen, Megaphone, Plus, RefreshCw } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { GrievanceCard } from "@/components/grievance/GrievanceCard";
import { AppShell } from "@/components/layout/AppShell";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { usePageTitle } from "@/hooks/usePageTitle";
import { apiErrorMessage, checkModerator, fetchBoard, removeGrievance, type BoardPage } from "@/lib/grievance/api";
import { GRIEVANCE_KINDS, isGrievanceKind, type BoardGrievance, type GrievanceKind } from "@/lib/grievance/grievance";
import { useIsFramed } from "@/lib/system/frame";
import { cn } from "@/lib/utils";

const PAGE = 30;
const nf = new Intl.NumberFormat("en-IN");

/**
 * /grievances — the board: everything people have filed about Bengaluru's roads, newest first, on a
 * page that reads on a phone held out to someone who can act. Filter by kind; open a grievance's
 * junction; share or copy one. A moderator unlocks Remove with the passphrase (held in memory for the
 * visit only) — the board itself never asks who anyone is.
 */
export default function GrievancesPage() {
  usePageTitle("Grievances");
  const id = useId();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const framed = useIsFramed();
  const kindParam = params.get("kind");
  const kind: GrievanceKind | null = isGrievanceKind(kindParam) ? kindParam : null;

  const board = useInfiniteQuery({
    queryKey: ["grievances", kind],
    queryFn: ({ pageParam }) => fetchBoard({ before: pageParam, kind, limit: PAGE }),
    initialPageParam: null as number | null,
    getNextPageParam: (last: BoardPage) => last.next,
    staleTime: 30_000,
  });
  const items = useMemo(() => board.data?.pages.flatMap((p) => p.items) ?? [], [board.data]);
  const first = board.data?.pages[0];

  // `#g-<id>` (a shared link, or "See it on the board") scrolls to that card once it has rendered.
  const wantedId = location.hash.startsWith("#g-") ? location.hash.slice(3) : null;
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!wantedId || scrolled.current === wantedId) return;
    const el = document.getElementById(`g-${wantedId}`);
    if (!el) return;
    scrolled.current = wantedId;
    el.scrollIntoView({ block: "center" });
  }, [wantedId, items]);

  // Moderation: the passphrase lives in this component's state and nowhere else. Locking drops it
  // from the state and from the unlock mutation's memory alike.
  const [passphrase, setPassphrase] = useState<string>("");
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const [asking, setAsking] = useState<boolean>(false);
  const unlock = useMutation({
    mutationFn: (p: string) => checkModerator(p),
    onSuccess: (_ok, p) => {
      setUnlocked(p);
      setAsking(false);
      setPassphrase("");
    },
  });
  const lock = () => {
    setUnlocked(null);
    unlock.reset();
  };
  const remove = useMutation({
    mutationFn: (g: BoardGrievance) => removeGrievance(g.id, unlocked ?? ""),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["grievances"] }),
    onError: (e) => {
      if ((e as { status?: number }).status === 401) lock();
    },
  });

  const setKind = (k: GrievanceKind | null) => {
    const next = new URLSearchParams(params);
    if (k) next.set("kind", k);
    else next.delete("kind");
    setParams(next, { replace: true });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-4 pb-12 pt-4 sm:px-6">
        <Breadcrumb parent={{ to: "/console", label: "Console" }} current="Grievances" />
        <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">
              <b>06</b> · grievances{first ? ` · ${nf.format(first.total)} on the board` : ""}
            </div>
            <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.01em] text-gw-text">What people face on the road</h1>
            <p className="mt-2 max-w-[62ch] text-[13.5px] text-gw-secondary">Potholes, footpaths, water, crossings, signals, and lights, posted without an account and shown newest first.</p>
          </div>
          <Link to="/grievance" className="btn-primary h-11 text-[14px]">
            <Plus size={15} className="mr-1.5" aria-hidden /> File a grievance
          </Link>
        </header>

        {/* Kind filter: one row of chips with live counts; "All" first. Wraps on phones. */}
        <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
          <button type="button" onClick={() => setKind(null)} aria-pressed={kind === null} className={cn("chip", kind === null && "border-gw-orange/50 text-gw-text")}>
            All{first ? <span className="mono ml-1 text-gw-muted">{nf.format(Object.values(first.byKind).reduce((s, n) => s + n, 0))}</span> : null}
          </button>
          {GRIEVANCE_KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className={cn("chip", kind === k.id && "border-gw-orange/50 text-gw-text")}>
              {k.short}
              {first ? <span className="mono ml-1 text-gw-muted">{nf.format(first.byKind[k.id] ?? 0)}</span> : null}
            </button>
          ))}
        </div>

        {board.isError && (
          <div className="card-inset mt-5 flex flex-wrap items-center gap-3 p-3 text-[13px]" role="alert">
            <span className="text-gw-ember">{apiErrorMessage(board.error)}</span>
            <button type="button" className="btn-secondary h-9 text-[12px]" onClick={() => void board.refetch()}>
              <RefreshCw size={12} className="mr-1.5" aria-hidden /> Try again
            </button>
          </div>
        )}
        {board.isPending && (
          <div className="mt-8 flex justify-center" role="status" aria-live="polite">
            <span className="chip">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gw-orange" aria-hidden /> loading the board
            </span>
          </div>
        )}
        {board.isSuccess && items.length === 0 && (
          <div className="panel panel-hud mt-5 flex flex-col items-start gap-3 p-5 text-[14px] text-gw-secondary">
            <Megaphone size={18} className="text-gw-orange" aria-hidden />
            <p>{kind ? `Nothing filed about ${GRIEVANCE_KINDS.find((k) => k.id === kind)?.label.toLowerCase() ?? kind} yet.` : "Nothing on the board yet."}</p>
            <Link to={kind ? `/grievance?kind=${kind}` : "/grievance"} className="btn-secondary h-11 text-[13px]">
              File the first one
            </Link>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
            {items.map((g) => (
              <GrievanceCard key={g.id} g={g} highlighted={g.id === wantedId} onRemove={unlocked && !framed ? (x) => remove.mutate(x) : undefined} removing={remove.isPending && remove.variables?.id === g.id} />
            ))}
          </div>
        )}
        {remove.isError && (
          <p className="mt-3 text-[12px] text-gw-ember" role="alert">
            {apiErrorMessage(remove.error)}
          </p>
        )}
        {board.hasNextPage && (
          <div className="mt-6 flex justify-center">
            <button type="button" className="btn-secondary h-11 text-[13px]" onClick={() => void board.fetchNextPage()} disabled={board.isFetchingNextPage} aria-busy={board.isFetchingNextPage}>
              {board.isFetchingNextPage ? "Loading…" : "Older"}
            </button>
          </div>
        )}

        {/* Moderation: one quiet line at the foot of the board. The passphrase is typed here, checked once, kept in memory for this visit. */}
        <div className="mt-10 border-t border-gw-border pt-4 text-[12px] text-gw-muted">
          {framed ? (
            <p>Open this page directly to moderate. Moderator actions are disabled inside an embedded frame.</p>
          ) : unlocked ? (
            <span className="inline-flex items-center gap-1.5">
              <LockOpen size={12} className="text-gw-orange" aria-hidden /> Moderation is on for this visit.
              <button type="button" className="ml-2 underline hover:text-gw-text" onClick={lock}>
                Lock
              </button>
            </span>
          ) : asking ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (passphrase.trim()) unlock.mutate(passphrase.trim());
              }}
            >
              <label htmlFor={`${id}-pass`} className="sr-only">
                Moderator passphrase
              </label>
              <input id={`${id}-pass`} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" autoFocus className="input-field h-10 w-64 max-w-full bg-gw-card text-[13px] text-gw-text outline-none" placeholder="passphrase" />
              <button type="submit" className="btn-secondary h-10 text-[12px]" disabled={unlock.isPending || !passphrase.trim()} aria-busy={unlock.isPending}>
                Unlock
              </button>
              <button type="button" className="min-h-[32px] px-2 underline hover:text-gw-text coarse:min-h-[44px]" onClick={() => setAsking(false)}>
                Cancel
              </button>
              {unlock.isError && (
                <span className="text-gw-ember" role="alert">
                  {apiErrorMessage(unlock.error)}
                </span>
              )}
            </form>
          ) : (
            <button type="button" className="inline-flex min-h-[32px] items-center gap-1.5 hover:text-gw-text coarse:min-h-[44px]" onClick={() => setAsking(true)}>
              <KeyRound size={12} aria-hidden /> Moderator
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
