import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Secondary-page breadcrumb: "← <parent tab> / <current>". Same placement on the junction and support
 * pages so leaving a detail view always works the same way. `parent.state` travels with the link (the
 * junction page uses it to ask the Signal Map to reopen where the visitor left).
 */
export function Breadcrumb({ parent, current }: { parent: { to: string; label: string; state?: unknown }; current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[13px] text-gw-secondary">
      <Link to={parent.to} state={parent.state} className="inline-flex min-h-[44px] items-center gap-1.5 hover:text-gw-text">
        <ArrowLeft size={14} aria-hidden /> {parent.label}
      </Link>
      <span aria-hidden>/</span>
      <span className="truncate text-gw-text" aria-current="page">
        {current}
      </span>
    </nav>
  );
}
