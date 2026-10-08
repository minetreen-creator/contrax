/**
 * "Getting Started with Government Contracting" — free self-paced course for veteran-owned
 * contractors (owner 2026-10-07, for the SBA Rhode Island resource list). PURE:
 * lesson text, quizzes and the AI helper's source text live here so the owner can
 * edit wording in one place. Every rule stated cites an official source in the
 * lesson's `sources`; where rules change often the text says to confirm them.
 */

export const COURSE_ID = "construction-v1";
export const COURSE_TITLE = "Getting Started with Government Contracting";
export const COURSE_SUBTITLE = "A free 15-minute introduction to government contracting, open to everyone";

export type Block = { p: string } | { list: string[] } | { tip: string };

export interface QuizQuestion {
  q: string;
  options: string[];
  /** Index into options. */
  answer: number;
  why: string;
}

export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  blocks: Block[];
  /** What the page shows live under the lesson (real open bids from the database). */
  live?: "count" | "set-aside" | "practice" | "first-bid";
  sources: { label: string; url: string }[];
  quiz: QuizQuestion[];
}

export const LESSONS: Lesson[] = [
  {
    id: "where",
    title: "Where construction bids are posted",
    minutes: 3,
    blocks: [
      { p: "Government construction work is posted in three kinds of places. Most small contractors only watch one, which is why good bids get missed." },
      {
        list: [
          "Federal: SAM.gov (Contract Opportunities). Federal agencies, including the Army Corps of Engineers, post their solicitations here. Search by your trade's NAICS code and the place of performance.",
          "State: Rhode Island agencies, RIDOT and the Division of Capital Asset Management (DCAMM) post on Ocean State Procures, the state's purchasing system, and on the Division of Purchases' bid boards.",
          "Local: cities, towns, school districts and quasi-public agencies (for example, the RI Resource Recovery Corporation) post on their own websites and portals.",
        ],
      },
      { p: "Construction is grouped under NAICS codes beginning 236 (building construction), 237 (heavy and civil, such as roads and bridges) and 238 (specialty trades, such as electrical, plumbing, roofing and concrete). Knowing your codes makes every search faster." },
      { tip: "Contrax pulls federal, state and local bids into one search, so you can check every source at once." },
    ],
    live: "count",
    sources: [
      { label: "SAM.gov Contract Opportunities", url: "https://sam.gov/content/opportunities" },
      { label: "Rhode Island Division of Purchases", url: "https://purchasing.ri.gov" },
      { label: "U.S. Census Bureau NAICS codes", url: "https://www.census.gov/naics/" },
    ],
    quiz: [
      {
        q: "Where do federal agencies like the Army Corps of Engineers post their construction solicitations?",
        options: ["Facebook groups", "SAM.gov", "Only in newspapers"],
        answer: 1,
        why: "Federal solicitations are posted on SAM.gov's Contract Opportunities.",
      },
      {
        q: "A NAICS code starting with 238 means…",
        options: ["Specialty trade contractors (electrical, plumbing, roofing…)", "Trucking", "IT services"],
        answer: 0,
        why: "236 is building construction, 237 is heavy and civil, and 238 is specialty trades.",
      },
    ],
  },
  {
    id: "set-asides",
    title: "Set-asides for veteran-owned contractors",
    minutes: 3,
    blocks: [
      { p: "A set-aside is a contract that only certain kinds of small businesses may bid on. Fewer companies are allowed to compete, which improves your odds." },
      {
        list: [
          "SDVOSB (service-disabled veteran-owned small business) and VOSB (veteran-owned small business): to compete for these federal set-asides, a business must be certified through the SBA's Veteran Small Business Certification program (VetCert). Applying is free.",
          "The federal government has a goal of awarding at least 5% of its contracting dollars to SDVOSBs each year.",
          "The Department of Veterans Affairs gives veteran-owned businesses priority on many of its own contracts (its \"Veterans First\" program).",
          "Other federal set-asides include 8(a), WOSB (women-owned) and HUBZone. Each has its own SBA certification.",
        ],
      },
      { p: "Rhode Island also runs its own state program for service-disabled veteran-owned businesses on state contracts. Ask the state's Division of Purchases about current certification and participation rules, because state programs change." },
      { tip: "Certification takes time. Apply before you find the perfect bid, not after." },
    ],
    live: "set-aside",
    sources: [
      { label: "SBA Veteran Small Business Certification (VetCert)", url: "https://www.sba.gov/federal-contracting/contracting-assistance-programs/veteran-contracting-assistance-programs" },
      { label: "SBA contracting assistance programs", url: "https://www.sba.gov/federal-contracting/contracting-assistance-programs" },
    ],
    quiz: [
      {
        q: "A federal bid says \"SDVOSB set-aside.\" Who can submit an offer?",
        options: ["Any small business", "Only SBA-certified service-disabled veteran-owned small businesses", "Only companies based in Rhode Island"],
        answer: 1,
        why: "Only SDVOSBs certified through SBA VetCert can compete for federal SDVOSB set-asides.",
      },
      {
        q: "Why are set-asides good for a small contractor?",
        options: ["They pay more than other contracts", "Fewer companies are allowed to compete", "They never require bonds"],
        answer: 1,
        why: "A set-aside limits who may bid, so there's less competition. Bonding and other rules still apply.",
      },
    ],
  },
  {
    id: "worth-it",
    title: "Is this bid worth it? The 2-minute check",
    minutes: 3,
    blocks: [
      { p: "Before you spend days on a proposal, check these points in the solicitation. If one is a dealbreaker, move on." },
      {
        list: [
          "Scope: is it work your crew actually does, at a size you can handle?",
          "Location: can you staff and supply the site?",
          "Dates: the due date, the questions deadline, and any pre-bid meeting or site visit. Site visits are often mandatory; miss it and you can't bid.",
          "Bonding: does it require a bid bond, or performance and payment bonds? Can you get them?",
          "Insurance: the required coverage types and limits.",
          "Wages: federal construction contracts generally require Davis-Bacon prevailing wages, and Rhode Island has its own prevailing wage law for public works.",
          "Eligibility: is it set aside for a group you're certified in?",
        ],
      },
      { tip: "Look up who won the last similar contract and for how much (USAspending.gov for federal work). It tells you who you're up against and what price wins." },
    ],
    live: "practice",
    sources: [
      { label: "U.S. Department of Labor: Davis-Bacon and Related Acts", url: "https://www.dol.gov/agencies/whd/government-contracts/construction" },
      { label: "USAspending.gov award search", url: "https://www.usaspending.gov/search" },
    ],
    quiz: [
      {
        q: "A solicitation lists a mandatory site visit next Tuesday. You can't make it. What happens?",
        options: ["Nothing; you can still bid", "You usually can't bid", "You pay a late fee"],
        answer: 1,
        why: "When a site visit is mandatory, skipping it usually disqualifies your bid. Always check this first.",
      },
      {
        q: "Where can you look up who won past federal contracts and for how much?",
        options: ["USAspending.gov", "The IRS website", "Nowhere; it's secret"],
        answer: 0,
        why: "Federal awards are public on USAspending.gov.",
      },
    ],
  },
  {
    id: "bid-ready",
    title: "Getting bid-ready",
    minutes: 3,
    blocks: [
      { p: "Do these once, before you need them. Agencies won't wait for you to register." },
      {
        list: [
          "Register in SAM.gov. It's free and gives your business its Unique Entity ID (UEI). You must renew every year. Never pay a third party to register you.",
          "Register as a vendor on Rhode Island's purchasing system so you can respond to state bids.",
          "Line up bonding. Federal construction contracts over $150,000 generally require performance and payment bonds (the Miller Act). The SBA's Surety Bond Guarantee program helps small contractors who have trouble getting bonded.",
          "Have your insurance certificates ready (general liability, workers' compensation and any others your work needs).",
          "Write a one-page capability statement: what you do, your NAICS codes, certifications, past projects and contact information.",
        ],
      },
      { tip: "Free help is available. SBA district offices, Small Business Development Centers (SBDCs) and APEX Accelerators all help small businesses get ready to bid." },
    ],
    sources: [
      { label: "SAM.gov entity registration", url: "https://sam.gov/content/entity-registration" },
      { label: "SBA Surety Bond Guarantee program", url: "https://www.sba.gov/funding-programs/surety-bonds" },
      { label: "Acquisition.gov: FAR Part 28 (bonds)", url: "https://www.acquisition.gov/far/part-28" },
    ],
    quiz: [
      {
        q: "How much does it cost to register your business in SAM.gov?",
        options: ["It's free", "$99 a year", "$500 one time"],
        answer: 0,
        why: "SAM.gov registration is free. Companies that charge for it are not the government.",
      },
      {
        q: "Which SBA program helps small contractors get bonded?",
        options: ["The Surety Bond Guarantee program", "The 8(a) program", "Payroll protection"],
        answer: 0,
        why: "The SBA's Surety Bond Guarantee program backs bonds for small contractors.",
      },
    ],
  },
  {
    id: "first-bid",
    title: "Winning your first job",
    minutes: 3,
    blocks: [
      { p: "Most contractors don't win a big federal job first. These are the realistic first steps." },
      {
        list: [
          "Start small. Federal purchases between the micro-purchase threshold and the simplified acquisition threshold ($250,000) are generally reserved for small businesses when two or more can compete, and they come with simpler paperwork.",
          "Look for open-enrollment state contracts. Rhode Island issues master price agreements (MPAs) for work like minor construction renovations, and some accept new vendors over a long enrollment period. Once approved, you can be called for jobs without bidding each one. Read each MPA's terms for its requirements.",
          "Subcontract. Large prime contractors must meet small-business subcontracting goals and look for certified small businesses. It's a way to build past performance.",
          "Turn on alerts so you see new bids in your trade the day they're posted.",
        ],
      },
      { tip: "List your company in the Contrax supplier directory so prime contractors looking for veteran-owned subcontractors can find you." },
    ],
    live: "first-bid",
    sources: [
      { label: "Acquisition.gov: FAR 19.502-2 (small business reserve)", url: "https://www.acquisition.gov/far/19.502-2" },
      { label: "Rhode Island Division of Purchases", url: "https://purchasing.ri.gov" },
      { label: "SBA SubNet (subcontracting opportunities)", url: "https://www.sba.gov/federal-contracting/contracting-guide/prime-subcontracting" },
    ],
    quiz: [
      {
        q: "What's an open-enrollment master price agreement (MPA)?",
        options: [
          "A one-time bid that closes next week",
          "A state contract that accepts new vendors over an enrollment period; approved vendors can be called for jobs",
          "A federal loan program",
        ],
        answer: 1,
        why: "Open-enrollment MPAs let you join once and then be called for work, instead of bidding each job.",
      },
      {
        q: "Why do large prime contractors look for small subcontractors?",
        options: ["They must meet small-business subcontracting goals", "It's required on every job under $1,000", "They don't"],
        answer: 0,
        why: "Large primes have small-business subcontracting goals, so certified small subcontractors are in demand.",
      },
    ],
  },
];

