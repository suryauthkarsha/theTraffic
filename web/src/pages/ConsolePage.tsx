import { ArrowRight, BookOpen, Cctv, FlaskConical, LifeBuoy, Map as MapIcon, Megaphone } from "lucide-react";
import { useEffect, type ComponentType } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { moduleForKey, MODULES, type ModuleId } from "@/lib/system/modules";

const ICONS: Record<ModuleId, ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>> = {
  signals: MapIcon,
  research: FlaskConical,
  methodology: BookOpen,
  support: LifeBuoy,
  surveillance: Cctv,
  grievances: Megaphone,
};

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Console (`/console`): the screen after the lander. Five tool cards — a title, one sentence and a
 * digit shortcut — under the page index. The system rail carries the probes; nothing is repeated here.
 */
const ConsolePage = () => {
  usePageTitle("Console");
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return;
      const m = moduleForKey(e.key);
      if (!m) return;
      e.preventDefault();
      navigate(m.to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
        <h1 className="eyebrow rise-in">
          <b>00</b> · console
        </h1>

        <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Tools">
          {MODULES.map((m, i) => {
            const Icon = ICONS[m.id];
            return (
              <li key={m.id} className="rise-in" style={{ animationDelay: `${i * 40}ms` }}>
                <Link to={m.to} className="panel group flex h-full flex-col p-5 transition-colors hover:bg-gw-hover">
                  <div className="flex items-center justify-between gap-3">
                    <span className="eyebrow">
                      <b>{m.index}</b>
                    </span>
                    <kbd className="kbd coarse:hidden" aria-label={`Shortcut ${m.key}`}>
                      {m.key}
                    </kbd>
                  </div>
                  <div className="mt-3 flex items-center gap-2.5">
                    <Icon size={18} className="shrink-0 text-gw-secondary" aria-hidden />
                    <h2 className="text-[19px] font-semibold text-gw-text">{m.title}</h2>
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-gw-secondary">{m.description}</p>
                  <ArrowRight size={15} className="mt-auto self-end pt-4 text-gw-muted transition-colors group-hover:text-gw-text" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </AppShell>
  );
};

export default ConsolePage;
