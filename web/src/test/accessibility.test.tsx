/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { activeTab, PRIMARY_TABS, TopBar } from "@/components/layout/TopBar";
import { Dot } from "@/components/ui/pills";
import { COVERAGE_META, COVERAGE_ORDER } from "@/lib/timing";

import appSource from "../App.tsx?raw";
import shellSource from "../components/layout/AppShell.tsx?raw";
import errorSource from "../components/layout/ErrorBoundary.tsx?raw";
import claimCardSource from "../components/timing/TimingClaimCard.tsx?raw";
import consoleSource from "../pages/ConsolePage.tsx?raw";
import intersectionSource from "../pages/IntersectionPage.tsx?raw";
import landingSource from "../pages/LandingPage.tsx?raw";
import methodologySource from "../pages/MethodologyPage.tsx?raw";
import researchSource from "../pages/ResearchPage.tsx?raw";
import signalsSource from "../pages/SignalMapPage.tsx?raw";
import supportSource from "../pages/SupportPage.tsx?raw";

// vitest stubs CSS modules (even `?raw`), so the stylesheet is read from disk.
const css = readFileSync(path.resolve(__dirname, "../index.css"), "utf8");

const render = (el: React.ReactElement, route = "/"): string => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{el}</MemoryRouter></QueryClientProvider>);

describe("navigation", () => {
  it("every page shares one navigation model: skip link, primary tabs, support — no planner, no sign-in, nothing to contribute", () => {
    const html = render(<TopBar />, "/signals");
    expect(html).toContain("Skip to content");
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Support");
    expect(html).not.toMatch(/Contribute|Reviewer|sign-in|Sign in/);
    expect(html).toContain('aria-controls="mobile-nav"');
    expect(html).toContain("h-11 w-11"); // mobile menu button ≥ 44 px
    expect(activeTab("/intersection/gw-1")?.label).toBe("Signal Map");
    expect(activeTab("/admin")).toBeNull();
    expect(activeTab("/contribute")).toBeNull();
    expect(activeTab("/support")?.label).toBe("Support");
    expect(activeTab("/plan?from=x")).toBeNull(); // the planner was removed (user decision 2026-09-08)
    expect(activeTab("/console")?.label).toBe("Console");
    expect(activeTab("/")).toBeNull(); // the public lander has its own header, no tab
    expect(activeTab("/nowhere")).toBeNull();
    expect(PRIMARY_TABS.map((t) => t.label)).toEqual(["Signal Map", "Surveillance", "Research", "Methodology"]);
    expect(activeTab("/surveillance?camera=6568418174")?.label).toBe("Surveillance"); // a shared camera link lights the same tab
    expect(html).not.toContain('href="/plan"');
    expect(html).not.toMatch(/>Plan</);
    expect(html).toContain('href="/signals"');
    expect(html).toContain('href="/console"'); // the wordmark leads to the console
    expect(html).not.toContain("shadow-["); // flat chrome: no glow anywhere in the bar
    expect(html).not.toContain("signal ops"); // no decorative tags in the bar (declutter, 2026-09-08)
    expect(html).not.toMatch(/gw-(green|amber)/); // black & orange palette: the old tokens are gone
  });

  it("every key is a flat dot — chrome and map legends alike — and no glow is left anywhere (user decision 2026-09-08: 'just add orange dots')", () => {
    const dot = render(<Dot color="#FF8A2B" />);
    expect(dot).toContain("background:#FF8A2B"); // the key is the flat colour itself…
    expect(dot).not.toContain("box-shadow"); // …never a glow…
    expect(dot).not.toContain("radial-gradient"); // …and never a bloom gradient
    // the map legend keys its markers with the same flat Dot and says once that colours are never the live light
    expect(signalsSource).toContain("<Dot color={l.color}");
    expect(signalsSource).toMatch(/never the live light/);
    for (const src of [signalsSource, intersectionSource]) {
      expect(src).not.toMatch(/gw-(green|amber)|COLORS\.(green|amber|grey|alt)/);
      expect(src).not.toMatch(/GlowDot|GlowSwatch|coreColor|haloOpacity|lib\/map\/glow|point of light/); // the glow left with its module
      expect(src).not.toMatch(/heatmap|Heatmap|HEAT_|heatSpec|heat-signals|heat-legend|RenderMode|RENDER_MODES|Flame/); // …and so did the blurred heat surface that sat under the dots (user decision 2026-09-08: 'kindly remove the glow')
    }
    expect(signalsSource).not.toContain("Render mode"); // the Markers · Heat · Both control is gone: dots are the only rendering
  });

  it("no marker colour on the map is grey — the coverage ramp is orange from pale to dark, and every tier a visitor meets reads as a flat dot on black", () => {
    const colours = COVERAGE_ORDER.map((c) => COVERAGE_META[c].color);
    for (const c of colours) {
      const n = parseInt(c.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      expect(r).toBeGreaterThan(g); // warm: red above green…
      expect(g).toBeGreaterThan(b); // …above blue — an orange hue, never a neutral grey
      expect(r - b).toBeGreaterThan(40); // and saturated enough to read as orange, not brown-grey
    }
    // without a glow to lift it, the most common state (location only) must itself be visible: red channel ≥ 0x88
    for (const c of COVERAGE_ORDER.filter((c) => c !== "unknown")) expect(parseInt(COVERAGE_META[c].color.slice(1, 3), 16)).toBeGreaterThanOrEqual(0x88);
    // …and the ramp stays ordered: each tier with less on file is darker than the one above (live is the accent, verified the pale peak)
    const lightness = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
      return (Math.max(...ch) + Math.min(...ch)) / 2;
    };
    const tail = COVERAGE_ORDER.filter((c) => c !== "live_timing").map((c) => lightness(COVERAGE_META[c].color));
    for (let i = 1; i < tail.length; i++) expect(tail[i]).toBeLessThan(tail[i - 1]);
  });

  it("secondary pages carry the same breadcrumb — arrow, parent, current; no 'Back to' filler", () => {
    const html = render(<Breadcrumb parent={{ to: "/signals", label: "Signal Map" }} current="Silk Board Junction" />);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/signals"');
    expect(html).toContain("Signal Map");
    expect(html).not.toContain("Back to");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("min-h-[44px]");
  });
});

