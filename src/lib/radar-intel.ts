/**
 * RADAR INCUMBENT-INTEL LAZY LOADER — owner 09-16 (Radar scan-latency fix).
 *
 * The Radar scan itself no longer touches FPDS/USAspending: it returns matches
 * in ≈0.2 s and the results screen then asks for incumbent intel PER DISPLAYED
 * OPPORTUNITY through the `getRadarMatchIntel` server fn. This module is the
 * client half of that contract, kept dependency-free and pure so it is
 * unit-testable under `bun test` (no DOM, no server call).
 *
 * NEVER STUCK (the never-stuck rule applies to this stage too — the owner's
 * explicit requirement is "never a stuck spinner, never a hanging request"):
 *   - every per-card fetch is raced against RADAR_INTEL_CLIENT_TIMEOUT_MS and
 *     settles as "unavailable" on timeout;
 *   - a rejection (network cut, edge error, server fn error) settles as
 *     "unavailable";
 *   - a malformed/empty response settles as "unavailable".
 * The SERVER side is bounded independently (see ~/lib/fpds: AbortSignal
 * timeouts), so an abandoned client fetch cannot keep spending upstream.
 *
 * The 15 s Radar scan cap (RADAR_SCAN_TIMEOUT_MS, ~/lib/radar-scan-runner) is
 * deliberately UNTOUCHED: this stage has its own, much smaller budget.
 */
import type { FPDSIntel } from "~/lib/fpds";

/** Per-opportunity budget on the CLIENT. Chosen above the server's per-lookup
 *  budget (~5 s, FPDS_RADAR_LOOKUP_TIMEOUT_MS) so a healthy-but-slow lookup is
 *  allowed to finish and only a genuinely sick one is cut off, and well below
 *  the 15 s scan cap so the card can never sit in a loading state. */
export const RADAR_INTEL_CLIENT_TIMEOUT_MS = 6_000;

export type MatchIntelStatus = "idle" | "loading" | "ok" | "none" | "unavailable";

export interface MatchIntelState {
  /** idle = nothing requested (flag off / not an entitled match).
   *  loading = in flight (bounded by RADAR_INTEL_CLIENT_TIMEOUT_MS).
   *  ok = real intel.
   *  none = upstream answered: this notice has no incumbent record.
   *  unavailable = we could not determine it (timeout / error / not entitled). */
  status: MatchIntelStatus;
  intel: FPDSIntel | null;
}

/** What the lazy server fn returns (see radar.tsx getRadarMatchIntel). */
export interface MatchIntelResult {
  status: "ok" | "none" | "unavailable";
  intel: FPDSIntel | null;
}

export const RADAR_INTEL_IDLE: MatchIntelState = { status: "idle", intel: null };

/** Fetch one opportunity's intel, BOUNDED: always settles, never throws, never
 *  hangs. Injectable timer for tests (bun test drives it with a small budget). */
export async function loadRadarIntel(
  fetchIntel: () => Promise<MatchIntelResult | null | undefined>,
  timeoutMs: number = RADAR_INTEL_CLIENT_TIMEOUT_MS,
): Promise<MatchIntelState> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<MatchIntelState>((resolve) => {
      timer = setTimeout(() => resolve({ status: "unavailable", intel: null }), timeoutMs);
    });
    const work: Promise<MatchIntelState> = Promise.resolve()
      .then(() => fetchIntel())
      .then((r): MatchIntelState => {
        if (!r || (r.status !== "ok" && r.status !== "none" && r.status !== "unavailable")) {
          return { status: "unavailable", intel: null }; // malformed → never claimed
        }
        if (r.status === "ok") {
          // "ok" MUST carry data — an empty ok is reported as unavailable rather
          // than rendered as a winner-or-no-winner claim we cannot back.
          return r.intel ? { status: "ok", intel: r.intel } : { status: "unavailable", intel: null };
        }
        return { status: r.status, intel: null };
      })
      .catch(() => ({ status: "unavailable", intel: null }) as MatchIntelState);
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
