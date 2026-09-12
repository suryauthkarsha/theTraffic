import { BRAND_CITY, BRAND_WORD } from "@/lib/system/brand";

/**
 * The wordmark: "theTraffic" with its full stop painted red (user decision 2026-09-09). The stop IS the
 * mark — the one red on the site that does not mean trouble, so it has its own token (`gw-mark`) and
 * there is no leading dot any more. Renders inline inside a header link; the muted city tag follows
 * from `sm` up, exactly as before the rename.
 */
export function Wordmark() {
  return (
    <>
      <span className="text-[17px] font-semibold tracking-[-0.01em] text-gw-text">
        {BRAND_WORD}<span className="font-bold text-gw-mark">.</span>
      </span>
      <span className="hidden text-[15px] text-gw-secondary sm:inline">{BRAND_CITY}</span>
    </>
  );
}
