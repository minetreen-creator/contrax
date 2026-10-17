export const LAUNCHPAD_KEY = "contrax_launchpad_v1";
export const REGISTRATION_TASKS = [
  {
    id: "buyers",
    label: "Identify the registration process for my target buyers",
  },
  {
    id: "records",
    label: "Check my business details and applicable industry codes",
  },
  {
    id: "requirements",
    label: "Review required licenses, insurance and certifications",
  },
  { id: "dates", label: "Record registration status and any renewal dates" },
] as const;

export interface LaunchpadProfile {
  company: string;
  trade: string;
  state: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  summary: string;
  competencies: string;
  differentiators: string;
  experience: string;
  naics: string;
  uei: string;
  cage: string;
  certifications: string;
}
export interface LaunchpadBidPlan {
  title: string;
  url: string;
  decision: string;
  notes: string;
  scope: boolean;
  eligibility: boolean;
  timing: boolean;
  action: string;
  date: string;
}
export interface LaunchpadData {
  version: 1;
  updatedAt: string;
  profile: LaunchpadProfile;
  registrations: string[];
  registrationNotes: string;
  bid: LaunchpadBidPlan;
}
export function emptyLaunchpad(): LaunchpadData {
  return {
    version: 1,
    updatedAt: "",
    profile: {
      company: "",
      trade: "",
      state: "",
      contact: "",
      email: "",
      phone: "",
      website: "",
      summary: "",
      competencies: "",
      differentiators: "",
      experience: "",
      naics: "",
      uei: "",
      cage: "",
      certifications: "",
    },
    registrations: [],
    registrationNotes: "",
    bid: {
      title: "",
      url: "",
      decision: "",
      notes: "",
      scope: false,
      eligibility: false,
      timing: false,
      action: "",
      date: "",
    },
  };
}
export function safeOpportunityUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function parseLaunchpad(raw: string | null): LaunchpadData {
  const result = emptyLaunchpad();
  if (!raw) return result;
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || typeof value !== "object")
    throw new Error("Saved Launchpad data is not recognized.");
  for (const field of Object.keys(
    result.profile,
  ) as (keyof LaunchpadProfile)[]) {
    if (typeof value.profile?.[field] === "string")
      result.profile[field] = value.profile[field].slice(0, 4000);
  }
  if (!/^[A-Z]{2}$/.test(result.profile.state)) result.profile.state = "";
  for (const field of [
    "title",
    "url",
    "decision",
    "notes",
    "action",
    "date",
  ] as const) {
    if (typeof value.bid?.[field] === "string")
      result.bid[field] = value.bid[field].slice(0, 4000);
  }
  for (const field of ["scope", "eligibility", "timing"] as const)
    result.bid[field] = value.bid?.[field] === true;
  if (!["bid", "pass", "investigate"].includes(result.bid.decision))
    result.bid.decision = "";
  result.registrations = REGISTRATION_TASKS.filter(
    (task) =>
      Array.isArray(value.registrations) &&
      value.registrations.includes(task.id),
  ).map((task) => task.id);
  result.registrationNotes =
    typeof value.registrationNotes === "string"
      ? value.registrationNotes.slice(0, 4000)
      : "";
  result.updatedAt =
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : "";
  return result;
}
export function hasProfile(profile: LaunchpadProfile): boolean {
  return [profile.company, profile.trade, profile.state].every(
    (value) => !!value.trim(),
  );
}
export function capabilityReady(profile: LaunchpadProfile): boolean {
  return (
    hasProfile(profile) &&
    [
      profile.summary,
      profile.competencies,
      profile.differentiators,
      profile.contact,
    ].every((value) => !!value.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
  );
}
export function launchpadSteps(data: LaunchpadData, beginnerComplete: boolean) {
  return [
    {
      id: "profile",
      title: "Define your business",
      detail: "Capture your services and where you work.",
      href: "#business-profile",
      done: hasProfile(data.profile),
      action: "Build my profile",
    },
    {
      id: "learn",
      title: "Learn the fundamentals",
      detail: "Complete the free beginner course and its quizzes.",
      href: launchpadCourseHref(
        "/learn/government-contracting",
        data.profile,
        false,
      ),
      done: beginnerComplete,
      action: "Start the free course",
    },
    {
      id: "registration",
      title: "Make a registration plan",
      detail: "Work through your checklist and record anything unresolved.",
      href: "#registration-plan",
      done: REGISTRATION_TASKS.every((task) =>
        data.registrations.includes(task.id),
      ),
      action: "Open my checklist",
    },
    {
      id: "capability",
      title: "Build your capability statement",
      detail: "Describe what you offer using facts you can support.",
      href: "#capability-builder",
      done: capabilityReady(data.profile),
      action: "Build my statement",
    },
    {
      id: "review",
      title: "Evaluate a real opportunity",
      detail: "Record a bid, investigate or pass decision and why.",
      href: "#bid-plan",
      done:
        !!data.bid.title.trim() &&
        !!safeOpportunityUrl(data.bid.url) &&
        ["bid", "investigate", "pass"].includes(data.bid.decision) &&
        !!data.bid.notes.trim(),
      action: "Plan my first pursuit",
    },
    {
      id: "action",
      title: "Set your next action",
      detail: "Choose a practical follow-up and a date.",
      href: "#next-action",
      done:
        !!data.bid.action.trim() &&
        /^\d{4}-\d{2}-\d{2}$/.test(data.bid.date) &&
        Number.isFinite(Date.parse(data.bid.date)),
      action: "Set my next action",
    },
  ];
}
export function launchpadRadarHref(profile: LaunchpadProfile): string {
  const params = new URLSearchParams({ source: "learn", course: "launchpad" });
  if (profile.trade.trim())
    params.set("trade", profile.trade.trim().slice(0, 120));
  if (profile.state) params.set("state", profile.state);
  return `/radar?${params}`;
}
export function capabilityText(profile: LaunchpadProfile): string {
  const sections = [
    ["Company overview", profile.summary],
    ["Core competencies", profile.competencies],
    ["Differentiators", profile.differentiators],
    ["Relevant experience", profile.experience],
    ["Certifications (business-reported)", profile.certifications],
  ]
    .filter(([, text]) => text.trim())
    .map(([title, text]) => `${title}\n${text.trim()}`);
  const details = [
    ["Service area", profile.state],
    ["NAICS", profile.naics],
    ["UEI", profile.uei],
    ["CAGE", profile.cage],
    ["Contact", profile.contact],
    ["Email", profile.email],
    ["Phone", profile.phone],
    ["Website", profile.website],
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`);
  return `${profile.company.trim() || "Your company"}\nCAPABILITY STATEMENT\n\n${sections.join("\n\n")}\n\n${details.join("\n")}\n\nPrepared using Contrax Launchpad. Business-provided information; verify all claims before sharing.\n`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
export function capabilityPrintHtml(profile: LaunchpadProfile): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(profile.company || "Capability statement")}</title><style>@page{size:letter;margin:18mm}body{font:11pt/1.5 Arial,sans-serif;color:#14233b;margin:0}h1{font-size:26pt;line-height:1.15;margin:0 0 6px;color:#123a73}p{margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:24px 0}footer{font-size:8pt;color:#536174;border-top:1px solid #dce4ef;padding-top:10px}h1,footer{break-inside:avoid}</style></head><body><h1>${escapeHtml(profile.company || "Your company")}</h1><p>CAPABILITY STATEMENT</p><pre>${escapeHtml(capabilityText(profile).split("\n").slice(3, -2).join("\n"))}</pre><footer>Prepared using Contrax Launchpad. Business-provided information; verify all claims before sharing.</footer></body></html>`;
}

export function launchpadCourseHref(
  path: string,
  profile: LaunchpadProfile,
  includeTrade = true,
): string {
  const params = new URLSearchParams();
  if (profile.state) params.set("state", profile.state);
  if (includeTrade && profile.trade.trim())
    params.set("trade", profile.trade.trim().slice(0, 120));
  return params.size ? `${path}?${params}` : path;
}
