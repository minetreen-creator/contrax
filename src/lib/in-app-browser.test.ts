import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { embeddedAppName, IN_APP_GOOGLE_NOTE, isEmbeddedBrowser } from "./in-app-browser";

// Owner 2026-11-03: a Charlotte, NC visitor from a Facebook group post reached
// /signup inside Facebook's in-app browser, where Google refuses sign-in.
const FB_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G71 [FBAN/FBIOS;FBAV/584.1.0.65.70;FBBV/1097955119;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/26.6]";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";

describe("in-app browsers", () => {
  test("Facebook and Instagram are embedded; Safari and Chrome are not", () => {
    expect(isEmbeddedBrowser(FB_IOS)).toBe(true);
    expect(embeddedAppName(FB_IOS)).toBe("Facebook");
    expect(isEmbeddedBrowser(INSTAGRAM)).toBe(true);
    expect(embeddedAppName(INSTAGRAM)).toBe("Instagram");
    expect(isEmbeddedBrowser(SAFARI)).toBe(false);
    expect(isEmbeddedBrowser(CHROME)).toBe(false);
    expect(isEmbeddedBrowser(null)).toBe(false);
  });

  test("the note points to email signup", () => {
    expect(IN_APP_GOOGLE_NOTE("Facebook")).toContain("inside the Facebook app");
    expect(IN_APP_GOOGLE_NOTE("Facebook")).toContain("Use your email below");
  });

  test("signup and login swap the Google button for the note in an in-app browser", () => {
    for (const f of ["src/routes/signup.tsx", "src/routes/login.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("{googleAuthUrl && inAppBrowser ? (");
      expect(src).toContain("{IN_APP_GOOGLE_NOTE(inAppBrowser)}");
    }
  });
});
