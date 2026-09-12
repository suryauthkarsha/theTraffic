/**
 * The support mailbox comes from `VITE_SUPPORT_EMAIL` and from nowhere else. No address is written
 * into the source (security audit, 2026-09-09): a fork, a preview or a build without the variable
 * simply has no e-mail channel and the Support page offers the clipboard alone. Once set, the address
 * is public by design — it is printed on /support — which is why `vite.config.ts` exempts that one
 * value from its env-hygiene gate. Imported by the app and by the build config, so: no imports here.
 */
const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A usable mailbox from a raw environment value, or null when it is unset or malformed. */
export function parseMailbox(raw: string | undefined): string | null {
  const v = raw?.trim() ?? "";
  return v.length <= 254 && MAILBOX.test(v) ? v : null;
}
