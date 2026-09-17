import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Security regression guard (audit of 2026-09-09). Reads the repository like a reviewer would and fails
 * when something the audit removed comes back: a credential or personal address in a committed file,
 * a third party in index.html, an unprotected `target="_blank"`, a loosened ignore rule, a wholesale
 * `import.meta.env` read, or a policy directive that has quietly widened.
 */
const ROOT = path.resolve(__dirname, "../../..");
const WEB = path.join(ROOT, "web");

const TEXT = /\.(ts|tsx|js|mjs|cjs|py|md|json|jsonl|txt|html|css|yml|yaml|toml|cff|example|webmanifest|overpassql|gitignore)$/i;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "history", "__pycache__", "geocode_cache.json"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.size < 6_000_000 && (TEXT.test(name) || name === ".gitignore" || name === "_headers")) out.push(p);
  }
  return out;
}

const read = (p: string): string => readFileSync(p, "utf8");
const rel = (p: string): string => path.relative(ROOT, p);

/** All repository text, including community and automation files — never a real .env file. */
const committed = (): string[] => walk(ROOT).filter((p) => existsSync(p) && !/(^|[\\/])\.env(\.|$)(?!example)/.test(p));

/** Shapes of things that must never be committed. Each is a credential format or a personal contact. */
const SECRETS: { name: string; re: RegExp }[] = [
  { name: "JWT (Supabase service/anon key)", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Mapbox token", re: /\b[ps]k\.eyJ[A-Za-z0-9_-]{10,}/ },
  { name: "Supabase publishable / secret key", re: /\bsb_(publishable|secret)_[A-Za-z0-9_-]{10,}/ },
  { name: "Stripe-style secret", re: /\bsk_(live|test)_[A-Za-z0-9]{8,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Slack token", re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Rork toolkit key", re: /\brork_[A-Za-z0-9]{12,}\b/ },
  { name: "Supabase project URL", re: /https:\/\/[a-z]{20}\.supabase\.co\b/ },
  { name: "personal (Gmail) mailbox", re: /[A-Za-z0-9._%+-]+@gmail\.com\b/i },
  { name: "Indian mobile number", re: /\+91[\s-]?[6-9]\d{9}\b/ },
  { name: "credential assignment with a value", re: /\b(SERVICE_ROLE_KEY|API_KEY|ACCESS_TOKEN|SECRET_KEY|CLIENT_SECRET)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{16,}/ },
];

const GITIGNORE_RULES: Record<string, string[]> = {
  ".gitignore": [".env", ".env.*", "!.env.example", "*.local", ".dev.vars", ".rork/*", "!.rork/DESIGN.md", "__pycache__/", "*.pyc", ".vercel"],
  "web/.gitignore": [".env", ".env.*", "!.env.example", "*.local", ".vercel"],
  "functions/.gitignore": [".dev.vars", ".env", ".env.*", "!.env.example"],
};

describe("security guard", () => {
  it("commits no credential, personal mailbox or personal phone number anywhere in the repository", () => {
    const hits: string[] = [];
    for (const file of committed()) {
      const text = read(file);
      for (const { name, re } of SECRETS) {
        const m = re.exec(text);
        if (m) hits.push(`${rel(file)}: ${name} (${m[0].slice(0, 6)}…)`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps every env file out of git and the agent transcripts with them", () => {
    for (const [file, rules] of Object.entries(GITIGNORE_RULES)) {
      const lines = read(path.join(ROOT, file))
        .split("\n")
        .map((l) => l.trim());
      for (const rule of rules) expect(lines, `${file} must contain "${rule}"`).toContain(rule);
    }
    expect(existsSync(path.join(ROOT, "scripts/__pycache__"))).toBe(false);
    expect(existsSync(path.join(ROOT, "scripts/tests/__pycache__"))).toBe(false);
  });

  it("ships an .env.example with names only", () => {
    for (const line of read(path.join(ROOT, ".env.example")).split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) expect(m[2], `${m[1]} carries a value in .env.example`).toBe("");
    }
  });

  it("loads nothing from a third party in index.html: no remote script, stylesheet or font", () => {
    const html = read(path.join(WEB, "index.html"));
    expect(html).not.toMatch(/fonts\.g(oogleapis|static)\.com/);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:/i);
    expect(html).toMatch(/<meta name="referrer" content="strict-origin-when-cross-origin"/);
    expect(html).not.toMatch(/<script>(?!\s*<\/script>)/); // no inline script of our own
  });

  it("bundles the fonts it uses", () => {
    const main = read(path.join(WEB, "src/main.tsx"));
    expect(main).toMatch(/@fontsource\/ibm-plex-sans\/400\.css/);
    expect(main).toMatch(/@fontsource\/ibm-plex-mono\/400\.css/);
  });

  it("opens every external link with rel=\"noopener noreferrer\"", () => {
    const bad: string[] = [];
    for (const file of walk(path.join(ROOT, "web/src"))) {
      if (!/\.tsx$/.test(file)) continue;
      for (const tag of read(file).match(/<a\b[^>]*target=["']_blank["'][^>]*>/g) ?? []) if (!/rel=["']noopener noreferrer["']/.test(tag)) bad.push(`${rel(file)}: ${tag.slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });

  it("reads import.meta.env one key at a time and renders no raw HTML from data", () => {
    for (const file of walk(path.join(ROOT, "web/src"))) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file) || /vite-env\.d\.ts$/.test(file)) continue;
      const src = read(file);
      const lines = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)); // code, not comments
      for (const l of lines) {
        expect(l, `${rel(file)} reads import.meta.env wholesale`).not.toMatch(/import\.meta\.env(?![.\w])/);
        expect(l, `${rel(file)} uses dangerouslySetInnerHTML`).not.toMatch(/dangerouslySetInnerHTML/);
        expect(l, `${rel(file)} uses eval / Function`).not.toMatch(/\beval\(|new Function\(/);
      }
      // The one innerHTML write is the knot's own glyph frame (a fixed ramp and validated colours).
      if (/\.innerHTML\s*=/.test(src)) expect(rel(file)).toBe("web/src/components/ui/knot-animation.tsx");
    }
  });

  it("keeps the Content Security Policy tight: no plugins, frames or base hijack, no bare CDN origin, third parties only by name", () => {
    const cfg = read(path.join(WEB, "vite.config.ts"));
    for (const d of ["default-src 'self'", "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'"]) expect(cfg).toContain(d);
    expect(cfg).not.toMatch(/https:\/\/unpkg\.com[\s"'`$]/); // only a pinned package directory, never the whole CDN
    expect(cfg).not.toMatch(/fonts\.g(oogleapis|static)\.com/);
    expect(cfg).not.toMatch(/'unsafe-eval'/);
    expect(cfg).toContain("sourcemap: false");
    expect(cfg).toContain('envPrefix: ["VITE_"]');
    expect(cfg).toMatch(/enforce: "post"/); // the hygiene gate sees the finished index.html
  });

  it("names the two audience counters exactly: DataFast's origin in script-src and connect-src (no pixel, so not img-src), loaded as an element from that same origin; Google's hosts only with an id", () => {
    const cfg = read(path.join(WEB, "vite.config.ts"));
    const analytics = read(path.join(WEB, "src/lib/system/analytics.ts"));
    expect(cfg).toContain('const DATAFAST_ORIGIN = "https://datafa.st"');
    expect(cfg).toMatch(/`script-src 'self'[^\n]*\$\{DATAFAST_ORIGIN\}/);
    expect(cfg).toMatch(/`connect-src 'self'[^\n]*\$\{DATAFAST_ORIGIN\}/);
    expect(cfg).not.toMatch(/`img-src[^\n]*DATAFAST/);
    expect(analytics).toContain('export const DATAFAST_SRC = "https://datafa.st/js/script.js"'); // the policy names the origin the loader comes from
    expect(analytics).toMatch(/export const DATAFAST_WEBSITE_ID = "dfid_[A-Za-z0-9]+"/); // a website id, public by design — never a key
    expect(analytics).toContain('export const DATAFAST_DOMAIN = "thetraffic.in"');
    expect(analytics).toMatch(/installDataFast\([\s\S]*globalPrivacyControl === true\) return "gpc"/); // GPC refuses it, as it does Google's tag
    expect(analytics).not.toMatch(/innerHTML|textContent\s*=|text\s*=/); // an element with a src, never inline code
    expect(read(path.join(WEB, "src/main.tsx"))).toMatch(/^installDataFast\(\);$/m);
    // the Google hosts remain conditional on a configured id
    expect(cfg).toMatch(/const ga = \(kind: keyof typeof GA_HOSTS\): string => \(analytics \? /);
  });

  it("gives a Vercel deployment the _headers set plus a clickjacking rule, and rewrites only app routes", () => {
    type Header = { key: string; value: string };
    const cfg = JSON.parse(read(path.join(WEB, "vercel.json"))) as { trailingSlash?: boolean; rewrites?: { source: string; destination: string }[]; headers?: { source: string; headers: Header[] }[] };
    const site: Header[] = cfg.headers?.find((h) => h.source === "/(.*)")?.headers ?? [];
    const legacy = read(path.join(WEB, "public/_headers"));
    for (const h of site) {
      // Vercel-only: the <meta> policy cannot carry frame-ancestors, and no editor frame exists there.
      if (h.key === "X-Frame-Options") expect(h.value).toBe("DENY");
      else if (h.key === "Content-Security-Policy") expect(h.value).toBe("frame-ancestors 'none'");
      else expect(legacy, `${h.key} differs between vercel.json and _headers`).toContain(`${h.key}: ${h.value}`);
    }
    for (const k of ["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy", "X-Frame-Options", "Content-Security-Policy"]) expect(site.map((h) => h.key)).toContain(k);
    expect(site.map((h) => h.key)).not.toContain("Strict-Transport-Security"); // Vercel sets HSTS itself; a second value would only shorten it
    expect(cfg.headers?.find((h) => h.source === "/assets/(.*)")?.headers).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
    // Missing chunks and datasets must 404, not answer with the HTML page.
    expect(cfg.rewrites).toEqual([{ source: "/((?!assets/|data/).*)", destination: "/index.html" }]);
    // One address per page: `/signals/` answers 308 to `/signals`, where the pre-rendered page lives (never two copies of a page in the index).
    expect(cfg.trailingSlash).toBe(false);
  });

  it("pre-renders every screen from pure modules that touch no DOM, no environment and no app code, and adds only a JSON-LD data block", () => {
    for (const file of ["src/lib/system/routeMeta.ts", "src/lib/system/prerender.ts", "src/lib/system/brand.ts"]) {
      const src = read(path.join(WEB, file))
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(src, `${file} imports app code by alias`).not.toMatch(/from "@\//);
      expect(src, `${file} reads the environment`).not.toMatch(/import\.meta\.env|process\.env/);
      expect(src, `${file} touches the DOM`).not.toMatch(/\b(document|window|navigator)\b/);
      expect(src, `${file} reads files or the network`).not.toMatch(/node:fs|readFileSync|fetch\(/);
    }
    const prerender = read(path.join(WEB, "src/lib/system/prerender.ts"))
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // the code, not the comments
      .join("\n");
    expect(prerender.match(/<script[^>]*>/g)).toEqual(['<script type="application/ld+json">']); // the one tag it writes is a data block
    expect(prerender).toMatch(/replace\(\/<\/g, "\\\\u003c"\)/); // and no name in the data can close it
    const cfg = read(path.join(WEB, "vite.config.ts"));
    expect(cfg).toMatch(/name: "thetraffic:search-pages",\s*apply: "build",\s*enforce: "post"/); // copies of the FINISHED index.html (policy injected)
    expect(cfg).toMatch(/plugins: \[react\(\), csp\(env\), searchPages\(env\), envHygiene\(env\)\]/); // and the hygiene gate still runs after them
  });

  it("type-checks both projects for real, with the app project strict", () => {
    const pkg = JSON.parse(read(path.join(WEB, "package.json"))) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json"); // the solution tsconfig has `files: []` and checks nothing by itself
    const app = JSON.parse(read(path.join(WEB, "tsconfig.app.json"))) as { compilerOptions: Record<string, unknown> };
    const node = JSON.parse(read(path.join(WEB, "tsconfig.node.json"))) as { compilerOptions: Record<string, unknown> };
    expect(app.compilerOptions.strict).toBe(true);
    expect(app.compilerOptions.noImplicitAny).toBeUndefined(); // nothing switches part of strict back off
    expect(node.compilerOptions.strict).toBe(true);
  });

  it("keeps the repository's automation supply chain pinned and watched: every action by commit, Dependabot on every manifest, CodeQL with least privilege", () => {
    const workflows = readdirSync(path.join(ROOT, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f));
    expect(workflows.sort()).toEqual(["ci.yml", "codeql.yml"]);
    for (const f of workflows) {
      const text = read(path.join(ROOT, ".github/workflows", f));
      for (const use of text.match(/uses:\s*\S+/g) ?? []) expect(use, `${f}: ${use} is not pinned to a commit`).toMatch(/uses:\s*[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[0-9a-f]{40}$/);
      expect(text, `${f} grants more than read at the top level`).toMatch(/^permissions:\n {2}contents: read\n/m);
      expect(text).not.toMatch(/pull_request_target|secrets\.\w+/); // no fork can run with the repository's secrets; no workflow needs one
    }
    const codeql = read(path.join(ROOT, ".github/workflows/codeql.yml"));
    expect(codeql).toMatch(/security-events: write/); // the one extra grant, on the job that uploads results
    expect(codeql).toMatch(/language: javascript-typescript[\s\S]*language: python[\s\S]*language: actions/);
    const dependabot = read(path.join(ROOT, ".github/dependabot.yml"));
    const covered = [...dependabot.matchAll(/package-ecosystem: "([^"]+)"\n\s+directory: "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    expect(covered).toEqual(["bun /web", "github-actions /", "npm /functions", "pip /"]); // the web app, the Worker, the scripts, the workflows
  });

  it("gives the Worker JSON-only headers, grants CORS to named origins only (never `*`), reads exactly the two board settings, and keeps every secret out of source", () => {
    const code = (file: string): string =>
      read(path.join(ROOT, file))
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // judge the code, not the comments
        .join("\n");
    const http = code("functions/_lib/http.ts");
    for (const h of ["X-Content-Type-Options", "Referrer-Policy", "Content-Security-Policy", "X-Frame-Options", "Strict-Transport-Security"]) expect(http).toContain(h);
    expect(http).toContain('"Cache-Control": opts.cacheControl ?? "no-store"');
    expect(http).not.toMatch(/Allow-Origin["']\s*:\s*["']\*/); // never a wildcard grant
    expect(http).not.toMatch(/Access-Control-Allow-Credentials/); // there is nothing to send credentials for
    const worker = [code("functions/index.ts"), code("functions/grievance-board.ts"), code("functions/grievance-photos.ts"), http, code("functions/_lib/validate.ts"), code("functions/_lib/jpeg.ts")].join("\n");
    // the environment is read by name: two settings plus Rork and standard Cloudflare DO bindings
    const envKeys = new Set((worker.match(/\benv\.([A-Z_]+)/g) ?? []).map((m) => m.slice(4)));
    expect([...envKeys].sort()).toEqual(["DO", "GRIEVANCE_ADMIN_KEY", "GRIEVANCE_ALLOWED_ORIGINS", "GRIEVANCE_BOARD", "GRIEVANCE_PHOTOS"]);
    expect(worker).not.toMatch(/MAPBOX|TOMTOM|SUPABASE|SERVICE_ROLE/); // the retired gateway's keys are gone for good
    // anonymity: no row or field for who filed a grievance, and the caller's address is hashed, never stored as such
    expect(code("functions/grievance-board.ts")).not.toMatch(/\b(ip|email|phone|contact|user_id|name)\s+TEXT/i);
    expect(code("functions/grievance-board.ts")).not.toMatch(/console\.log\(/); // nothing about a request is logged
    expect(code("functions/index.ts")).not.toMatch(/console\.log\(/);
    expect(http).toMatch(/CF-Connecting-IP[\s\S]*sha256Hex\(ip\)/);
    expect(code("functions/grievance-board.ts")).toMatch(/salt/); // and salted per day before it is kept for the limits
    // uploads are bounded before they are read and photos must parse as JPEG with their metadata stripped
    expect(code("functions/index.ts")).toContain("readBodyCapped(request, REQUEST_MAX_BYTES)");
    expect(code("functions/index.ts")).toContain("inspectJpeg(");
    expect(code("functions/_lib/jpeg.ts")).toMatch(/isMetadata/);
    // the rate-limit verdict is asked of the board before a byte of a submission is read, so a refused caller costs no JPEG parse, photo write or cleanup
    expect(code("functions/index.ts")).toMatch(/"\/allowance"[\s\S]*readBodyCapped\(request, REQUEST_MAX_BYTES\)[\s\S]*inspectJpeg\(/);
    expect(code("functions/grievance-board.ts")).toMatch(/private async allowance\([\s\S]*postAllowance\(key, now\)/);
    // a page of the board is one indexed query plus counts kept in memory, keyed for a short public cache; a post or a removal forgets the pages it changes
    expect(code("functions/grievance-board.ts")).toContain("cacheControl: LIST_CACHE_CONTROL");
    expect(code("functions/grievance-board.ts")).not.toMatch(/private list\([\s\S]*COUNT\(\*\)[\s\S]*private item\(/);
    expect(code("functions/index.ts")).toMatch(/if \(res\.ok\) await forgetPages\(url, parsed\.value\.kind\)/);
    expect(code("functions/index.ts")).toMatch(/if \(removed\.ok\) await forgetPages\(url, kindFilter\(publicItem\.kind \?\? null\)\)/);
    // a failure no route expected still answers as JSON with the caller's grant — never the platform's bare error page, which a browser may not read
    expect(code("functions/index.ts")).toMatch(/return await route\(request, env, url, path, grant, ctx\);\s*\} catch \(e\) \{[\s\S]*errorResponse\("The board is not answering right now[^"]*", 502, grant/);
    // the moderator passphrase is read from the environment in one place, compared in constant time, and never echoed
    const board = code("functions/grievance-board.ts");
    expect(board.match(/GRIEVANCE_ADMIN_KEY/g)).toHaveLength(2); // the Env type and the one read in authorize()
    expect(board).toMatch(/secretsEqual\(token, key\)/);
    expect(worker).not.toMatch(/jsonResponse\([^)]*(GRIEVANCE_ADMIN_KEY|\bkey\b|token)/); // no answer carries the key or the token
    expect(worker).not.toMatch(/console\.\w+\([^)]*(Authorization|token|GRIEVANCE_ADMIN_KEY|request\.headers)/); // nor does any log line
  });

  it("fails the build if the moderator passphrase — or any other credential the build machine holds — reaches the output", () => {
    const cfg = read(path.join(WEB, "vite.config.ts"));
    const sensitive = new RegExp(/const SENSITIVE_NAME = \/(.+)\/i;/.exec(cfg)?.[1] ?? "$^", "i");
    for (const name of ["GRIEVANCE_ADMIN_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VITE_MAPBOX_ACCESS_TOKEN", "TOMTOM_API_KEY", "EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY", "ADMIN_REVIEWER_EMAILS"]) expect(name, `${name} is not caught by the hygiene gate`).toMatch(sensitive);
    const clientEnv = /const CLIENT_ENV: readonly string\[\] = \[([^\]]+)\]/.exec(cfg)?.[1] ?? "";
    expect(clientEnv).not.toMatch(/GRIEVANCE_ADMIN_KEY|SERVICE_ROLE|MAPBOX|TOMTOM|SUPABASE/); // the allow-list carries no credential
    expect(cfg).toMatch(/if \(text\.includes\(v\.trim\(\)\)\) throw new Error/); // and a value that slips through fails the build
  });

  it("lets the browser talk to exactly one server of ours — the grievance board — over https, by a name the policy also carries", () => {
    const api = read(path.join(WEB, "src/lib/grievance/api.ts"));
    const cfg = read(path.join(WEB, "vite.config.ts"));
    const m = /DEFAULT_GRIEVANCE_API = "(https:\/\/[^"]+)"/.exec(api);
    expect(m).not.toBeNull();
    expect(cfg).toContain(`const DEFAULT_GRIEVANCE_API = "${m?.[1]}"`); // the CSP names the same origin the client calls
    expect(cfg).toContain("originOf(env.VITE_GRIEVANCE_API_URL) ?? originOf(DEFAULT_GRIEVANCE_API)");
    expect(api).toContain('credentials: "omit"'); // no cookie could ever ride along
    expect(api).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/); // nothing about the visitor is kept in the browser either
    expect(api).toMatch(/Authorization: `Bearer \$\{passphrase\}`/); // the passphrase travels in the header…
    expect(api).not.toMatch(/[?&](key|token|pass\w*)=/); // …never in an address
    expect(api).not.toMatch(/console\.\w+\([^)]*(passphrase|Authorization|headers|body)/); // …and no log line carries it
    // every other fetch in the app is a same-origin dataset load or this module
    const callers: string[] = [];
    for (const file of walk(path.join(ROOT, "web/src"))) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      if (/\bfetch\(/.test(read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))) callers.push(rel(file));
    }
    expect(callers.sort()).toEqual(["web/src/hooks/useSignalModel.ts", "web/src/lib/data/dataset.ts", "web/src/lib/grievance/api.ts", "web/src/lib/surveillance/dataset.ts"]);
    // …and those three load only same-origin files under /data/
    for (const f of ["web/src/hooks/useSignalModel.ts", "web/src/lib/data/dataset.ts", "web/src/lib/surveillance/dataset.ts"]) expect(read(path.join(ROOT, f))).not.toMatch(/fetch\(\s*["'`]https?:/);
  });
});
