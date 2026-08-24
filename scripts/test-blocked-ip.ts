/**
 * Standalone test for the IP-block guard (src/lib/request-ip.ts).
 * Run with: bun scripts/test-blocked-ip.ts
 */
import { getClientIp, isBlockedIp } from "../src/lib/request-ip";

function mkReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { headers });
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.log(`FAIL  ${name}`);
    fail++;
  }
}

// ── Should be blocked (exact match, including the flagged proxy IP) ──────────
check(
  "x-forwarded-for 5.175.149.80 -> blocked",
  isBlockedIp(mkReq({ "x-forwarded-for": "5.175.149.80" })) === true,
);
check(
  "x-forwarded-for list where blocked IP is first -> blocked",
  isBlockedIp(mkReq({ "x-forwarded-for": "5.175.149.80, 1.2.3.4" })) === true,
);
check(
  "cf-connecting-ip 5.175.149.80 -> blocked",
  isBlockedIp(mkReq({ "cf-connecting-ip": "5.175.149.80" })) === true,
);
check(
  "x-real-ip 5.175.149.80 -> blocked",
  isBlockedIp(mkReq({ "x-real-ip": "5.175.149.80" })) === true,
);

// ── Should NOT be blocked (real / our own test IPs) ──────────────────────────
check(
  "real IP 143.198.100.50 -> NOT blocked",
  isBlockedIp(mkReq({ "x-forwarded-for": "143.198.100.50" })) === false,
);
check(
  "test IP 34.214.71.218 -> NOT blocked",
  isBlockedIp(mkReq({ "cf-connecting-ip": "34.214.71.218" })) === false,
);
check(
  "test IP 73.40.36.204 -> NOT blocked",
  isBlockedIp(mkReq({ "x-real-ip": "73.40.36.204" })) === false,
);
check(
  "no relevant header -> NOT blocked",
  isBlockedIp(mkReq({})) === false,
);

// ── getClientIp resolution semantics ─────────────────────────────────────────
check(
  "getClientIp takes first x-forwarded-for value",
  getClientIp(mkReq({ "x-forwarded-for": "1.2.3.4, 2.3.4.5" })) === "1.2.3.4",
);
check(
  "getClientIp prefers x-forwarded-for over cf-connecting-ip",
  getClientIp(mkReq({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.175.149.80" })) ===
    "1.2.3.4",
);
check(
  "getClientIp returns null when no header present",
  getClientIp(mkReq({})) === null,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
