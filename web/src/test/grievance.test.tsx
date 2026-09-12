import { readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { activeTab, SUPPORT_TAB } from "@/components/layout/TopBar";
import GrievancePage from "@/pages/GrievancePage";
import GrievancesPage from "@/pages/GrievancesPage";
import SupportPage from "@/pages/SupportPage";

import appSource from "../App.tsx?raw";
import cardSource from "../components/grievance/GrievanceCard.tsx?raw";
import pickerSource from "../components/grievance/PlacePicker.tsx?raw";
import apiSource from "../lib/grievance/api.ts?raw";
import photoSource from "../lib/grievance/photo.ts?raw";
import boardSource from "../pages/GrievancesPage.tsx?raw";
import pageSource from "../pages/GrievancePage.tsx?raw";

const render = (el: React.ReactElement, route = "/grievance"): string => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{el}</MemoryRouter></QueryClientProvider>);

/** Code and copy the screen can render — doc comments may name the things they rule out. */
const rendered = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the Grievance form (an account-free public board of what people face on the road)", () => {
  it("is routed at /grievance as the board's one subpage: breadcrumb to the board, the 06 eyebrow, Support's tab lit", () => {
    expect(appSource).toContain('<Route path="/grievance" element={<GrievancePage />} />');
    expect(appSource).toMatch(/const GrievancePage = lazy\(/); // its own chunk, like every other screen
    const html = render(<GrievancePage />);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/grievances"');
    expect(html).toContain("<b>06</b>");
    expect(html).toMatch(/<h1[^>]*>File a grievance<\/h1>/);
    expect(activeTab("/grievance")).toBe(SUPPORT_TAB);
    expect(activeTab("/grievances?kind=pothole")).toBe(SUPPORT_TAB);
  });

  it("offers a photo two ways — take one (touch screens) or choose one — through the operating system's picker, never a live camera", () => {
    const html = render(<GrievancePage />);
    expect(html).toContain('accept="image/*" capture="environment"'); // the camera path is the OS picker with the rear camera preferred
    expect(html.match(/<input[^>]*type="file"/g)).toHaveLength(2);
    expect(html).toContain("Take a photo");
    expect(html).toContain("Choose a photo");
    expect(html).toMatch(/fine:hidden[^"]*"[^>]*>[^<]*<svg[^]*?Take a photo/); // no camera button on a desk
    for (const src of [pageSource, pickerSource, photoSource, apiSource, boardSource, cardSource].map(rendered)) expect(src).not.toMatch(/getUserMedia|mediaDevices|<video/);
  });

  it("shrinks the photo in the browser to 1280 px and re-encodes it under the board's cap, so the camera's own position tags never travel", () => {
    expect(photoSource).toContain('canvas.toBlob(resolve, "image/jpeg", quality)');
    expect(photoSource).toContain('imageOrientation: "from-image"'); // orientation applied, then baked into the pixels
    expect(photoSource).toContain("qualityLadder()"); // quality steps down until the file fits
    expect(photoSource).not.toMatch(/exif-js|piexif|readExif/);
    expect(render(<GrievancePage />)).not.toContain("metadata dropped"); // the note appears only beside an attached photo
    expect(pageSource).toContain("metadata dropped");
  });

  it("marks the place on a map — tap, a junction dot, a name, or the device position asked for only at the press — with an honest empty state", () => {
    const html = render(<GrievancePage />);
    expect(html).toContain('aria-label="Map of Bengaluru — tap to mark the place"');
    expect(html).toContain('aria-label="Find a junction"');
    expect(html).toContain("Use my location");
    expect(html).toContain("Tap the map to mark the place, or a dot to name a junction.");
    expect(pickerSource).toContain("locateOnce()"); // one request, at the press (lib/map/locate)…
    expect(pickerSource).not.toMatch(/watchPosition|getCurrentPosition/); // …never a watch, never a second copy of the browser call
    expect(pickerSource).toContain("cooperativeGestures"); // the small map never traps the page scroll
    expect(pickerSource).toContain("locate"); // and the map's own locate control marks the place too
    expect(pickerSource).toMatch(/signalAt\(map, `\$\{JUNCTIONS\}-dot`, e\.point, hitTolerance\(pointerTypeOf\(e\.originalEvent\), coarseNow\)\)/); // a dot is hit within a pointer-sized tolerance, like the Signal Map
    expect(pickerSource).toMatch(/const JUNCTIONS = "gw-junctions"/); // `gw-` ids: the basemap re-tint leaves them alone
  });

  it("requests no identity or account, warns about visible identifiers, refuses contact details in words, and has one primary post action", () => {
    const html = render(<GrievancePage />);
    expect(html).not.toMatch(/Contact|Your name|E-mail|Sign in|autoComplete="email"|type="email"|type="tel"/);
    expect(html.match(/<input\b/g)).toHaveLength(4); // two file pickers, the junction search, the honeypot; nothing else to fill in
    expect(html).toContain("Post to the board");
    expect(html).toContain("without an account");
    expect(html).toContain("visible pixels are not blurred");
    expect(html).not.toContain("Save photo");
    expect(html).not.toContain("mailto:"); // nothing leaves through the visitor's mail app any more
    expect(html).not.toContain('role="alert"'); // a validation sentence only after a press
    expect(pageSource).not.toMatch(/SUPPORT_EMAIL|buildGrievanceMailto|shareGrievance|copyGrievance|savePhoto/);
    expect(pageSource).not.toMatch(/We will|will be fixed|forwarded to|Bengaluru Traffic Police will|BBMP will/); // no promise of a fix, no authority named
    for (const label of ["Pothole or broken road", "Footpath missing or blocked", "Water logging or a leaking pipe", "No safe way to cross", "Traffic signal problem", "Street light out", "Parking or encroachment", "Something else on the road"]) expect(html).toContain(label);
  });

  it("talks to the board through lib/grievance/api alone: multipart post, no cookie, no browser storage", () => {
    for (const src of [pageSource, pickerSource, photoSource, boardSource, cardSource].map(rendered)) expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(apiSource).toContain('form.set("grievance", JSON.stringify(submission))');
    expect(apiSource).toContain('form.set("photo", photo.blob, "photo.jpg")');
    expect(apiSource).toContain('credentials: "omit"');
    expect(pageSource).toContain("postGrievance(toSubmission(draft, place), photo)");
    expect(pageSource).toContain("post.isPending || shrinking || framed");
    expect(boardSource).toContain("unlocked && !framed");
  });

  it("is reachable from Support and from every junction page, which arrives with the junction already marked", () => {
    const support = render(<SupportPage />, "/support");
    expect(support).toContain('href="/grievance"');
    expect(support).toContain('href="/grievances"');
    expect(support).toContain("File one");
    expect(support).toContain("The board");
    const junction = readFileSync(path.resolve(__dirname, "../pages/IntersectionPage.tsx"), "utf8");
    expect(junction).toContain("to={`/grievance?junction=${encodeURIComponent(inter.id)}`}");
    expect(pageSource).toContain('params.get("junction")');
  });

  it("allows geolocation for this origin alone in the header set — the camera, microphone and the rest stay off", () => {
    const headers = readFileSync(path.resolve(__dirname, "../../public/_headers"), "utf8");
    expect(headers).toContain("Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()");
  });
});

