/**
 * Plain-English pieces of the public bid page (owner 2026-11-02, design
 * critique: "visitors are asked to pay before they see what the job is"). The
 * job itself is free to read; only the official notice and its documents are
 * for members. All functions here are PURE.
 */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** A sentence that is a source or process note, not a description of the work. */
const PROCESS_NOTE =
  /\b(contrax|listed by|posted (by|on)|advertised on|source link|source page|portal|bid service|third-party|public list|prints?|printed|published|closing|opening|opened|bids? open|time zone|eastern time|central time|mountain time|pacific time|registration|register|documents?|responses?|respond|emailed|sold through|notice to contractors|q&a|login|log in|sign in|subscription|in spanish|not stated|not published|see the bid advertisement|bidnet|questcdn|demandstar|bonfire|periscope|bidsync|opengov|bulletin board|plan holders?|cabb)\b/i;

/**
 * The agency's own numbers written out in a description ("order 756", "state project PM7D-030-27F, P401",
 * "solicitation no. 24-118"). The free page never shows the bid number (owner 2026-11-11: "dont show it"),
 * and these let a reader look the notice up without it (2026-11-12: a visitor read a VDOT bid for five
 * minutes; its text gave the order and project numbers and named the board holding the documents).
 */
const LABELLED_ID =
  /\b(?:order|state project|federal project|project (?:no\.?|number|#)|contract (?:id|no\.?|number|#)|solicitation (?:id|no\.?|number|#)|bid (?:id|no\.?|number|#)|proposal (?:id|no\.?|number|#)|reference (?:no\.?|number|#))\s*[:#]?\s*[A-Z0-9][A-Z0-9\-_/.]*\d[A-Z0-9\-_/.]*(?:\s*,\s*[A-Z]{0,4}\d[A-Z0-9\-_/.]*)*/gi;

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remove the agency's own numbers from a description: labelled ones, and the bid's stored number(s). PURE. */
export function stripAgencyNumbers(text: string, ids?: string | null): string {
  let out = text.replace(LABELLED_ID, "");
  for (const id of String(ids ?? "").split(/[\s,;]+/)) {
    if (id.length >= 4 && /\d/.test(id)) out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(id)}(?![A-Za-z0-9])`, "gi"), "");
  }
  // Tidy what the removals leave behind: "(; location X; ; time)" reads "(location X; time)".
  return out
    .replace(/\s*;(?:\s*;)+/g, ";")
    .replace(/\(\s*[;,]\s*/g, "(")
    .replace(/\s*[;,]\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A bid's description as it may leave the server for a visitor without a pass: the agency's own
 * numbers removed, and the sentences that say where the notice and documents are dropped. The page
 * data a browser receives is readable, so this runs on the server, not only when drawing. PURE.
 */
export function publicJobText(description: string | null | undefined, ids?: string | null): string | null {
  const text = String(description ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const kept = stripAgencyNumbers(text, ids)
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !PROCESS_NOTE.test(sentence))
    .join(" ")
    .trim();
  return kept || null;
}

/** Longest summary shown on the page, in characters. */
export const JOB_SUMMARY_MAX = 420;

/**
 * The bid's description as a short readable paragraph, or null when there is
 * nothing more to say than the title (empty, tiny, or the title repeated).
 */
export function jobSummary(description: string | null | undefined, title: string | null | undefined, ids?: string | null): string | null {
  let text = String(description ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
  // The agency's own numbers never show on the free page (see LABELLED_ID).
  text = stripAgencyNumbers(text, ids);
  // Many sources store our own provenance and "how to respond" notes in the
  // description ("Listed by BidNet Direct…", "Respond through the portal (see
  // source link)"). Those are not the job, and they name where the free notice
  // is; keep only sentences that describe the work.
  text = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !PROCESS_NOTE.test(sentence))
    .join(" ")
    .trim();
  if (text.length < 40) return null;
  const t = String(title ?? "").trim().toLowerCase();
  if (t && text.toLowerCase() === t) return null;
  if (t && text.toLowerCase().startsWith(t)) {
    const rest = text.slice(t.length).replace(/^[\s:.\-–—]+/, "");
    if (rest.length < 40) return null;
    text = rest;
  }
  if (text.length <= JOB_SUMMARY_MAX) return text;
  const cut = text.slice(0, JOB_SUMMARY_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > JOB_SUMMARY_MAX * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** The estimated value worth printing, or null for "Not specified", "N/A" and other non-amounts. */
export function valueLabel(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return /\d/.test(v) ? v : null;
}

/** "12 days left", "1 day left", "Due today", or null once the deadline has passed. */
export function daysLeftLabel(due: string | null | undefined, now: number = Date.now()): string | null {
  if (!due) return null;
  const t = new Date(due).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - now) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

/**
 * A buyer name a contractor can read. Federal office codes ("693JK4 OST",
 * "36C250") become "Federal agency"; real names pass through.
 */
export function agencyDisplay(agency: string | null | undefined): string | null {
  const a = String(agency ?? "").trim();
  if (!a) return null;
  // BidNet Direct rows carry the purchasing group, not the buyer: the issuing organization is a
  // members-only cell on BidNet and is never read (owner 2026-11-10: "Connecticut Purchasing Group"
  // read as if it were the buyer).
  const g = /^(.+?) Purchasing Group(?: \([^)]*\))? \(BidNet Direct\)$/.exec(a);
  if (g) {
    const place = g[1] === "Empire State" ? "New York" : g[1].replace(/ & DC$/, " or DC");
    // "An Ohio", "An Idaho", but "A Utah" (said "yoo-tah").
    return `${/^[AEIO]/.test(place) ? "An" : "A"} ${place} public agency (posted on BidNet Direct)`;
  }
  const words = a.split(/\s+/);
  const codeLike = words.length <= 3 && /\d/.test(words[0]!) && /^[0-9A-Z]{4,8}$/.test(words[0]!) && words.slice(1).every((w) => /^[A-Z]{1,5}$/.test(w));
  return codeLike ? "Federal agency" : a;
}

/** The buyer inside a sentence: "…, for an Ohio public agency (posted on BidNet Direct)". PURE. */
/**
 * The agency line on a small bid card (owner 2026-11-11). The BidNet wording is too long for one
 * line ("AN OHIO PUBLIC AGENCY (POSTE…") and repeats the state the card already shows. PURE.
 */
export function agencyCardLabel(agency: string | null | undefined): string | null {
  const d = agencyDisplay(agency);
  return d && / public agency \(posted on BidNet Direct\)$/.test(d) ? "Posted on BidNet Direct" : d;
}

export function agencyInSentence(agency: string | null | undefined): string | null {
  const d = agencyDisplay(agency);
  return d ? d.replace(/^(An?) (?=.+ public agency \(posted on BidNet Direct\)$)/, (_, a: string) => `${a.toLowerCase()} `) : d;
}

/**
 * Where the bid page's $5 button goes: the Starter plan page, signed in or not (owner 2026-11-10:
 * pay without making an account first). It carries the bid so the plan page can link back to it.
 */
export function bidStarterHref(bidId: number, signedIn: boolean): string {
  const upgrade = `/upgrade?plan=starter&bid=${bidId}`;
  // Owner 2026-11-10 ("2": pay without making an account first): signed out goes to the same page;
  // its button opens Stripe, which asks for the email, and /post-checkout creates the account.
  void signedIn;
  return upgrade;
}
