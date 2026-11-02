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
  /\b(contrax|listed by|posted (by|on)|advertised on|source link|source page|portal|bid service|third-party|public list|prints?|printed|published|closing|opening|opened|bids? open|time zone|eastern time|central time|mountain time|pacific time|registration|register|documents?|responses?|respond|emailed|sold through|notice to contractors|q&a|login|log in|sign in|subscription|in spanish|not stated|not published|see the bid advertisement|bidnet|questcdn|demandstar|bonfire|periscope|bidsync|opengov)\b/i;

/** Longest summary shown on the page, in characters. */
export const JOB_SUMMARY_MAX = 420;

/**
 * The bid's description as a short readable paragraph, or null when there is
 * nothing more to say than the title (empty, tiny, or the title repeated).
 */
export function jobSummary(description: string | null | undefined, title: string | null | undefined): string | null {
  let text = String(description ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const words = a.split(/\s+/);
  const codeLike = words.length <= 3 && /\d/.test(words[0]!) && /^[0-9A-Z]{4,8}$/.test(words[0]!) && words.slice(1).every((w) => /^[A-Z]{1,5}$/.test(w));
  return codeLike ? "Federal agency" : a;
}

/**
 * Where the bid page's $5 button goes. Signed-in visitors go straight to the
 * Starter plan; everyone else signs up first and lands on it. Both carry the
 * bid so the plan page can link back to it.
 */
export function bidStarterHref(bidId: number, signedIn: boolean): string {
  const upgrade = `/upgrade?plan=starter&bid=${bidId}`;
  return signedIn ? upgrade : `/signup?plan=starter&bid=${bidId}&next=${encodeURIComponent(upgrade)}`;
}