describe("the board (/grievances)", () => {
  it("is console tool 06, newest first, with a kind filter, a File action, and an honest loading state", () => {
    expect(appSource).toContain('<Route path="/grievances" element={<GrievancesPage />} />');
    expect(appSource).toMatch(/const GrievancesPage = lazy\(/);
    const html = render(<GrievancesPage />, "/grievances");
    expect(html).toMatch(/<h1[^>]*>What people face on the road<\/h1>/);
    expect(html).toContain("<b>06</b>");
    expect(html).toContain('href="/console"'); // breadcrumb
    expect(html).toContain('href="/grievance"'); // File a grievance
    expect(html).toContain('aria-label="Filter by kind"');
    for (const short of ["All", "Pothole", "Footpath", "Water", "Crossing", "Signal", "Light", "Parking", "Other"]) expect(html).toContain(short);
    expect(html).toContain("loading the board"); // static render: the query has not resolved
    expect(html).toContain("without an account");
    expect(activeTab("/grievances")).toBe(SUPPORT_TAB);
    expect(boardSource).toContain("useInfiniteQuery"); // paged newest-first by the board's cursor
    expect(boardSource).toContain("fetchBoard({ before: pageParam, kind, limit: PAGE })");
  });

  it("holds the moderator passphrase in memory for the visit only and never writes it anywhere", () => {
    const html = render(<GrievancesPage />, "/grievances");
    expect(html).toContain("Moderator"); // the quiet foot-of-page line…
    expect(html).not.toContain('type="password"'); // …asks only when pressed
    expect(boardSource).toContain('type="password"');
    expect(boardSource).toContain('autoComplete="off"');
    expect(rendered(boardSource)).not.toMatch(/localStorage|sessionStorage|document\.cookie|URLSearchParams\([^)]*pass/);
    expect(boardSource).toContain("setUnlocked(null)"); // Lock, and a 401 on removal, forget it
  });

  it("renders a grievance card with the photo from the board, the kind, the IST time, the place and a junction link — and nothing about who filed it", () => {
    expect(cardSource).toContain("photoUrl(g.id)");
    expect(cardSource).toContain('loading="lazy"');
    expect(cardSource).toContain("fmtBoardTime(g.filedAt)");
    expect(cardSource).toContain("to={`/intersection/${g.place.junction.id}`}");
    expect(cardSource).not.toMatch(/author|posted by|contact|user/i);
    for (const tag of cardSource.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) expect(tag).toContain('rel="noopener noreferrer"');
  });
});
