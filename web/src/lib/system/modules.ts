/**
 * The console's tools — one list shared by the landing page, the console entry and the keyboard
 * shortcuts, so a tool is described the same way everywhere: a title and one short sentence. Pure; tested.
 */
export type ModuleId = "signals" | "research" | "methodology" | "support" | "surveillance" | "grievances";

export interface ConsoleModule {
  id: ModuleId;
  /** Two-digit index printed in the eyebrow ("01"). */
  index: string;
  to: string;
  title: string;
  /** One short sentence — the only copy a card carries. */
  description: string;
  /** Digit that opens the module from the console entry. */
  key: string;
}

export const MODULES: readonly ConsoleModule[] = [
  { id: "signals", index: "01", to: "/signals", title: "Signal Map", key: "1", description: "Mapped signal junctions, coloured by what we know. Tap one to open it." },
  { id: "surveillance", index: "02", to: "/surveillance", title: "Surveillance", key: "2", description: "OSM surveillance records in the shipped snapshot and their mapped fields." },
  { id: "research", index: "03", to: "/research", title: "Research", key: "3", description: "How much timing data the city has and where it comes from." },
  { id: "methodology", index: "04", to: "/methodology", title: "Methodology", key: "4", description: "How every estimate is made." },
  { id: "support", index: "05", to: "/support", title: "Support", key: "5", description: "FAQ, status and a way to report a problem." },
  { id: "grievances", index: "06", to: "/grievances", title: "Grievances", key: "6", description: "Road problems posted without an account, with photos and places." },
];

/** Module opened by a bare digit key on the console entry, or null. */
export function moduleForKey(key: string): ConsoleModule | null {
  return MODULES.find((m) => m.key === key) ?? null;
}
