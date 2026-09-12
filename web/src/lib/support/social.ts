/**
 * Where to find the maker (user request 2026-09-11): three public profiles, printed on the Support page
 * under the attribution line and nowhere else. Public by design, like the Rasthe / Marg Initiative links
 * beside them — no personal address or number lives here, and the security guard keeps it that way.
 */
export type SocialNetwork = "instagram" | "x" | "linkedin";

export type SocialProfile = {
  readonly id: SocialNetwork;
  /** The network's name, read out before the handle (the icon alone is decorative). */
  readonly network: string;
  /** What the link shows: the handle as the network writes it. */
  readonly handle: string;
  readonly href: string;
};

export const SOCIAL_PROFILES: readonly SocialProfile[] = [
  { id: "instagram", network: "Instagram", handle: "@suryauthkarsha", href: "https://www.instagram.com/suryauthkarsha" },
  { id: "x", network: "X", handle: "@suryauthkarsha6", href: "https://x.com/suryauthkarsha6" },
  { id: "linkedin", network: "LinkedIn", handle: "in/suryauthkarsha", href: "https://www.linkedin.com/in/suryauthkarsha" },
];
