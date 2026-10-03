/**
 * Visitor-state default for Radar links without a state (owner 2026-10-03:
 * a Denver trucker arrived from Google on a nationwide trucking link). The
 * state comes from Vercel's IP geolocation headers, the same coarse source the
 * visitor board shows. US only; anything else means "no default" (nationwide).
 * PURE; unit-tested in radar-geo.test.ts.
 */
import { normalizeStateInput } from "~/lib/location-state";

export function stateFromGeoHeaders(country: string | null | undefined, region: string | null | undefined): string {
  if (String(country ?? "").trim().toUpperCase() !== "US") return "";
  return normalizeStateInput(String(region ?? "").trim());
}

/** Resolve a promise, or "" after `ms` (never blocks the scan for long). */
export function withTimeout(p: Promise<string>, ms: number): Promise<string> {
  return Promise.race([p.catch(() => ""), new Promise<string>((r) => setTimeout(() => r(""), ms))]);
}
