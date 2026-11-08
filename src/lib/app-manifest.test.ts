import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-08: the homepage offers the customer app, and the generic /manifest.webmanifest
// is the customer app too; Mission Control keeps its own manifest at /admin.webmanifest.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("app manifests", () => {
  test("the generic manifest is the customer app, not Mission Control", () => {
    const generic = JSON.parse(read("../../public/manifest.webmanifest"));
    expect(generic).toEqual(JSON.parse(read("../../public/app.webmanifest")));
    expect(generic.start_url).toBe("/app?source=homescreen");
    expect(JSON.parse(read("../../public/admin.webmanifest")).start_url).toBe("/admin/live");
  });

  test("the homepage links the customer app manifest; Mission Control links its own", () => {
    expect(read("../routes/index.tsx")).toContain('{ rel: "manifest", href: "/app.webmanifest" }');
    expect(read("../routes/admin/live.tsx")).toContain('{ rel: "manifest", href: "/admin.webmanifest" }');
  });
});
