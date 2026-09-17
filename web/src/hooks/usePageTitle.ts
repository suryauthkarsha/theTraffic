import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { pageView } from "@/lib/system/analytics";
import { applyRouteMeta, routeMeta } from "@/lib/system/seo";

/**
 * Every screen's document title and search metadata, from one table (`lib/system/routeMeta`): the tab
 * shows the same title a crawler downloads for that address ("Signal Map · Bengaluru traffic signals &
 * junction timing map · theTraffic."), a junction page carries the junction's name, and the
 * description, canonical address, robots directive and share cards are rewritten with it. Setting the
 * title is also the moment a screen counts as seen, so this is where the (optional) analytics page
 * view is sent — after any lazy chunk has arrived and with the final title. Pass `undefined` while a
 * title is not known yet (a junction still loading): the head is left alone and no view is counted
 * until it is; pass `null` for a screen whose name the table supplies, or for a junction that is not
 * on file.
 */
export function usePageTitle(title: string | null | undefined): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (title === undefined) return;
    const prev = document.title;
    const m = routeMeta(pathname, title);
    document.title = m.title;
    try {
      applyRouteMeta(document, m);
    } catch {
      /* a head without the expected tags is a missing crawler hint, never a broken screen */
    }
    pageView();
    return () => {
      document.title = prev;
    };
  }, [title, pathname]);
}
