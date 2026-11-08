import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-08: "fix the banner install count". An Android install accepted from the Radar /
// bid-page banner used to be counted only once the app was opened from the home screen.
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});
afterEach(() => {
  delete (globalThis as any).localStorage;
});

describe("app install counting", () => {
  test("counts once per phone, with the platform", async () => {
    const mod = await import("./app-install");
    expect(mod.devicePlatform("Mozilla/5.0 (Linux; Android 10; K) Chrome/156")).toBe("android");
    expect(mod.devicePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("ios");
    expect(mod.devicePlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe("desktop");
    expect(mod.markAppInstalled("Android")).toBe(true);
    expect(store.has(mod.APP_INSTALLED_KEY)).toBe(true);
    // The same phone installing again (or the app page opening from the home screen) is not a second install.
    expect(mod.markAppInstalled("Android")).toBe(false);
  });

  test("the banner and the app page both count an accepted or finished install", () => {
    const banner = readFileSync(new URL("../components/AppInstallBanner.tsx", import.meta.url), "utf8");
    expect(banner).toContain('window.addEventListener("appinstalled", onInstalled)');
    expect(banner).toMatch(/outcome === "accepted"\) \{\s*markAppInstalled\(\)/);
    const page = readFileSync(new URL("../routes/app.tsx", import.meta.url), "utf8");
    expect(page).toContain('if (choice?.outcome === "accepted") markAppInstalled();');
    expect(page).toContain("markAppInstalled(ua)");
  });
});
