import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SOCIAL_PROFILES } from "@/lib/support/social";
import SupportPage from "@/pages/SupportPage";

const render = (el: React.ReactElement, route = "/support"): string => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{el}</MemoryRouter></QueryClientProvider>);

describe("the Support page", () => {
  it("keeps the attribution line and, under it, the maker's three profiles as icon + handle links (user request 2026-09-11)", () => {
    const html = render(<SupportPage />);
    expect(html).toContain("A project under");
    expect(html).toContain('href="https://rasthe.in"');

    const list = html.slice(html.indexOf('aria-label="Profiles"'), html.indexOf("</ul>", html.indexOf('aria-label="Profiles"')));
    expect(list.length).toBeGreaterThan(0);
    expect(list.match(/<a\b/g)).toHaveLength(3);
    expect(list.match(/<svg\b/g)).toHaveLength(3); // one glyph per network, decorative
    expect(list.match(/aria-hidden="true"/g)).toHaveLength(3);
    for (const s of SOCIAL_PROFILES) {
      expect(list).toContain(`href="${s.href}"`);
      expect(list).toContain(`aria-label="${s.network} · ${s.handle}"`); // the network is read out; the icon alone is not the name
      expect(list).toContain(`<span class="mono">${s.handle}</span>`);
    }
    for (const tag of list.match(/<a\b[^>]*>/g) ?? []) {
      expect(tag).toContain('target="_blank"');
      expect(tag).toContain('rel="noopener noreferrer"');
      expect(tag).toContain("coarse:min-h-[44px]"); // a finger-sized row on touch screens
    }
  });

  it("links only https profile pages on the network each handle names, and prints nothing more personal than a handle", () => {
    expect(SOCIAL_PROFILES.map((s) => s.id)).toEqual(["instagram", "x", "linkedin"]);
    const HOST: Record<string, string> = { instagram: "www.instagram.com", x: "x.com", linkedin: "www.linkedin.com" };
    for (const s of SOCIAL_PROFILES) {
      const url = new URL(s.href);
      expect(url.protocol).toBe("https:");
      expect(url.host).toBe(HOST[s.id]);
      expect(url.search).toBe(""); // no tracking or stray query (the pasted LinkedIn link carried a trailing "?")
      expect(url.pathname.endsWith(s.handle.replace(/^@|^in\//, ""))).toBe(true); // the handle shown is the one linked
      expect(s.handle).not.toMatch(/@.+\.|\+91|\d{10}/); // a handle, never a mailbox or a phone number
    }
  });
});
