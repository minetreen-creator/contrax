import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-07 ("1"): phone visitors on Radar and bid pages get the app install prompt.
test("Radar and bid pages show the install banner and link the app manifest", () => {
  for (const [f, where] of [["src/routes/radar.tsx", "radar"], ["src/routes/bid.$bidId.tsx", "bid"]]) {
    const src = readFileSync(f, "utf8");
    expect(src).toContain(`<AppInstallBanner where="${where}" />`);
    expect(src).toContain('{ rel: "manifest", href: "/app.webmanifest" }');
  }
});

test("the banner is phones only, skips installed phones, shows once, and says alerts are paid", () => {
  const src = readFileSync("src/components/AppInstallBanner.tsx", "utf8");
  expect(src).toContain('/iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : null');
  expect(src).toContain('(display-mode: standalone)');
  // Installed phones are skipped via the shared install flag (src/lib/app-install.ts).
  expect(src).toContain("localStorage.getItem(APP_INSTALLED_KEY)");
  expect(readFileSync("src/lib/app-install.ts", "utf8")).toContain('APP_INSTALLED_KEY = "contrax-app-installed"');
  expect(src).toContain("Phone alerts need a paid plan.");
});
