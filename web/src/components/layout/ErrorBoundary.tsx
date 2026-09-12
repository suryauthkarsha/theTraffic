import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { isChunkLoadError, recoverFromStaleBuild } from "@/lib/system/staleBuild";
import { BUILD_STAMP } from "@/lib/system/status";

interface Props {
  children: ReactNode;
  /** Reloads the tab once for a stale-build failure; injectable for tests. */
  recover?: (error: Error) => boolean;
}
interface State {
  error: Error | null;
}

/**
 * Last line of defence, with two faces. A chunk that could not be loaded means this tab holds a
 * build that has since been replaced (every deploy renames the chunks): the panel says so and the
 * tab reloads itself once (lib/system/staleBuild.ts). Anything else is a render failure: a
 * deliberate panel with the message, a reload and a pre-filled support link instead of a blank page,
 * logged once (sanitised — the message and component stack, never user data).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadError(error)) {
      console.warn("[thetraffic] this tab holds a build that has been replaced:", error.message);
      (this.props.recover ?? recoverFromStaleBuild)(error);
      return;
    }
    console.error("[thetraffic] render failure:", error.message, info.componentStack?.split("\n").slice(0, 4).join(" "));
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isChunkLoadError(error)) return <StaleBuildPanel />;
    const detail = `${error.name}: ${error.message}`.slice(0, 300);
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    const support = `/support?topic=bug&from=${encodeURIComponent(path)}&detail=${encodeURIComponent(detail)}`;
    return (
      <div className="flex min-h-full items-center justify-center bg-gw-canvas px-6 py-16">
        <div className="grid-bg pointer-events-none fixed inset-0" aria-hidden />
        <section className="panel panel-hud relative w-full max-w-[560px] p-7 rise-in" role="alert" aria-labelledby="gw-error-title">
          <div className="eyebrow">
            <b>error</b> · build {BUILD_STAMP}
          </div>
          <h1 id="gw-error-title" className="mt-3 flex items-center gap-2 text-[22px] font-semibold text-gw-text">
            <AlertTriangle size={20} className="text-gw-ember" aria-hidden /> Something broke on this screen
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-gw-secondary">Reload to try again — if it keeps happening, send us the report.</p>
          <pre className="card-inset mono mt-4 overflow-x-auto p-3 text-[11.5px] leading-relaxed text-gw-secondary">{detail}</pre>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              <RotateCcw size={15} className="mr-2" aria-hidden /> Reload
            </button>
            <a href={support} className="btn-secondary h-11">
              Send the report
            </a>
            <a href="/console" className="btn-secondary h-11">
              Console
            </a>
          </div>
        </section>
      </div>
    );
  }
}

/** The tab is behind the site, not broken: no error detail, no report — a reload is the whole remedy. */
function StaleBuildPanel() {
  return (
    <div className="flex min-h-full items-center justify-center bg-gw-canvas px-6 py-16">
      <div className="grid-bg pointer-events-none fixed inset-0" aria-hidden />
      <section className="panel panel-hud relative w-full max-w-[560px] p-7 rise-in" role="status" aria-live="polite" aria-labelledby="gw-stale-title">
        <div className="eyebrow">
          <b>update</b> · build {BUILD_STAMP}
        </div>
        <h1 id="gw-stale-title" className="mt-3 flex items-center gap-2 text-[22px] font-semibold text-gw-text">
          <RefreshCw size={20} className="text-gw-orange" aria-hidden /> A newer version of the site is ready
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-gw-secondary">It was published while this tab was open — reload to pick it up.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            <RotateCcw size={15} className="mr-2" aria-hidden /> Reload
          </button>
          <a href="/console" className="btn-secondary h-11">
            Console
          </a>
        </div>
      </section>
    </div>
  );
}