export const COURSE_MINUTES = LESSONS.reduce((s, l) => s + l.minutes, 0);

/** Plain text of every lesson — the ONLY material the AI helper may answer from. */
export function courseText(): string {
  return LESSONS.map((l, i) => {
    const body = l.blocks
      .map((b) => ("p" in b ? b.p : "tip" in b ? `Tip: ${b.tip}` : b.list.map((x) => `- ${x}`).join("\n")))
      .join("\n");
    const src = l.sources.map((s) => `${s.label}: ${s.url}`).join("\n");
    return `LESSON ${i + 1}: ${l.title}\n${body}\nSources:\n${src}`;
  }).join("\n\n");
}

export const ASK_FALLBACK =
  "That isn't covered in this course. Your local SBA district office, Small Business Development Center (SBDC) or APEX Accelerator can help with that question for free.";

/** System prompt for the AI helper: answer only from the course text. */
export function askSystemPrompt(): string {
  return [
    `You are the study helper for the free course "${COURSE_TITLE}" by Contrax.`,
    "Answer the student's question using ONLY the course text below. Keep answers short (under 120 words), plain and practical.",
    "Never invent rules, dollar thresholds, deadlines, program names or links that are not in the course text.",
    `If the course text does not answer the question, reply exactly: "${ASK_FALLBACK}"`,
    "Do not give legal advice. Do not discuss anything unrelated to government contracting.",
    "",
    "COURSE TEXT:",
    courseText(),
  ].join("\n");
}

