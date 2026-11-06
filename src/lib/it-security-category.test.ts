import { expect, test } from "bun:test";
import { mapCategory } from "./trade-classification";

// Owner 2026-11-06: "or cybersecurity / that's IT".
test("IT-security work is IT Services, physical security stays Security", () => {
  for (const t of [
    "Cyber Security Penetration Testing",
    "Network Security Firewall Upgrade",
    "Information Security Consulting",
    "Managed Security Services Provider (MSSP) for SOC",
    "IT Security Awareness Training",
    "Vulnerability Assessment and Penetration Testing",
    "Endpoint Detection and Response Licenses",
    "Security Operations Center Services",
  ]) expect(mapCategory("", t, "")).toBe("IT Services");
  for (const t of ["Unarmed Security Guard Services", "Security Camera Installation", "Security Patrol Services", "Event Security Staffing"]) {
    expect(mapCategory("", t, "")).toBe("Security");
  }
});
