import { useEffect, useState } from "react";

/**
 * State-changing grievance actions are disabled while the site is framed. Response-level
 * `frame-ancestors` protection is preferred, but some preview hosts do not apply repository headers.
 */
export function isFramed(): boolean {
  try {
    return window.top != null && window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Server rendering starts unframed. The browser applies the restriction immediately after mount,
 * before a person can trigger a network action.
 */
export function useIsFramed(): boolean {
  const [framed, setFramed] = useState(false);

  useEffect(() => {
    setFramed(isFramed());
  }, []);

  return framed;
}
