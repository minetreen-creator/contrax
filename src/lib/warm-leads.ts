/**
 * Warm leads (owner 2026-11-15: "he's been on the upgrade pages the other day but never upgrades";
 * then "go" on working the warm leads first). An account that has looked at the plans and has not
 * bought is the closest thing to a buyer the site has. This lists them for the owner and writes
 * the personal note he sends from his own mail. PURE.
 */
export interface WarmLead {
  id: number;
  email: string;
  company: string | null;
  signedUp: string | null;
  /** Separate visits that opened /upgrade or /pricing. */
  looks: number;
  lastLook: string | null;
}

const first = (email: string) => {
  const m = /^([a-z]{2,20})[._-]/i.exec(email.split("@")[0] ?? "");
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
};

export const WARM_SUBJECT = "Quick question about your Contrax account";

/** The first name an address plainly shows ("brandon.smith@" → "Brandon"), or null. Never a guess. */
export const warmFirstName = (email: string) => first(email);

/** The note's lines, without a signature. It never says we watched them on the site. */
export function warmLeadLines(name: string | null, company: string | null): string[] {
  const who = company ? ` for ${company}` : "";
  return [
    name ? `Hi ${name},` : "Hi,",
    "",
    `I'm Nathaniel, the founder of Contrax. You opened an account with us${who}, and I wanted to check in personally.`,
    "",
    "What kind of government work are you looking for, and where? If you reply with your line of work and the area you cover, I'll send you the open bids that fit this week, no charge.",
    "",
    "If you've looked at the plans and something held you back, I'd like to hear that too. Price, the wrong bids, something confusing on the site: whatever it was, tell me and I'll fix what I can.",
    "",
    "One thing that may help: you can try everything for $9. That gets you 30 days of every open bid, and nothing renews.",
    "",
    "Thanks for giving Contrax a look.",
  ];
}

/** The note, as a subject and body, for the owner's own mail. */
export function warmLeadNote(l: Pick<WarmLead, "email" | "company">): { subject: string; body: string } {
  return {
    subject: WARM_SUBJECT,
    body: [...warmLeadLines(first(l.email), l.company), "", "Nathaniel Minetree", "Owner and CEO, Contrax LLC", "contrax.company"].join("\n"),
  };
}

export function warmLeadMailto(l: Pick<WarmLead, "email" | "company">): string {
  const n = warmLeadNote(l);
  return `mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent(n.subject)}&body=${encodeURIComponent(n.body)}`;
}
