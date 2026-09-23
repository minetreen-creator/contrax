/**
 * HOMEPAGE GRANTS PLUS FAIL-SAFE — owner directive rev 327, 2026-09-23.
 *
 * "If the Stripe price configuration or the subscription availability signal
 * becomes unavailable, surfaces must display 'Coming soon' — NEVER a broken
 * payment button; under normal operation the fallback must not appear."
 *
 * /grants already fails safe. The gap this suite pins is the HOMEPAGE tier row:
 * since PR #428 it was static, so it kept advertising a live "Get Grants Plus →"
 * CTA even when the upgrade signal was off. The fix routes the row through the
 * SAME pure signal /grants gates on (`isUpgradePromptEnabled`), read ONCE
 * server-side per request in the / route loader.
 *
 * DETERMINISTIC and network-free by construction: every input is a literal, the
 * component is rendered to static markup in-process, there is no DATABASE_URL,
 * no clock and no fetch. (The production corpus/DB is never involved.)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { ContraxGrantsPromo, resolveGrantsUpgradeEnabled } from "~/routes/index";
import { GRANTS_UPGRADE_FLAG_ENV, isUpgradePromptEnabled } from "~/lib/grants";

// ── helpers ──────────────────────────────────────────────────────────────────

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/** The $49 report's live Stripe payment link (owner-verified 2026-09-23). */
const GRANTS_REPORT_PAYMENT_LINK =
  "https://buy.stripe.com/8x26oJcpV9fCcos7eEf7i0b";

/**
 * Isolate the Grants Plus card from the rendered grants section, so "this ROW
 * has no link" is asserted against the row itself and not against the page.
 * Rows are separated by their identical <h3> opening tag; the row ends at the
 * next card's <div>.
 */
function grantsPlusRow(html: string): string {
  const marker = '<h3 class="text-xl font-bold text-slate-900">';
  const row = html
    .split(marker)
    .find((chunk) => chunk.startsWith("Grants Plus</h3>"));
  if (row === undefined) {
    throw new Error("Grants Plus row not found in the rendered grants section");
  }
  return row.slice(0, row.indexOf("<div"));
}

const on = { [GRANTS_UPGRADE_FLAG_ENV]: "true" };

// ── 1. the decision helper (fail-closed) ─────────────────────────────────────

describe("resolveGrantsUpgradeEnabled — the homepage's single upgrade signal", () => {
  test("enables only for the exact ON values /grants accepts", () => {
    expect(resolveGrantsUpgradeEnabled(on)).toBe(true);
    expect(resolveGrantsUpgradeEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "1" })).toBe(true);
    expect(resolveGrantsUpgradeEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "TRUE" })).toBe(true);
    expect(resolveGrantsUpgradeEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: " 1 " })).toBe(true);
  });

  test("FAIL-CLOSED: absent, empty, false-like, garbage, non-string and unreadable env all disable", () => {
    // absent / no env record at all (this is also the `typeof process ===
    // "undefined"` branch the loader takes when there is no process object)
    expect(resolveGrantsUpgradeEnabled(undefined)).toBe(false);
    expect(resolveGrantsUpgradeEnabled(null)).toBe(false);
    expect(resolveGrantsUpgradeEnabled({})).toBe(false);

    // explicit OFF / garbage / wrong-type values
    for (const raw of ["", " ", "false", "FALSE", "0", "no", "off", "yes", "2", "enabled", "true!"]) {
      expect(resolveGrantsUpgradeEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: raw })).toBe(false);
    }
    // a non-string value (the guard in isUpgradePromptEnabled is typeof-based)
    expect(
      resolveGrantsUpgradeEnabled({
        [GRANTS_UPGRADE_FLAG_ENV]: (() => "true") as unknown as string,
      }),
    ).toBe(false);
    // a near-miss env var name must never enable
    expect(resolveGrantsUpgradeEnabled({ GRANTS_UPGRADE_PROMPT_ENABLED_EXTRA: "true" })).toBe(false);
  });

  test("FAIL-CLOSED: an env that THROWS on read still resolves to disabled (never 500s the homepage)", () => {
    const hostile = new Proxy({} as Record<string, string | undefined>, {
      get() {
        throw new Error("env unavailable");
      },
    });
    expect(resolveGrantsUpgradeEnabled(hostile)).toBe(false);
    // sanity: the raw helper would propagate the throw — the wrapper is what
    // makes the public loader safe, which is exactly why it exists.
    expect(() => isUpgradePromptEnabled(hostile)).toThrow();
  });

  test("single source of truth: agrees with the helper /grants itself gates on", () => {
    for (const env of [
      {},
      on,
      { [GRANTS_UPGRADE_FLAG_ENV]: "0" },
      { [GRANTS_UPGRADE_FLAG_ENV]: "garbage" },
    ] as Record<string, string | undefined>[]) {
      expect(resolveGrantsUpgradeEnabled(env)).toBe(isUpgradePromptEnabled(env));
    }
  });
});

// ── 2. the rendered row ──────────────────────────────────────────────────────