export interface CompletionInput {
  name: string;
  email: string;
  state: string;
}

export function validateCompletion(raw: Record<string, unknown>): { ok: true; value: CompletionInput } | { ok: false; error: string } {
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the name to print on your certificate." };
  const email = String(raw.email ?? "").trim().toLowerCase();
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  const state = String(raw.state ?? "").trim().toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Use a two-letter state code, e.g. RI." };
  return { ok: true, value: { name, email, state } };
}

/** Lesson ids the student has finished, read defensively from stored JSON. PURE. */
export function parseProgress(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    const ids = new Set(LESSONS.map((l) => l.id));
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ids.has(x)))] : [];
  } catch {
    return [];
  }
}

/** Construction specialties used by the course's live opportunity filters. */
export const COURSE_TRADES = [
  { id: "all", label: "All construction", naics: "23" },
  { id: "building", label: "Building construction", naics: "236" },
  { id: "civil", label: "Heavy and civil construction", naics: "237" },
  { id: "electrical", label: "Electrical", naics: "238210" },
  { id: "plumbing-hvac", label: "Plumbing and HVAC", naics: "238220" },
  { id: "roofing", label: "Roofing", naics: "238160" },
  { id: "concrete", label: "Concrete", naics: "238110" },
  { id: "masonry", label: "Masonry", naics: "238140" },
  { id: "painting", label: "Painting", naics: "238320" },
  { id: "site-preparation", label: "Site preparation", naics: "238910" },
] as const;
export function courseTrade(value: unknown) {
  return COURSE_TRADES.find((trade) => trade.id === value) ?? COURSE_TRADES[0];
}
