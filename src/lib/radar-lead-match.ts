/**
 * THE PURE RADAR MATCHER — profile matching for the lead-alert email and the
 * why-line rendered on each matched bid card.
 *
 * Split out of radar-lead-alerts.ts (2026-10-19) so the owner's no-state rule
 * can be unit-tested without importing that module's database/email stack:
 * this file imports ONLY ~/lib/states and ~/lib/trade-registry and touches no
 * network, no database and no email provider. radar-lead-alerts.ts re-exports
 * every symbol below, so existing importers are unaffected.
 *
 * Semantics (unchanged from radar-lead-alerts.ts except where the owner's
 * no-state rule — nightly SAM.gov CSV ingest spec §1, 2026-10-19 — says
 * otherwise): a bid matches when ANY populated profile dimension matches
 * (OR semantics, like bid-alerts), trade being either a 6-digit NAICS code
 * (exact naics_code equality) or expanded trade-registry terms over the bid
 * text. A bid that publishes NO place-of-performance state is qualified by
 * trade ALONE: its state, cert and size dimensions may not admit it.
 */
import { US_PLACES } from "~/lib/states";
import { expandTrade, tradeProvenanceFor } from "~/lib/trade-registry";

/** The lead's Radar profile, as stored in radar_leads.radar_profile. */
export interface RadarLeadProfile {
  trade: string | null;
  state: string | null;
  cert: string | null;
  sizePref: string | null;
  /** Expansion snapshot (migration 034); sender recomputes fresh (single source of truth). */
  expanded?: { terms: string[]; naicsCodes: string[] } | null;
}

// The cert → literal set-aside map mirrors open-bids.ts setAsidePredMulti, so
// the email matcher's cert semantics are IDENTICAL to every listing surface.
const CERT_TO_SET_ASIDE: Record<string, string[]> = {
  "8a": ["8(a)", "8AN"],
  sdvosb: ["SDVOSB"],
  wosb: ["WOSB", "EDWOSB"],
  hubzone: ["HUBZone"],
  vosb: ["VOSB"],
};
const CERT_KEYS = Object.keys(CERT_TO_SET_ASIDE);

/** Honest human label per lead cert key — used ONLY for a reason that fired. */
const CERT_LABELS: Record<string, string> = {
  "8a": "8(a)",
  sdvosb: "SDVOSB",
  wosb: "WOSB",
  hubzone: "HUBZone",
  vosb: "VOSB",
  sb: "Small-business",
};

/** Honest human cap label per sizePref — shown ONLY when a stated bid value
 *  actually fell within the cap (never fabricated, never for "any"). */
const SIZE_CAP_LABELS: Record<string, string> = {
  under250k: "Under $250K",
  under1m: "Under $1M",
  under10m: "Under $10M",
};

const SIZE_PREFS = new Set(["under250k", "under1m", "under10m", "any"]);
const SIZE_CAPS: Record<string, number> = {
  under250k: 250_000,
  under1m: 1_000_000,
  under10m: 10_000_000,
};

const STATE_LOCATION_REGEX = new RegExp(
  `(?:^|,\\s*)(${US_PLACES.join("|")})(?:$|\\s|,)`,
  "i",
);

/**
 * Parse "$185,000", "185000", "1.2M", "800K" … → number or null. Mirrors the
 * radar route's parseValue (single source of truth stays in radar.tsx; this is
 * the same deterministic logic used by the sync-time matcher).
 */
export function parseRadarValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  let mult = 1;
  if (s.endsWith("M")) mult = 1_000_000;
  else if (s.endsWith("K")) mult = 1_000;
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = parseFloat(digits);
  if (Number.isNaN(n)) return null;
  return Math.round(n * mult);
}

/**
 * The bid's OWN place-of-performance state code, or null when the notice
 * publishes none. This is the single piece of geography evidence a bid carries:
 * the nightly SAM.gov CSV ingest stores SAM's `PopState` (blank when absent)
 * and deliberately never borrows the buying office's state, so a blank location
 * means the notice genuinely publishes no work-site state (spec §4).
 *
 * Used by the owner's no-state rule (spec §1) in BOTH the match test and the
 * why-line: no state ⇒ trade/NAICS is the only dimension that can qualify the
 * bid. Exported for the matcher tests.
 */
export function bidPlaceStateCode(location: string | null | undefined): string | null {
  const m = String(location ?? "").match(STATE_LOCATION_REGEX);
  return m ? m[1]!.toUpperCase() : null;
}

