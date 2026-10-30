/**
 * Megaprojects near you (owner 2026-10-25, "1"): the big PRIVATE plants going
 * up in the US (chip fabs, factories, pharma campuses). They aren't government
 * bids, but each one hires hundreds of local small businesses as subs and
 * suppliers, before and after it opens.
 *
 * Curated by hand: every amount, job count and contractor comes from the
 * linked source (the company's own announcement, a state or county economic
 * development office, or a major outlet), checked on `checked`. Nothing here
 * is estimated. A field the source doesn't give stays null and the page says
 * nothing about it.
 */
export type MegaSector = "semiconductors" | "tech" | "manufacturing" | "automotive" | "pharma" | "aerospace-defense" | "battery" | "metals" | "energy" | "food" | "entertainment";

export interface Megaproject {
  slug: string;
  company: string;
  project: string;
  city: string;
  state: string;
  sector: MegaSector;
  /** Headline investment for this site, in dollars; null when the source doesn't give one. */
  amount: number | null;
  /** How the source frames the amount, e.g. "up to $100 billion over 20+ years". */
  amountNote: string | null;
  jobs: number | null;
  jobsNote: string | null;
  status: string;
  summary: string;
  generalContractor: { name: string; url: string | null } | null;
  /** Where local suppliers and subs can register or learn how to bid. */
  supplierUrl: { label: string; url: string } | null;
  source: { name: string; url: string };
  checked: string;
}

export const MEGA_SECTORS: Record<MegaSector, { label: string; icon: string }> = {
  semiconductors: { label: "Semiconductors", icon: "💾" },
  tech: { label: "Tech", icon: "🖥️" },
  manufacturing: { label: "Manufacturing", icon: "🏭" },
  automotive: { label: "Automotive", icon: "🚗" },
  pharma: { label: "Pharmaceuticals", icon: "💊" },
  "aerospace-defense": { label: "Aerospace & defense", icon: "🚀" },
  battery: { label: "Batteries", icon: "🔋" },
  metals: { label: "Steel & metals", icon: "🏗️" },
  energy: { label: "Energy", icon: "☀️" },
  food: { label: "Food & beverage", icon: "🥤" },
  entertainment: { label: "Entertainment venues", icon: "🎤" },
};

/** The kinds of local work a site like this typically buys (general guidance, not a promise from the company). */
export const LOCAL_WORK = [
  "Site work, paving and concrete",
  "Electrical, HVAC and plumbing",
  "Trucking, hauling and equipment rental",
  "Security guards",
  "Janitorial and industrial cleaning",
  "Landscaping and snow removal",
  "Fencing, signage and maintenance",
  "Catering, staffing and office supply",
];

/**
 * The list itself lives in public/data/megaprojects.json (served as
 * /data/megaprojects.json and loaded by the page): kept out of the server
 * bundle, which has a hard 12 MB ceiling. Edit that file to add a project;
 * megaprojects.test.ts checks every entry.
 */
export const MEGAPROJECTS_URL = "/data/megaprojects.json";

/** $1.5 billion, $600 million, $225 million. */
export function megaMoney(n: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `$${trimZero(n / 1e9)} billion`;
  if (n >= 1e6) return `$${trimZero(n / 1e6)} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function trimZero(x: number): string {
  return (Math.round(x * 10) / 10).toString();
}

/** Biggest first; projects without an amount after, by company. */
export function sortMegaprojects(list: readonly Megaproject[]): Megaproject[] {
  return [...list].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.company.localeCompare(b.company));
}

export function megaStateCounts(list: readonly Megaproject[]): { code: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of list) m.set(p.state, (m.get(p.state) ?? 0) + 1);
  return [...m].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function megaTotals(list: readonly Megaproject[]): { projects: number; amount: number; jobs: number } {
  return {
    projects: list.length,
    amount: list.reduce((s, p) => s + (p.amount ?? 0), 0),
    jobs: list.reduce((s, p) => s + (p.jobs ?? 0), 0),
  };
}

export function megaprojectsIn(list: readonly Megaproject[], state: string): Megaproject[] {
  const st = state.toUpperCase();
  return sortMegaprojects(list.filter((p) => p.state === st));
}
