import { describe, expect, test } from "bun:test";
import { GOOGLE_ADS_ID, GOOGLE_ADS_SIGNUP_LABEL, adsTagAllowed, signupConversionCall } from "./google-ads";

describe("Google Ads tag (owner 2026-10-04)", () => {
  test("account id and Signup conversion label", () => {
    expect(GOOGLE_ADS_ID).toBe("AW-18493657028");
    expect(GOOGLE_ADS_SIGNUP_LABEL).toBe("0Qa5CKOFzpAdEMSfu_JE");
    expect(signupConversionCall()).toEqual(["event", "conversion", { send_to: "AW-18493657028/0Qa5CKOFzpAdEMSfu_JE" }]);
  });

  test("never on admin pages", () => {
    expect(adsTagAllowed("/admin/journeys")).toBe(false);
    expect(adsTagAllowed("/radar")).toBe(true);
    expect(adsTagAllowed("/")).toBe(true);
  });

  test("signup conversion: labelled conversion once a label is set, sign_up event before", () => {
    expect(signupConversionCall("abcDEF123")).toEqual(["event", "conversion", { send_to: "AW-18493657028/abcDEF123" }]);
    expect(signupConversionCall("")).toEqual(["event", "sign_up", { send_to: "AW-18493657028" }]);
  });
});
