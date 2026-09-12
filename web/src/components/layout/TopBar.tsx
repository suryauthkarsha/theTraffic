import { LifeBuoy, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { BRAND_CITY, BRAND_NAME } from "@/lib/system/brand";
import { cn } from "@/lib/utils";

import { Wordmark } from "./Wordmark";

export interface NavTab {
  to: string;
  label: string;
  match: (p: string) => boolean;
}

/**
 * The one navigation model for every page (audit finding 7): four primary tabs plus Support.
 * Secondary pages (intersection detail, support) also carry a breadcrumb back to their parent tab —
 * see `Breadcrumb`. There is no sign-in and nothing to contribute: the site shows data, it does not
 * collect it.
 */
export const PRIMARY_TABS: NavTab[] = [
  { to: "/signals", label: "Signal Map", match: (p) => p.startsWith("/signals") || p.startsWith("/intersection") },
  { to: "/surveillance", label: "Surveillance", match: (p) => p.startsWith("/surveillance") },
  { to: "/research", label: "Research", match: (p) => p.startsWith("/research") },
  { to: "/methodology", label: "Methodology", match: (p) => p.startsWith("/methodology") },
];
/** Support, and its one subpage: `/grievance` lights the same entry. */
export const SUPPORT_TAB: NavTab = { to: "/support", label: "Support", match: (p) => p.startsWith("/support") || p.startsWith("/grievance") };
/** The console (`/console`) — where the wordmark leads from inside the app. The public lander is `/`. */
export const CONSOLE_TAB: NavTab = { to: "/console", label: "Console", match: (p) => p === "/console" };

/** Which tab is active for a pathname (exactly one, or none for 404). Pure; exported for tests. */
export function activeTab(pathname: string): NavTab | null {
  return [...PRIMARY_TABS, SUPPORT_TAB, CONSOLE_TAB].find((t) => t.match(pathname)) ?? null;
}

/**
 * Shared 56 px top bar — the only site navigation. Sits over the map on map screens. On notched
 * phones (installed as a web app) it grows by the status-bar safe area and keeps its content below it.
 */
export function TopBar({ overlay = false }: { overlay?: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className={cn("z-40 h-[var(--gw-top)] shrink-0 border-b border-gw-border bg-gw-canvas/95 pt-[var(--gw-safe-top)] backdrop-blur-sm", overlay ? "absolute inset-x-0 top-0" : "sticky top-0")} role="banner">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-[calc(var(--gw-safe-top)+0.5rem)] focus:z-50 focus:rounded-md focus:bg-gw-orange focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-gw-canvas">
        Skip to content
      </a>
      <div className="flex h-full items-center gap-6 px-4 sm:px-6">
        <Link to={CONSOLE_TAB.to} className="flex min-h-[44px] items-center gap-2.5" aria-label={`${BRAND_NAME} ${BRAND_CITY} console`}>
          <Wordmark />
        </Link>

        <nav className="hidden h-full flex-1 items-center justify-center gap-1 md:flex" aria-label="Primary">
          {PRIMARY_TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <NavLink key={t.to} to={t.to} className={cn("relative flex h-full items-center px-4 text-[14px] transition-colors", active ? "text-gw-text" : "text-gw-secondary hover:text-gw-text")} aria-current={active ? "page" : undefined}>
                {t.label}
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-gw-orange" aria-hidden />}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link to={SUPPORT_TAB.to} className={cn("btn-secondary hidden h-10 px-3.5 text-[13px] sm:inline-flex", SUPPORT_TAB.match(pathname) && "border-gw-orange/50 text-gw-text")} aria-current={SUPPORT_TAB.match(pathname) ? "page" : undefined} title="Help, FAQ and a way to report a problem">
            <LifeBuoy size={14} className="text-gw-secondary" aria-hidden />
            <span className="ml-1.5">{SUPPORT_TAB.label}</span>
          </Link>
          <button type="button" className="btn-secondary h-11 w-11 px-0 md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((v) => !v)}>
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default bg-gw-canvas/60 md:hidden" aria-label="Close menu" onClick={() => setOpen(false)} />
          <nav id="mobile-nav" className="panel absolute inset-x-3 top-[calc(100%+4px)] z-40 flex flex-col p-2 md:hidden" aria-label="Primary mobile">
            {[CONSOLE_TAB, ...PRIMARY_TABS, SUPPORT_TAB].map((t) => (
              <NavLink key={t.to} to={t.to} onClick={() => setOpen(false)} className={cn("flex min-h-[48px] items-center rounded-md px-3 py-2.5 text-[16px]", t.match(pathname) ? "bg-gw-hover text-gw-text" : "text-gw-secondary")} aria-current={t.match(pathname) ? "page" : undefined}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </header>
  );
}
