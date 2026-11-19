import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { encodedHashTarget } from "./encoded-hash";

describe("links whose # arrived as %23", () => {
  test("the emailed winners-list link is sent to the real page and section", () => {
    expect(encodedHashTarget("/federal-construction-by-state%23list")).toBe("/federal-construction-by-state#list");
    expect(encodedHashTarget("/suppliers%23get-report", "?utm_source=email")).toBe("/suppliers?utm_source=email#get-report");
  });

  test("an odd or empty section opens the page without it", () => {
    expect(encodedHashTarget("/suppliers%23")).toBe("/suppliers");
    expect(encodedHashTarget("/suppliers%23<script>")).toBe("/suppliers");
    expect(encodedHashTarget("/suppliers%23a/b")).toBe("/suppliers");
  });

  test("ordinary paths, API paths and off-site tricks are left alone", () => {
    expect(encodedHashTarget("/federal-construction-by-state")).toBeNull();
    expect(encodedHashTarget("/api/thing%23x")).toBeNull();
    expect(encodedHashTarget("//evil.example%23x")).toBeNull();
    expect(encodedHashTarget("%23list")).toBeNull();
  });

  test("the site entry applies it to page requests", () => {
    const entry = readFileSync(new URL("../../vercel-entry.ts", import.meta.url), "utf8");
    expect(entry).toContain("encodedHashTarget(url.pathname, url.search)");
  });
});
