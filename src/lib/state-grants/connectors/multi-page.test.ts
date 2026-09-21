/**
 * MULTI-PAGE FETCH — deterministic unit tests (ZERO network).
 *
 * The multi-page pattern is the one piece of shared machinery this tranche adds,
 * and its two failure modes are the ones that produced a NO-GO before: a partial
 * corpus parsed as if it were complete, and a date attributed to the wrong page.
 * Both are pinned here with an injected `fetch`, so the default suite never opens
 * a socket.
 */
import { describe, expect, test } from "bun:test";
import {
  fetchStateGrantPages,
  joinSourcePages,
  sourcePageDelimiter,
  splitSourcePages,
} from "~/lib/state-grants/connectors/multi-page";
import { StateSourceError, stripTags } from "~/lib/state-grants/connectors/source-support";

const INDEX_URL = "https://example.gov/grants";
const CHILD_A = "https://example.gov/grants/a";
const CHILD_B = "https://example.gov/grants/b";
const MARKER = "Grant Programs";
const INDEX_HTML = `<html><body><h1>${MARKER}</h1><ul><li><a href="/grants/a">Program A</a></li><li><a href="/grants/b">Program B</a></li></ul></body></html>`;

/** A fake fetch that serves a fixed page map and records every URL it was asked for. */
function fakeFetch(pages: Record<string, string>, calls: string[]) {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const body = pages[url];
    if (body === undefined) return new Response("not found", { status: 404, headers: {} });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("multi-page fetch — the delimiter round-trip", () => {
  test("join then split returns every page, in fetch order, with its own URL", () => {
    const raw = joinSourcePages(INDEX_URL, "<p>index</p>", [
      { url: CHILD_A, html: "<p>a</p>" },
      { url: CHILD_B, html: "<p>b</p>" },
    ]);
    const pages = splitSourcePages(raw);
    expect(pages.map((p) => p.url)).toEqual([INDEX_URL, CHILD_A, CHILD_B]);
    expect(pages.map((p) => p.html)).toEqual(["<p>index</p>", "<p>a</p>", "<p>b</p>"]);
  });
  test("a payload with no delimiter is one page with an empty URL (never an empty corpus)", () => {
    const pages = splitSourcePages("<p>just one page</p>");
    expect(pages.length).toBe(1);
    expect(pages[0]!.url).toBe("");
    expect(pages[0]!.html).toBe("<p>just one page</p>");
  });
  test("the delimiter survives stripTags, so the live text stays readable", () => {
    const raw = joinSourcePages(INDEX_URL, "<p>index text</p>", []);
    expect(stripTags(raw)).toBe("index text");
  });
  test("the delimiter line is exactly what the fixtures are assembled with", () => {
    expect(sourcePageDelimiter(CHILD_A)).toBe(`\n<!--SOURCE-PAGE: ${CHILD_A}-->\n`);
  });
});

describe("multi-page fetch — fail-closed rules", () => {
  test("the index and every child are fetched once, in the index's own order", async () => {
    const calls: string[] = [];
    const raw = await fetchStateGrantPages({
      indexUrl: INDEX_URL,
      marker: MARKER,
      label: "Example",
      approvedHosts: ["example.gov"],
      childUrls: () => [CHILD_B, CHILD_A],
      minBytes: 10,
      childMinBytes: 10,
      fetchImpl: fakeFetch(
        { [INDEX_URL]: INDEX_HTML, [CHILD_A]: "<p>program a page</p>", [CHILD_B]: "<p>program b page</p>" },
        calls,
      ),
    });
    expect(calls).toEqual([INDEX_URL, CHILD_B, CHILD_A]);
    expect(splitSourcePages(raw).map((p) => p.url)).toEqual([INDEX_URL, CHILD_B, CHILD_A]);
  });
  test("a child that cannot be fetched fails the whole run — never a partial corpus", async () => {
    const calls: string[] = [];
    let thrown: unknown = null;
    try {
      await fetchStateGrantPages({
        indexUrl: INDEX_URL,
        marker: MARKER,
        label: "Example",
        approvedHosts: ["example.gov"],
        childUrls: () => [CHILD_A, CHILD_B],
        minBytes: 10,
        childMinBytes: 10,
        fetchImpl: fakeFetch({ [INDEX_URL]: INDEX_HTML, [CHILD_A]: "<p>program a page</p>" }, calls),
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StateSourceError);
    expect((thrown as StateSourceError).stage).toBe("fetch");
    expect((thrown as Error).message).toContain(CHILD_B);
  });
  test("more children than the cap fails loudly rather than serving a truncated catalogue", async () => {
    const calls: string[] = [];
    let thrown: unknown = null;
    try {
      await fetchStateGrantPages({
        indexUrl: INDEX_URL,
        marker: MARKER,
        label: "Example",
        approvedHosts: ["example.gov"],
        childUrls: () => ["/grants/1", "/grants/2", "/grants/3"].map((p) => `https://example.gov${p}`),
        maxChildren: 2,
        minBytes: 10,
        childMinBytes: 10,
        fetchImpl: fakeFetch({ [INDEX_URL]: INDEX_HTML }, calls),
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as StateSourceError).stage).toBe("fetch");
    expect((thrown as Error).message).toContain("truncated catalogue");
    // Nothing was fetched: the cap is checked before the fan-out starts.
    expect(calls).toEqual([INDEX_URL]);
  });
  test("duplicate child links are fetched once", async () => {
    const calls: string[] = [];
    await fetchStateGrantPages({
      indexUrl: INDEX_URL,
      marker: MARKER,
      label: "Example",
      approvedHosts: ["example.gov"],
      childUrls: () => [CHILD_A, CHILD_A],
      minBytes: 10,
      childMinBytes: 10,
      fetchImpl: fakeFetch({ [INDEX_URL]: INDEX_HTML, [CHILD_A]: "<p>program a page</p>" }, calls),
    });
    expect(calls).toEqual([INDEX_URL, CHILD_A]);
  });
  test("a child that redirected off the approved hosts is refused", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url === INDEX_URL) return new Response(INDEX_HTML, { status: 200 });
      const res = new Response("<p>vendor portal page body</p>", { status: 200 });
      Object.defineProperty(res, "url", { value: "https://vendor.example.net/portal" });
      return res;
    }) as unknown as typeof fetch;
    let thrown: unknown = null;
    try {
      await fetchStateGrantPages({
        indexUrl: INDEX_URL,
        marker: MARKER,
        label: "Example",
        approvedHosts: ["example.gov"],
        childUrls: () => [CHILD_A],
        minBytes: 10,
        childMinBytes: 10,
        fetchImpl,
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as StateSourceError).stage).toBe("fetch");
    expect((thrown as Error).message).toContain("off the approved hosts");
  });
});