describe("the site shows data and never collects it", () => {
  it("has no admin, contribute, auth or planner routes and no Supabase client anywhere in the app", () => {
    expect(appSource).not.toMatch(/\/admin|\/contribute|supabase|Supabase/);
    expect(appSource).not.toContain("installUploadRetry");
    expect(appSource).not.toMatch(/PlanPage|"\/plan"/); // the departure planner was removed (user decision 2026-09-08)
    for (const src of [signalsSource, intersectionSource, landingSource]) expect(src).not.toMatch(/useEncounterModel|researchStore|Drive this|\/contribute|\/plan\b|Plan from here|planner/);
  });

  it("the lander and the junction page describe a signal atlas, not a trip planner", () => {
    expect(landingSource).toContain("Know the signals,");
    expect(landingSource).not.toMatch(/routing provider|when to leave|Pick two places/);
    expect(landingSource).toMatch(/never what a light is doing/); // R1, said once
    expect(intersectionSource).toContain("Timing on file");
    expect(claimCardSource).toMatch(/used in predictions/); // each claim says whether it feeds a prediction; no extra footnote repeats it
  });

  it("every screen is minimal and to the point: no taglines, no repeated explanations, no filler (user decision 2026-09-08)", () => {
    // lander: index headings, a one-sentence hero, one-line rules, no 'Research notebook' / 'How it works' buttons, no long knot caption
    expect(landingSource).not.toMatch(/Three tools, one dataset|No magic|Four things we promise|Where the data comes from|Research notebook|Read the full methodology|closed curve/);
    expect(landingSource).toMatch(/<h2 id="tools-title" className=\{h2\}>/); // section headings ARE the eyebrows
    expect(landingSource).toMatch(/const RULES: \{ index: string; body: string \}\[\]/); // rules are one line each, no title + paragraph
    expect(landingSource).not.toMatch(/never pretend|We never invent a number/); // each honesty rule is said once, in R1–R4
    // console: the page index is the heading; cards carry a title and one sentence
    expect(consoleSource).not.toMatch(/Where to\?|press its number|moduleLiveStat|kicker|useSystemStatus/);
    expect(consoleSource).toMatch(/<h1 className="eyebrow rise-in">/);
    // signal map: no note under the layer select, counts are one line, no 'Level' jargon on the hover card
    expect(signalsSource).not.toMatch(/note\?: string|current\.note|Level \{cardPrediction\.level\}|junctions · \{fmtInt\(counts\?\.source_signal_nodes\)\} signals/);
    // junction page: no footnotes under the claims or the phase table, no Level, no 'Back to'
    expect(intersectionSource).not.toMatch(/Only accepted review links|Letters and movements are the plan's own|as printed in the plan|Level \{level\}|Back to Signal Map|not the same as untimed/);
    // claim card: six provenance rows — the pills carry status, nothing is printed twice
    expect(claimCardSource).not.toMatch(/Current \/ stale|PDF metadata|portal upload|<dt className="text-gw-secondary">Published<\/dt>|<dt className="text-gw-secondary">Retrieved<\/dt>/);
    expect(claimCardSource).toMatch(/<dt className="text-gw-secondary">Dates<\/dt>/);
    // research: figures only — no intro paragraph, no per-tile numbering or descriptions, no table footnotes, no closing attribution line
    expect(researchSource).not.toMatch(/Nothing is measured from visitors|padStart\(2, "0"\)|m\.description|Mappls|partnership opportunity|Signal control classification|<table|not over visitors|s\.note|public_claim/);
    // methodology: no research-question preamble, no speeding sentence (R4 says it once)
    expect(methodologySource).not.toMatch(/research question|never recommends speed|what the code does today|never enters the dataset/);
    // support: five short FAQs, no intro, no 'Your data' section (FAQ 4 covers it), no topic hints, no default validation sentence
    expect(supportSource).not.toMatch(/small team|Your data|topicMeta|A person reads every report|Dark or satellite|Help &amp; support/);
    expect(supportSource.match(/\{ q: "/g)).toHaveLength(5);
    // shell + chrome: one-line attribution footer, no stale 'recorded' copy on the error panel
    expect(shellSource).not.toContain("Times in IST");
    expect(errorSource).not.toMatch(/nothing you recorded|rest of the app is fine/);
  });

  it("the lander's knot is a very dark ghost beside the title on the black canvas — no figure panel, no second column, no caption (user decision 2026-09-09)", () => {
    const hero = landingSource.slice(landingSource.indexOf('aria-labelledby="hero-title"'), landingSource.indexOf('id="tools"'));
    expect(hero).not.toMatch(/<figure|figcaption|panel|lg:grid-cols|Signal corridors|\slabel=/); // no framed figure, no caption, no column of its own, decorative (aria-hidden)
    expect(hero).toMatch(/<h1 id="hero-title"[^>]*>[\s\S]*<\/h1>\s*\{\/\*[\s\S]*?\*\/\}\s*<KnotAnimation[^>]*className="knot-ghost absolute/); // the knot is the title's sibling, positioned off the title box
    expect(hero).toMatch(/lg:left-full/); // beside the text from `lg`…
    expect(hero).toMatch(/className="knot-ghost absolute right-0/); // …behind the title's right edge below it
    expect(hero).not.toMatch(/<KnotAnimation[^>]*\scolor/); // monochrome: the ghost is one very dark grey, no palette
    expect(css).toMatch(/\.knot-ghost\s*{[^}]*color: #9a928a;[^}]*opacity: 0\.35;[^}]*user-select: none;/);
  });
});

describe("responsive layout and mobile touch targets", () => {
  it("coarse pointers get 44 px minimum targets for every control class and 16 px fields (no iOS focus zoom)", () => {
    const block = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(block).toContain("min-height: 44px");
    for (const sel of [".segment > button", ".chip", ".btn-secondary", ".btn-primary", ".input-field", "select", '[role="option"] > a']) expect(block).toContain(sel);
    expect(block).toContain("font-size: max(16px, 1em)");
  });

  it("primary buttons and inputs are 44 px tall by default", () => {
    expect(css).toMatch(/\.btn-primary\s*{\s*@apply[^}]*h-11/);
    expect(css).toMatch(/\.input-field\s*{\s*@apply[^}]*h-11/);
  });

  it("the map screen uses the bottom sheet on phones and a capped floating panel on wider screens", () => {
    expect(signalsSource).toContain("<BottomSheet");
    expect(signalsSource).toContain("useIsMobile()");
    expect(signalsSource).toContain("mobileControls={isMobile}"); // zoom buttons go, attribution and basemap toggle move to the top
    expect(signalsSource).toContain("max-w-[calc(100vw-2rem)]");
    expect(signalsSource).not.toContain("top-[calc(3.5rem"); // the map region already starts under the bar: never offset by it twice
    expect(signalsSource).toContain("max-h-[calc(100dvh-7.5rem)]"); // desktop control panel scrolls instead of overflowing
  });

  it("a click or tap near a signal dot opens its junction page — no select-then-confirm step, no pixel-perfect aim (user decision 2026-09-08)", () => {
    expect(signalsSource).toMatch(/signalAt\(map, DOT_LAYER, e\.point, hitTolerance\(pointerTypeOf\(e\.originalEvent\), coarsePointer\)\)/); // nearest dot within a pointer-sized tolerance
    expect(signalsSource).toMatch(/if \(i\) navigate\(`\/intersection\/\$\{i\.id\}`\)/); // …and the click goes straight to the page
    expect(signalsSource).not.toMatch(/map\.on\("click", "signals-dot"/); // never the layer-only handler that needs the exact painted pixel
    expect(signalsSource).not.toMatch(/Open junction page|Open details|Click or tap to select|setSelected|openDetailsRef|role=\{selected/); // the intermediate selection card is gone
    expect(signalsSource).toContain("recallSignalMapView"); // Back from a junction lands where the visitor left the map…
    expect(signalsSource).toContain("rememberSignalMapView");
    expect(signalsSource).toContain('to={`/intersection/${i.id}`} {...rowProps(i)}'); // …and every list row is itself the link
    expect(signalsSource).not.toMatch(/Type at least|keep typing to narrow|Try part of a road name/); // search copy trimmed
  });

  it("the junction page is phone-first: one column, provenance folded away, the small map never traps the page scroll", () => {
    expect(intersectionSource).toContain("cooperativeGestures");
    expect(intersectionSource).toContain("key={inter.id}"); // a fresh map per junction, so corridors never leak between pages
    expect(intersectionSource).toContain("<details");
    expect(intersectionSource).toContain("Show on map");
    expect(intersectionSource).toContain("Report a problem");
    expect(intersectionSource).toMatch(/h-\[220px\][^"]*sm:h-\[300px\]/); // shorter map on phones
    expect(intersectionSource).not.toMatch(/white dots|Predictability|osm node\{|Offsets are never/); // stale caption, empty score and stacked disclaimers are gone
    expect(intersectionSource).not.toMatch(/`\$\{k\} \$\{v >= 0[^`]*`\)[\s\S]*<\/section>[\s\S]*<details/); // the score components live inside the provenance disclosure, not above it
  });

  it("the chrome reserves the device safe areas (notch, home indicator) — also inside the preview frame, where env() is 0", () => {
    expect(css).toContain("--gw-safe-top: max(env(safe-area-inset-top, 0px), var(--gw-preview-top))");
    expect(css).toContain("--gw-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--gw-preview-bottom))");
    expect(css).toContain("--gw-top: calc(3.5rem + var(--gw-safe-top))");
    expect(css).toContain("--gw-rail: calc(1.75rem + var(--gw-safe-bottom))");
    expect(css).toMatch(/\.rail\s*{[^}]*height: var\(--gw-rail\)/);
    expect(render(<TopBar />)).toContain("h-[var(--gw-top)]");
    expect(render(<TopBar />)).toContain("focus:top-[calc(var(--gw-safe-top)+0.5rem)]"); // the skip link lands under the status bar too
    expect(readFileSync(path.resolve(__dirname, "../main.tsx"), "utf8")).toMatch(/installPreviewInsets\(\);[\s\S]*createRoot/); // published before the first paint
  });
});
