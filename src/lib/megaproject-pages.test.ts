import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STATE_CODE_TO_NAME } from "./location-state";
import { megaStateFromSlug, megaStateHref, megaprojectDescription, megaprojectHref, megaprojectTitle, type Megaproject } from "./megaprojects";

// Owner 2026-11-08: every megaproject and state gets a server-rendered, indexable page.
const all = JSON.parse(readFileSync(new URL("../../public/data/megaprojects.json", import.meta.url), "utf8")) as Megaproject[];

describe("megaproject pages", () => {
  test("project URL and title read like the search", () => {
    const micron = all.find((p) => p.slug === "micron-clay-ny")!;
    expect(megaprojectHref(micron)).toBe("/megaprojects/micron-clay-ny");
    expect(megaprojectTitle(micron)).toBe("Subcontracting opportunities: Micron Memory chip megafab in Clay, NY");
    const d = megaprojectDescription(micron, "New York");
    expect(d).toContain("$100 billion");
    expect(d).toContain("General contractor: Bechtel.");
  });

  test("state slugs round-trip for every state with a project", () => {
    for (const code of new Set(all.map((p) => p.state))) {
      const href = megaStateHref(code, STATE_CODE_TO_NAME);
      expect(href).toMatch(/^\/megaprojects-in\/[a-z-]+$/);
      expect(megaStateFromSlug(href!.split("/").pop()!, STATE_CODE_TO_NAME)).toBe(code);
    }
    expect(megaStateHref("NY", STATE_CODE_TO_NAME)).toBe("/megaprojects-in/new-york");
    expect(megaStateFromSlug("atlantis", STATE_CODE_TO_NAME)).toBeNull();
  });

  test("slugs are unique and URL-safe", () => {
    const slugs = all.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  test("the list page is server-rendered and the sitemap lists every page", () => {
    const list = readFileSync(new URL("../routes/megaprojects.tsx", import.meta.url), "utf8");
    expect(list).toContain("loader: () => getMegaprojectList()");
    expect(list).not.toContain("fetch(MEGAPROJECTS_URL)");
    const sitemap = readFileSync(new URL("../routes/sitemap-local[.]xml.ts", import.meta.url), "utf8");
    expect(sitemap).toContain("megaprojectSitemapPaths()");
  });
});
