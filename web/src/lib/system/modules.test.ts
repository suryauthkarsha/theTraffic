import { describe, expect, it } from "vitest";

import { moduleForKey, MODULES } from "./modules";

describe("console modules", () => {
  it("lists six instruments with unique indices, routes and digit shortcuts — no planner, contribute or reviewer console", () => {
    expect(MODULES).toHaveLength(6);
    expect(MODULES.map((m) => m.index)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(new Set(MODULES.map((m) => m.to)).size).toBe(6);
    expect(MODULES.map((m) => m.key).join("")).toBe("123456");
    expect(MODULES.map((m) => m.to)).not.toContain("/admin");
    expect(MODULES.map((m) => m.to)).not.toContain("/contribute");
    expect(MODULES.map((m) => m.to)).not.toContain("/plan");
    // The two maps come first, then the reading pages, Support (user decision 2026-09-09), then the board (2026-09-11).
    expect(MODULES.map((m) => m.id)).toEqual(["signals", "surveillance", "research", "methodology", "support", "grievances"]);
    expect(MODULES[0]).toMatchObject({ id: "signals", to: "/signals", key: "1", index: "01" });
    expect(MODULES[1]).toMatchObject({ id: "surveillance", to: "/surveillance", key: "2", index: "02" });
    expect(MODULES[4]).toMatchObject({ id: "support", to: "/support", key: "5", index: "05" });
    expect(MODULES[5]).toMatchObject({ id: "grievances", to: "/grievances", key: "6", index: "06" });
  });

  it("maps digit keys to modules and nothing else", () => {
    expect(moduleForKey("1")?.id).toBe("signals");
    expect(moduleForKey("2")?.id).toBe("surveillance");
    expect(moduleForKey("3")?.id).toBe("research");
    expect(moduleForKey("4")?.id).toBe("methodology");
    expect(moduleForKey("5")?.id).toBe("support");
    expect(moduleForKey("6")?.id).toBe("grievances");
    expect(moduleForKey("7")).toBeNull();
    expect(moduleForKey("a")).toBeNull();
  });

  it("describes every tool in one short sentence — no kickers, no status lines, no second sentence of explanation (declutter, 2026-09-08)", () => {
    for (const m of MODULES) {
      expect(m.description.length).toBeLessThanOrEqual(80);
      expect(m.description.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
      expect(m).not.toHaveProperty("kicker");
    }
  });
});
