import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { activeTab } from "@/components/layout/TopBar";
import { UPI_ID } from "@/lib/helmet/campaign";
import { MODULES } from "@/lib/system/modules";
import { routeMeta } from "@/lib/system/seo";
import HelmetPage from "@/pages/HelmetPage";
import LandingPage from "@/pages/LandingPage";
import SupportPage from "@/pages/SupportPage";

import appSource from "../App.tsx?raw";
import qrSource from "../components/helmet/UpiQr.tsx?raw";
import pageSource from "../pages/HelmetPage.tsx?raw";

const render = (el: React.ReactElement, route = "/helmet"): string => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{el}</MemoryRouter></QueryClientProvider>);

/** Code and copy a file can run or render — doc comments may name the things they rule out. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SRC = path.resolve(__dirname, "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("the helmet campaign page (user request 2026-09-12: 'add a /helmet … give details about a campaign … include the payment link')", () => {
  it("is routed at /helmet in its own chunk, indexed with a title of its own, with a breadcrumb to the console and no tab lit", () => {
    expect(appSource).toContain('<Route path="/helmet" element={<HelmetPage />} />');
    expect(appSource).toMatch(/const HelmetPage = lazy\(/);
    const m = routeMeta("/helmet?x=1", "Helmet campaign");
    expect(m.index).toBe(true);
    expect(m.canonicalPath).toBe("/helmet");
    expect(m.title).toMatch(/ISI helmets .* Bengaluru/);
    expect(m.description).toMatch(/Give by UPI/);
    expect(activeTab("/helmet")).toBeNull();
    const html = render(<HelmetPage />);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/console"');
    expect(html).toContain("<b>campaign</b>");
    expect(html).toMatch(/<h1[^>]*>A certified helmet for every pillion\.<\/h1>/);
  });

  it("says what the campaign does — ISI helmets, bike-taxi drivers, the pillion — with dated figures and their sources, and that everything given goes to it", () => {
    const html = render(<HelmetPage />);
    expect(html).toMatch(/ISI-certified helmets/);
    expect(html).toMatch(/Uber Moto, Rapido/);
    expect(html).toContain("Why the pillion");
    expect(html).toContain("How it works");
    for (const v of ["54,568", "15,408", "909", "25–30 %"]) expect(html).toContain(v);
    expect(html).toContain("morth.gov.in"); // the figures link to their documents
    expect(html).toContain("bis.gov.in");
    expect(html).toContain("Everything you give goes to the campaign");
    expect(html).toContain("Nothing is kept back.");
    expect(html).not.toMatch(/don&#x27;t worry|Don&#x27;t worry|\btax\b|80G|deductible|receipt/i); // no claim the page cannot stand behind
    for (const tag of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) expect(tag).toContain('rel="noopener noreferrer"');
  });

  it("gives by UPI three ways — a QR code drawn in the page, the id with Copy, and on touch screens a upi://pay link — with a few plain amounts and 'Any amount' chosen by default", () => {
    const html = render(<HelmetPage />);
    expect(html).toContain(`<code class="mono select-all text-[15px] text-gw-text">${UPI_ID}</code>`);
    expect(html).toContain('aria-label="Copy the UPI id"');
    // the QR code is an SVG path in the page, black on white, labelled for screen readers; nothing is fetched from a QR service
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="UPI QR code for 7338425455@fam"/);
    expect(html).toMatch(/<path d="M2 2h1v1h-1z/);
    expect(html).toContain('fill="#000000"');
    expect(html).toContain("bg-[#FFFFFF]");
    expect(code(qrSource)).not.toMatch(/innerHTML|dangerouslySetInnerHTML|fetch\(|https?:\/\//);
    expect(code(pageSource)).not.toMatch(/api\.qrserver|chart\.googleapis|quickchart|<img/);
    // the deep link opens the payer's own app; it carries the id and no amount until one is picked
    expect(html).toMatch(/<a href="upi:\/\/pay\?pa=7338425455@fam&amp;pn=theTraffic&amp;cu=INR&amp;tn=Helmet%20campaign"[^>]*class="[^"]*fine:hidden/);
    // amounts as chips, "Any amount" pressed by default
    for (const a of ["₹200", "₹500", "₹1,000", "₹2,000"]) expect(html).toContain(`>${a}</button>`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Any amount</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>₹200</);
    expect(html).toContain("Copy the link"); // without a share sheet (the server render has none) the button copies the link instead
  });

  it("on an iPhone — where iOS has no chooser for upi:// and opened WhatsApp (user report 2026-09-17) — names the app to pay with: PhonePe, Google Pay, Paytm, CRED, BHIM, or another, in place of the one generic button", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 });
    try {
      const html = render(<HelmetPage />);
      expect(html).toMatch(/<span id="[^"]+" class="label">Pay with<\/span>/);
      expect(html).toContain('href="phonepe://pay?pa=7338425455@fam&amp;pn=theTraffic&amp;cu=INR&amp;tn=Helmet%20campaign"');
      expect(html).toContain('href="gpay://upi/pay?pa=7338425455@fam&amp;');
      expect(html).toContain('href="paytmmp://pay?pa=7338425455@fam&amp;');
      expect(html).toContain('href="credpay://upi/pay?pa=7338425455@fam&amp;');
      expect(html).toContain('href="bhim://pay?pa=7338425455@fam&amp;');
      for (const name of ["PhonePe", "Google Pay", "Paytm", "CRED", "BHIM", "Another UPI app"]) expect(html).toContain(`>${name}</a>`);
      expect(html).toMatch(/<a href="upi:\/\/pay\?[^"]*" class="btn-secondary[^"]*">Another UPI app<\/a>/); // the generic link stays, last, named for what it is
      expect(html.match(/<a href="[a-z]+:\/\/(?:upi\/)?pay\?/g)).toHaveLength(6); // five apps and the other
      expect(html).not.toContain("Pay with a UPI app"); // the one button iOS could not route is gone there
      expect(html).not.toMatch(/<a href="[a-z]+:\/\/[^"]*"[^>]*fine:hidden/); // an iPad with a trackpad still has its apps
      expect(html).toContain("scan the code, tap your app, or paste the id");
      expect(html).toMatch(/<svg[^>]*aria-label="UPI QR code for 7338425455@fam"/); // the code is untouched: every app scans upi://pay
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("on an Android phone keeps the one 'Pay with a UPI app' button — the system's own chooser lists the installed apps, so the page names none", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", maxTouchPoints: 5 });
    try {
      const html = render(<HelmetPage />);
      expect(html).toMatch(/<a href="upi:\/\/pay\?pa=7338425455@fam&amp;pn=theTraffic&amp;cu=INR&amp;tn=Helmet%20campaign" class="btn-primary[^"]*">Pay with a UPI app/);
      expect(html).not.toMatch(/phonepe:|gpay:|paytmmp:|credpay:|bhim:/);
      expect(html).not.toContain("Another UPI app");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is reachable from the lander's campaign band and footer, and from a Support card; the console's six tools are untouched", () => {
    const lander = render(<LandingPage />, "/");
    expect(lander).toMatch(/<b>05<\/b> · campaign/);
    expect(lander).toContain('href="/helmet"');
    expect(lander).toContain("A certified helmet for every pillion");
    expect(lander).toContain("Helmet campaign");
    expect(render(<SupportPage />, "/support")).toContain('href="/helmet"');
    expect(MODULES.map((m) => m.to)).not.toContain("/helmet"); // a campaign, not a console tool: the six numbered cards and their digits stand
  });

  it("prints the UPI id from one module only, and it is the one mobile-number-shaped string in the app's source", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      if (/\b[6-9]\d{9}\b/.test(text)) hits.push(path.relative(SRC, file));
    }
    expect(hits).toEqual(["lib/helmet/campaign.ts"]);
    expect(pageSource).not.toContain(UPI_ID.split("@")[0]); // the page imports it, never repeats it
  });
});
