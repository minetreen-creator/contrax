/**
 * What a visitor typed in the trade box (owner 2026-11-03: a Houston visitor
 * typed "6511East…" three times and a name once, each "0 matches", before
 * searching "Landscaping" and finding 25 bids). PURE.
 */
import { expandTrade } from "./trade-registry";

/** True for a six-digit NAICS code or a word the trade registry knows. */
export function isKnownTrade(input: string | null | undefined): boolean {
  const t = String(input ?? "").trim();
  if (!t) return false;
  if (/^\d{6}$/.test(t)) return true;
  return expandTrade(t).naicsCodes.length > 0;
}

/** True when the text starts like a street address ("6511 East Fwy", "6511East…") and is not a known trade. */
export function looksLikeAddress(input: string | null | undefined): boolean {
  const t = String(input ?? "").trim();
  if (!/^\d{1,6}\s*[A-Za-z]/.test(t)) return false;
  if (isKnownTrade(t)) return false;
  // "24 hour plumbing" names a trade after its number; an address does not.
  return !t.split(/[\s,]+/).some((w) => /^[A-Za-z]{3,}$/.test(w) && isKnownTrade(w));
}

export const ADDRESS_TIP = "That looks like an address. Type your trade (like mowing, HVAC or plumbing), then pick your state.";
export const ADDRESS_TIP_ES = "Eso parece una dirección. Escriba su oficio (como jardinería, aire acondicionado o plomería) y elija su estado.";

/** The zero-results line when the text is not a trade we know. */
export function notATradeLine(input: string): string {
  const t = input.trim().slice(0, 40);
  return `We don't know "${t}" as a trade. Try one like mowing, HVAC, plumbing, roofing or janitorial.`;
}