describe("ContraxGrantsPromo — the Grants Plus tier row", () => {
  test("NORMAL PATH: the enabled row is the launched markup, byte for byte", () => {
    const html = renderToStaticMarkup(<ContraxGrantsPromo grantsUpgradeEnabled />);

    // Normal operation must not show the fallback anywhere on the section.
    expect(count(html, "Coming soon")).toBe(0);
    expect(count(html, "Get Grants Plus")).toBe(1);
    // both non-external tiers still link to /grants; the $49 row is untouched.
    expect(count(html, 'href="/grants"')).toBe(2);
    expect(count(html, GRANTS_REPORT_PAYMENT_LINK)).toBe(1);

    // The exact pre-directive anchor (owner-locked copy included): this literal
    // is the markup production rendered before the directive, so "byte-identical
    // under normal operation" is pinned, not asserted by reading the source.
    expect(grantsPlusRow(html)).toContain(
      '<a href="/grants" class="mt-6 block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white">Get Grants Plus →</a>',
    );
  });

  test("FALLBACK: with the signal unavailable the CTA is plain non-interactive text with no href", () => {
    const html = renderToStaticMarkup(
      <ContraxGrantsPromo grantsUpgradeEnabled={false} />,
    );

    expect(count(html, "Coming soon")).toBe(1);
    expect(count(html, "Get Grants Plus")).toBe(0);
    // the free tier keeps its link; the gated row contributes none.
    expect(count(html, 'href="/grants"')).toBe(1);

    const row = grantsPlusRow(html);
    expect(row).toContain("Coming soon");
    // NO payment affordance in the row: no anchor, no href, no button, no
    // stripe/checkout URL. This is the directive's hard requirement.
    expect(row).not.toContain("<a");
    expect(row).not.toContain("href");
    expect(row).not.toContain("<button");
    expect(row).not.toContain("stripe.com");
    // the row's name/price/copy are unchanged by the fallback.
    expect(row).toContain("Grants Plus");
    expect(row).toContain("$19");
    expect(row).toContain("/month");
  });

  test("FAIL-CLOSED: a missing prop (or a non-true value) renders the fallback, never a live CTA", () => {
    for (const html of [
      renderToStaticMarkup(<ContraxGrantsPromo />),
      renderToStaticMarkup(
        <ContraxGrantsPromo grantsUpgradeEnabled={undefined} />,
      ),
    ]) {
      expect(count(html, "Coming soon")).toBe(1);
      expect(count(html, "Get Grants Plus")).toBe(0);
      expect(grantsPlusRow(html)).not.toContain("href");
    }
  });

  test("the other two rows are never gated (owner-locked copy + the live $49 link)", () => {
    for (const html of [
      renderToStaticMarkup(<ContraxGrantsPromo grantsUpgradeEnabled />),
      renderToStaticMarkup(
        <ContraxGrantsPromo grantsUpgradeEnabled={false} />,
      ),
    ]) {
      expect(count(html, "Search grants →")).toBe(1);
      expect(count(html, "Get the $49 Report →")).toBe(1);
      expect(count(html, GRANTS_REPORT_PAYMENT_LINK)).toBe(1);
      expect(count(html, "Included: ")).toBe(3);
      expect(count(html, "Matches and funding are not guaranteed")).toBe(1);
    }
  });
});

// ── 3. the loader contract ───────────────────────────────────────────────────

describe("homepage loader — server-only, per-request, and unable to break the page", () => {
  const src = readFileSync(
    new URL("../src/routes/index.tsx", import.meta.url),
    "utf8",
  );

  test("the env is read exactly once, inside the / loader (never in JSX, never in the client)", () => {
    expect(count(src, "process.env")).toBe(1);
    const loaderAt = src.indexOf("const getLandingData = createServerFn");
    const envAt = src.indexOf("process.env");
    const routeAt = src.indexOf('export const Route = createFileRoute("/")');
    expect(loaderAt).toBeGreaterThan(-1);
    expect(routeAt).toBeGreaterThan(loaderAt);
    // the single read sits inside the loader handler, before the Route export
    expect(envAt).toBeGreaterThan(loaderAt);
    expect(envAt).toBeLessThan(routeAt);
    // nothing build-time / client-side is involved (no baked-in value)
    expect(src).not.toContain("import.meta.env");
    expect(count(src, "VITE_")).toBe(0);
  });

  test("the flag flows loader payload → component props (the path bidStats/contractMap use)", () => {
    // the loader RETURNS the field on the same payload as bidStats/contractMap
    expect(src).toContain("return { businessName, user, bidStats, contractMap, grantsUpgradeEnabled };");
    expect(src).toContain(
      "<ContraxGrantsPromo grantsUpgradeEnabled={grantsUpgradeEnabled} />",
    );
    expect(src).toContain(
      "const { user, bidStats, contractMap, grantsUpgradeEnabled } = Route.useLoaderData();",
    );
  });

  test("the loader's read is the fail-closed wrapper, so no env state can throw out of it", () => {
    expect(src).toContain("resolveGrantsUpgradeEnabled(");
    expect(src).toContain('typeof process !== "undefined" ? process.env : undefined');
    // the wrapper itself is pinned above; here we only prove the loader uses it
    // rather than calling the raw helper (which throws on an unreadable env).
    expect(count(src, "isUpgradePromptEnabled(process")).toBe(0);
  });
});
