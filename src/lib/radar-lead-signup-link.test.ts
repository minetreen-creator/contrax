import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { signupLinkForLead as link } from "./radar-lead-signup-link";

// Owner 2026-11-14: a subscriber who just confirmed their email is offered a
// free account, with the trade and state from their alert already filled in.
const src = readFileSync("src/routes/api/radar/lead-confirm.ts", "utf8");

describe("free-account link on the alert confirmation page", () => {
  test("trade and state ride the link; the email never does", () => {
    expect(link({ trade: "Janitorial", state: "va", cert: "sb" })).toBe("https://www.contrax.company/signup?trade=Janitorial&state=VA");
    expect(link({ trade: "Roofing & siding", state: "" })).toBe("https://www.contrax.company/signup?trade=Roofing+%26+siding");
    expect(link({ trade: "someone@gmail.com", state: "Tennessee" })).toBe("https://www.contrax.company/signup");
    expect(link(null)).toBe("https://www.contrax.company/signup");
    expect(link('{"trade":"x"}')).toBe("https://www.contrax.company/signup");
  });
  test("only the confirmed pages carry it, and alerts still need no account", () => {
    expect(src.match(/signupLinkForLead\(lead\.radar_profile\)/g)?.length).toBe(2);
    expect(src).toContain("Create my free account");
    expect(src).toContain("Your alerts need no account");
    expect(src).not.toContain("params.set(\"email\"");
  });
});