export interface BidRow {
  id: number;
  title: string;
  agency: string | null;
  category: string | null;
  description: string | null;
  location: string | null;
  set_aside: string | null;
  naics_code: string | null;
  due_date: string | null;
  estimated_value: string | null;
  source_url: string | null;
}

/**
 * Per-bid WHY flags — the ACTUAL match reasons that fired for one bid against
 * one lead profile (owner 2026-09-06; "Why it matches: CERT · Category ·
 * Size"). Each flag recomputes the EXACT same predicate as
 * bidMatchesLeadProfile below (same text blob, same cert map, same size rule):
 * a reason appears ONLY when it genuinely fired. Omits reasons that did not
 * fire; the email falls back to the honest "your Radar profile" ONLY when no
 * concrete flag fired. NEVER invent a reason that did not fire.
 *
 *   cert     → e.g. "SDVOSB" (the lead's cert label, via the cert→set-aside map)
 *   category → the lead's trade text as searched (or the 6-digit NAICS code)
 *   size     → e.g. "Under $1M" (only when the bid STATED a value within cap)
 */
export interface MatchWhyFlags {
  cert: string | null;
  category: string | null;
  size: string | null;
}

export function whyBidMatchesLeadProfile(
  p: RadarLeadProfile | null,
  bid: BidRow,
): MatchWhyFlags {
  const why: MatchWhyFlags = { cert: null, category: null, size: null };
  if (!p) return why;
  // A bid that publishes NO place-of-performance state is matched by trade ONLY
  // (bidMatchesLeadProfile), so its cert/size signals may never be shown as a
  // reason either: the why-line must name the route that actually admitted the
  // bid. (cert/size still appear for a bid that DOES carry a state.)
  const placeState = bidPlaceStateCode(bid.location);
  const trade = (p.trade ?? "").trim();
  const cert = (p.cert ?? "").trim();
  const sizePref = (p.sizePref ?? "").trim();

  const text = `${bid.title || ""} ${bid.agency || ""} ${bid.category || ""} ${bid.description || ""}`.toLowerCase();

  // trade → substring against the EXPANDED term set (trade-registry); exact
  // NAICS equality for a 6-digit code (expansion never touches NAICS input).
  const isNaics = /^\d{6}$/.test(trade);
  const tradeFired = isNaics
    ? !!bid.naics_code && bid.naics_code.trim() === trade
    : trade.length > 0 && expandTrade(trade).terms.some((t) => t.length >= 2 && text.includes(t));
  if (tradeFired) {
    // HONEST provenance: the register synonym that actually hit (e.g. "freight
    // hauling") or the literal original term - never a fabricated reason.
    const prov = tradeProvenanceFor(text, expandTrade(trade), bid.naics_code);
    why.category = prov ? prov.matchedConcept : trade;
  }

  // cert → literal set-aside map against set_aside OR the bid text.
  if (placeState && cert && (CERT_KEYS.includes(cert) || cert === "sb")) {
    let fired = false;
    if (cert === "sb") {
      fired = !!bid.set_aside && String(bid.set_aside).trim().length > 0;
    } else {
      const pats = CERT_TO_SET_ASIDE[cert] ?? [];
      fired = pats.some((pat) => {
        const pLow = pat.toLowerCase();
        return (
          text.includes(pLow) ||
          (!!bid.set_aside && String(bid.set_aside).toLowerCase().includes(pLow))
        );
      });
    }
    if (fired) why.cert = CERT_LABELS[cert] ?? cert;
  }

  // sizePref → ONLY when the bid carries a stated value within the cap (never
  // fabricated; "any" has no cap so it never produces a size reason).
  if (placeState && sizePref && SIZE_PREFS.has(sizePref) && SIZE_CAPS[sizePref] != null) {
    const ev = parseRadarValue(bid.estimated_value);
    if (ev != null && ev <= (SIZE_CAPS[sizePref] ?? 0)) {
      why.size = SIZE_CAP_LABELS[sizePref] ?? null;
    }
  }

  return why;
}

/** Render the WHY flags as the owner-exact "CERT · Category · Size" line, or
 *  null when nothing concrete fired (caller falls back to the honest
 *  "your Radar profile"). */
