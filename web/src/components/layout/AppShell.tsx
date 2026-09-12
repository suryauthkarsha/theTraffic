import type { ReactNode } from "react";

import { StatusRail } from "./StatusRail";
import { TopBar } from "./TopBar";

/**
 * Page chrome. `mapScreen` puts the top bar over a full-bleed map with the system rail along the
 * bottom edge; otherwise content scrolls over the engineering grid under a static bar, with the
 * one-line attribution footer and a sticky system rail. Bar and rail heights include the device safe areas
 * (`--gw-top`, `--gw-rail`), so the map region is exactly the space between them on every phone.
 */
export function AppShell({ children, mapScreen = false }: { children: ReactNode; mapScreen?: boolean }) {
  if (mapScreen) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-gw-canvas">
        <TopBar overlay />
        <main className="absolute inset-0 pb-[var(--gw-rail)] pt-[var(--gw-top)]" id="main">
          {children}
        </main>
        <StatusRail overlay />
      </div>
    );
  }
  return (
    <div className="relative flex min-h-full flex-col bg-gw-canvas">
      <div className="grid-bg pointer-events-none fixed inset-0" aria-hidden />
      <TopBar />
      <main className="relative flex-1" id="main">
        {children}
      </main>
      <footer className="relative border-t border-gw-border px-4 py-3 text-[12px] leading-relaxed text-gw-muted sm:px-6">
        <span className="mono">© OpenStreetMap contributors (ODbL)</span>
      </footer>
      <StatusRail />
    </div>
  );
}
