import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-06: mark the name CONTRAX™ (™ needs no registration; the registered-mark symbol is only for a registered mark).
test("the header and email footers claim CONTRAX™, never ®", () => {
  const header = readFileSync("src/components/SiteHeader.tsx", "utf8");
  expect(header).toContain(">™</sup>");
  const email = readFileSync("src/lib/email.ts", "utf8");
  expect(email.match(/CONTRAX&trade; is a trademark of Contrax LLC\./g)?.length).toBe(6);
  for (const src of [header, email]) expect(src).not.toMatch(/®|&reg;/);
});

test("outreach, checkout follow-up and announcement footers carry the trademark line", async () => {
  const { TRADEMARK_LINE } = await import("./trademark");
  expect(TRADEMARK_LINE).toBe("CONTRAX™ is a trademark of Contrax LLC.");
  expect(readFileSync("src/lib/outreach.ts", "utf8")).toContain("`Contrax LLC, ${i.postalAddress} · ${TRADEMARK_LINE}`");
  expect(readFileSync("src/lib/checkout-followup.ts", "utf8")).toContain("`Contrax LLC, ${i.postalAddress} · ${TRADEMARK_LINE}`");
  const ann = readFileSync("src/lib/announcement-email.ts", "utf8");
  expect(ann.match(/\$\{escapeHtml\(TRADEMARK_LINE\)\}/g)?.length).toBe(2);
  expect(ann.match(/^\s+TRADEMARK_LINE,$/gm)?.length).toBe(2);
});
