import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { pageView } from "@/lib/system/analytics";
import { BRAND_CITY, BRAND_NAME } from "@/lib/system/brand";
import { applyRouteMeta, routeMeta } from "@/lib/system/seo";

/**
 * Consistent document titles across every page ("Signal Map · theTraffic."); the lander alone carries
 * the city ("theTraffic. · Bengaluru"). Setting a title is also the moment a screen counts as seen, so
 * this is where the (optional) analytics page view is sent — after any lazy chunk has arrived and with
 * the final title — and where the screen's search metadata (description, canonical address, share
 * cards; `lib/system/seo`) is written into the head. Pass `undefined` while a title is not known yet
 * (a junction still loading): the title is left alone and no view is counted until it is.
 */
export function usePageTitle(title: string | null | undefined): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (title === undefined) return;
    const prev = document.title;
    document.title = title ? `${title} · ${BRAND_NAME}` : `${BRAND_NAME} · ${BRAND_CITY}`;
    try {
      applyRouteMeta(document, routeMeta(pathname, title));
    } catch {
      /* a head without the expected tags is a missing crawler hint, never a broken screen */
    }
    pageView();
    return () => {
      document.title = prev;
    };
  }, [title, pathname]);
}
