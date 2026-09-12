import * as React from "react";

/** Below this width the map screens switch from floating panels to the bottom sheet. */
export const MOBILE_BREAKPOINT = 768;
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Live `matchMedia` result. The initial value is read synchronously so components that configure
 * themselves once on mount (the map, its controls) see the right answer on the first render.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const get = React.useCallback(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false), [query]);
  return React.useSyncExternalStore(subscribe, get, () => false);
}

/** Phone-width viewport (< 768 px). */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