export function renderMatchWhyLine(why: MatchWhyFlags): string | null {
  const parts: string[] = [];
  if (why.cert) parts.push(why.cert);
  if (why.category) parts.push(why.category);
  if (why.size) parts.push(why.size);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Whether a single bid matches a lead's radar profile. OR semantics — ANY
 * populated profile field that matches wins (like bid-alerts). Unknown/gated
 * signals never fabricate a match (sizePref only when the bid states a value;
 * a cert we don't map never matches).
 */
export function bidMatchesLeadProfile(p: RadarLeadProfile | null, bid: BidRow): boolean {
  if (!p) return false;
  const trade = (p.trade ?? "").trim();
  const state = (p.state ?? "").trim();
  const cert = (p.cert ?? "").trim();
  const sizePref = (p.sizePref ?? "").trim();

  const text = `${bid.title || ""} ${bid.agency || ""} ${bid.category || ""} ${bid.description || ""}`.toLowerCase();

  // trade → substring against the EXPANDED term set (trade-registry); exact
  // NAICS equality for a 6-digit code (expansion never touches NAICS input).
  const isNaics = /^\d{6}$/.test(trade);
  const tradeMatch = isNaics
    ? !!bid.naics_code && bid.naics_code.trim() === trade
    : trade.length > 0 && expandTrade(trade).terms.some((t) => t.length >= 2 && text.includes(t));

  // cert → literal set-aside map against set_aside OR the bid text.
  let certMatch = false;
  if (cert && (CERT_KEYS.includes(cert) || cert === "sb")) {
    if (cert === "sb") {
      certMatch = !!bid.set_aside && String(bid.set_aside).trim().length > 0;
    } else {
      const pats = CERT_TO_SET_ASIDE[cert] ?? [];
      certMatch = pats.some((pat) => {
        const pLow = pat.toLowerCase();
        return (
          text.includes(pLow) ||
          (!!bid.set_aside && String(bid.set_aside).toLowerCase().includes(pLow))
        );
      });
    }
  }

  // state → locationMatchesStates semantics: an extractable state must be the
  // lead's. NO-STATE GUARD (owner 2026-10-19, nightly SAM.gov CSV ingest spec
  // §Owner's rules 1 — "Bids with no state match ONLY on trade (NAICS code),
  // never by default"):
  //
  // BEFORE this fix the clause read `stateMatch = !m || m[1] === state`, i.e. a
  // bid whose location carries NO state at all matched EVERY lead that had
  // chosen a state — the "blank state means any state" default. That was
  // tolerable while ~1,100 federal rows existed and 96% of them carried a
  // location; it is not tolerable once the nightly CSV ingest stores ~12,000
  // future-deadline federal notices of which 69% (8,439 of 12,232, measured on
  // SAM's own 2026-10-17 extract) publish NO place-of-performance state: every
  // such notice would be a state match for every lead and each lead's digest
  // would fill with thousands of unrelated bids.
  //
  // AFTER: geography may only ever ADMIT a bid whose location names the lead's
  // state, and a bid that names a DIFFERENT state still does not match. A bid
  // that publishes NO state at all is admitted by the trade/NAICS test ALONE:
  // its state dimension has nothing to match on, and its cert/size signals are
  // refused as match ROUTES for such a bid too (the owner's literal rule — cert
  // and size are explicit signals, but they are not the trade the rule names,
  // so they may not sweep a stateless federal notice into an alert either). A
  // no-state bid whose trade does not match therefore reaches nobody.
  const placeState = bidPlaceStateCode(bid.location);
  let stateMatch = false;
  if (state) {
    stateMatch = !!placeState && placeState === state;
  }

  // sizePref → ONLY when the bid carries a stated value (never fabricate);
  // unknown value → no size signal → neutral (never a false negative).
  let sizeMatch = false;
  if (sizePref && SIZE_PREFS.has(sizePref)) {
    const ev = parseRadarValue(bid.estimated_value);
    if (ev != null) sizeMatch = ev <= (SIZE_CAPS[sizePref] ?? 0);
  }

  // THE OWNER'S LITERAL RULE (spec §1): a bid with NO place-of-performance
  // state is qualified by trade/NAICS and NOTHING ELSE. State can never be the
  // reason (there is no state to match), and cert/size may not independently
  // admit it, so a member who only picked states/cert/size receives no
  // stateless federal notice at all.
  if (!placeState) return tradeMatch;
  return tradeMatch || certMatch || stateMatch || sizeMatch;
}
