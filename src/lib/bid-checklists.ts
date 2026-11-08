/**
 * Downloadable bid & compliance checklists (owner 2026-11-08: "One-page HTML checklists for common
 * commercial solicitations (e.g., Municipal Landscaping IFB Checklist or Commercial Janitorial Bid
 * Prep)").
 *
 * HONESTY: every item is a step or document public buyers commonly ask for in that kind of
 * solicitation. Nothing here claims a specific law or amount applies to a given bid; items that
 * depend on the buyer say so ("if the solicitation asks", "often"). Each page tells the reader the
 * solicitation itself is the rule. PURE, browser-safe.
 */
export interface ChecklistSection {
  heading: string;
  items: string[];
}

export interface BidChecklist {
  slug: string;
  /** Page and file title. */
  title: string;
  /** Short line for the index card. */
  blurb: string;
  /** Radar trade the page links to. */
  trade: string;
  /** Trade label for the Radar button ("landscaping"). */
  tradeLabel: string;
  sections: ChecklistSection[];
}

const COMMON_SUBMIT: ChecklistSection = {
  heading: "Submit",
  items: [
    "Use the exact bid form or price sheet the buyer gave; don't retype it",
    "Sign every form that asks for a signature, by someone allowed to bind the company",
    "Acknowledge every addendum on the form the solicitation names",
    "Match the submission method: sealed envelope, e-bid portal or email, as the IFB says",
    "Label a sealed envelope exactly as instructed (bid number, title, due date)",
    "Deliver or upload before the deadline; late bids are usually rejected unopened",
    "Keep a full copy of everything you submitted",
  ],
};

const COMMON_AFTER: ChecklistSection = {
  heading: "After the opening",
  items: [
    "Attend or check the public bid opening, or ask for the bid tabulation",
    "Note the winning price and winner for your next bid",
    "If you win, have insurance certificates and bonds ready within the deadline the award letter gives",
  ],
};

export const BID_CHECKLISTS: readonly BidChecklist[] = [
  {
    slug: "municipal-landscaping-ifb",
    title: "Municipal Landscaping IFB Checklist",
    blurb: "Mowing, grounds and park maintenance bids from cities, counties and school districts.",
    trade: "landscaping",
    tradeLabel: "landscaping",
    sections: [
      {
        heading: "Before you decide to bid",
        items: [
          "Read the whole IFB, the scope and every addendum",
          "List every site, its acreage and the service frequency (weekly, bi-weekly, per cycle)",
          "Note the season dates and how many cycles the price must cover",
          "Go to the pre-bid meeting or site walk if there is one (some are mandatory)",
          "Check whether you must have a pesticide applicator license for any chemical work",
          "Confirm you have the crew and equipment for the busiest week, not the average one",
        ],
      },
      {
        heading: "Documents to gather",
        items: [
          "Business license and any state contractor or landscape license the IFB asks for",
          "Certificate of insurance at the limits stated (general liability, auto, workers' comp)",
          "W-9 and vendor registration with the buyer, if they require it before award",
          "References from similar grounds contracts, with contact names",
          "Equipment list, if the IFB asks for one",
          "Bid bond or certified check, if the IFB requires bid security",
          "Signed non-collusion affidavit or other forms in the bid package",
        ],
      },
      {
        heading: "Pricing",
        items: [
          "Price per site and per cycle exactly as the price sheet is laid out",
          "Include fuel, disposal of clippings and debris, and travel between sites",
          "Price optional or extra services (leaf removal, mulch, irrigation checks) only where asked",
          "Check whether prevailing wage applies before you set labor rates",
        ],
      },
      COMMON_SUBMIT,
      COMMON_AFTER,
    ],
  },
  {
    slug: "commercial-janitorial-bid-prep",
    title: "Commercial Janitorial Bid Prep Checklist",
    blurb: "Custodial and cleaning service bids for offices, schools and public buildings.",
    trade: "janitorial",
    tradeLabel: "janitorial",
    sections: [
      {
        heading: "Before you decide to bid",
        items: [
          "Read the scope, the cleaning frequency chart and every addendum",
          "List every building with its square footage, floors and restroom count",
          "Note the hours you may clean (after hours, weekends) and any building access rules",
          "Attend the walkthrough; measure or confirm floor types (carpet, VCT, tile)",
          "Check who supplies paper, soap and liners: you or the buyer",
          "Check whether staff need background checks, badges or drug screening",
        ],
      },
      {
        heading: "Documents to gather",
        items: [
          "Business license and any state registration the solicitation asks for",
          "Certificate of insurance at the limits stated, plus a janitorial bond if required",
          "W-9 and vendor registration with the buyer",
          "References from similar cleaning contracts, with contact names",
          "Staffing plan: crew size, supervisor and hours per building",
          "Product list or safety data sheets, if green-cleaning or chemical rules apply",
          "Signed bid forms, affidavits and addendum acknowledgments",
        ],
      },
      {
        heading: "Pricing",
        items: [
          "Work out labor hours from square footage and frequency, then price the hours",
          "Include supervision, supplies (if yours), equipment and turnover",
          "Price periodic work (floor stripping, carpet extraction, windows) as the sheet asks",
          "Check whether a wage determination or living wage rule applies",
        ],
      },
      COMMON_SUBMIT,
      COMMON_AFTER,
    ],
  },
  {
    slug: "public-works-construction-bid",
    title: "Public Works Construction Bid Checklist",
    blurb: "Paving, building, sewer and site work let by cities, counties and state agencies.",
    trade: "construction",
    tradeLabel: "construction",
    sections: [
      {
        heading: "Before you decide to bid",
        items: [
          "Get the full plans, specifications and every addendum from the official source",
          "Register as a plan holder if the buyer requires it to bid",
          "Check prequalification or license requirements (some agencies prequalify contractors)",
          "Attend the pre-bid meeting and site visit; note anything that differs from the plans",
          "Send questions in writing before the question deadline",
          "Line up subcontractor and supplier quotes early",
        ],
      },
      {
        heading: "Documents to gather",
        items: [
          "Contractor license for the work and the dollar size of the job",
          "Bid bond, often 5% or 10% of the bid as the solicitation states",
          "Confirm you can get payment and performance bonds if you win (often required on public jobs)",
          "Certificate of insurance at the limits stated",
          "Subcontractor list and DBE/MBE/WBE forms, if the bid asks for them",
          "SAM.gov registration, if the job is federally funded",
          "Signed bid form, non-collusion affidavit and any certifications in the package",
        ],
      },
      {
        heading: "Pricing",
        items: [
          "Fill in every bid item and unit price; check extensions and the total",
          "Use the correct wage rates (prevailing wage or Davis-Bacon if the job requires them)",
          "Include bonds, insurance, mobilization, traffic control and testing",
          "Check the schedule and liquidated damages before you commit to a price",
        ],
      },
      COMMON_SUBMIT,
      COMMON_AFTER,
    ],
  },
  {
    slug: "security-guard-services-bid",
    title: "Security Guard Services Bid Checklist",
    blurb: "Armed and unarmed guard, patrol and event security bids.",
    trade: "security guard",
    tradeLabel: "security guard",
    sections: [
      {
        heading: "Before you decide to bid",
        items: [
          "Read the post orders: every post, its hours and armed or unarmed",
          "Add up total guard hours per week, including holidays and relief",
          "Check the state license your company and each guard must hold",
          "Note training, uniform, vehicle and reporting requirements",
          "Attend the site visit if offered",
        ],
      },
      {
        heading: "Documents to gather",
        items: [
          "Company security license and license numbers for supervisors",
          "Certificate of insurance at the limits stated (general liability, auto, workers' comp)",
          "W-9 and vendor registration with the buyer",
          "References from similar guard contracts",
          "Staffing, supervision and training plan",
          "Signed bid forms and addendum acknowledgments",
        ],
      },
      {
        heading: "Pricing",
        items: [
          "Price the hourly bill rate the sheet asks for, by post or guard type",
          "Build in payroll taxes, insurance, training, uniforms and overtime",
          "Check whether a wage determination or living wage rule sets the minimum pay",
        ],
      },
      COMMON_SUBMIT,
      COMMON_AFTER,
    ],
  },
  {
    slug: "snow-and-ice-removal-bid",
    title: "Snow & Ice Removal Bid Checklist",
    blurb: "Plowing, salting and sidewalk clearing bids for public lots, roads and buildings.",
    trade: "snow removal",
    tradeLabel: "snow removal",
    sections: [
      {
        heading: "Before you decide to bid",
        items: [
          "List every lot, road or sidewalk with its size and priority order",
          "Note the trigger (inches of snow), response time and how long you have to finish",
          "Check who supplies salt or deicer and where you may stockpile",
          "Confirm how you are paid: per push, per event, per hour or seasonal",
          "Make sure your trucks and crew can cover every site in the same storm",
        ],
      },
      {
        heading: "Documents to gather",
        items: [
          "Certificate of insurance at the limits stated, including auto",
          "Equipment list with plow and spreader details, if the bid asks",
          "W-9 and vendor registration with the buyer",
          "References from other snow contracts",
          "Signed bid forms and addendum acknowledgments",
        ],
      },
      {
        heading: "Pricing",
        items: [
          "Price exactly the unit the sheet uses (per push, per hour, per ton of salt)",
          "Include standby, fuel, overnight labor and equipment wear",
          "Plan for a heavy season, not an average one",
        ],
      },
      COMMON_SUBMIT,
      COMMON_AFTER,
    ],
  },
  {
    slug: "hvac-maintenance-services-bid",
    title: "HVAC Maintenance Services Bid Checklist",
    blurb: "Preventive maintenance and repair contracts for public buildings.",
    trade: "hvac",
    tradeLabel: "HVAC",
    sections: [
      {
        heading: "Before you decide to bid",
        items: [
          "Get the equipment list: units, make, model, tonnage and location",
          "Note the preventive maintenance visits per year and what each must include",
          "Check emergency response time and after-hours coverage",
          "Walk the buildings if a site visit is offered; check equipment age and condition",
          "Check which licenses your techs need (state HVAC license, EPA refrigerant certification)",
        ],
      },
      {
        heading: "Documents to gather",
        items: [
          "Mechanical or HVAC contractor license as the state requires",
          "Certificate of insurance at the limits stated",
          "W-9 and vendor registration with the buyer",
          "References from similar maintenance contracts",
          "Technician certifications, if the bid asks for them",
          "Signed bid forms and addendum acknowledgments",
        ],
      },
      {
        heading: "Pricing",
        items: [
          "Price preventive maintenance per visit or per year, as the sheet asks",
          "Give hourly repair rates (regular and overtime) and parts markup if asked",
          "Include filters, belts and refrigerant only where the scope says you supply them",
          "Check whether prevailing wage applies to repair work",
        ],
      },
      COMMON_SUBMIT,
      COMMON_AFTER,
    ],
  },
];

export function checklistBySlug(slug: string): BidChecklist | null {
  return BID_CHECKLISTS.find((c) => c.slug === slug) ?? null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A standalone one-page HTML file of the checklist, for the Download button. PURE. */
export function checklistHtml(c: BidChecklist): string {
  const sections = c.sections
    .map(
      (s) =>
        `<h2>${esc(s.heading)}</h2><ul>${s.items.map((i) => `<li><span class="box"></span>${esc(i)}</li>`).join("")}</ul>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)} | Contrax</title>
<style>
@page{size:letter;margin:0.5in}
body{font:11px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;margin:0;padding:16px;max-width:7.5in}
h1{font-size:18px;margin:0 0 2px}
.sub{color:#475569;margin:0 0 6px}
.fields{display:flex;gap:16px;margin:6px 0 4px;color:#334155}
.fields span{flex:1;border-bottom:1px solid #94a3b8;padding-bottom:2px}
.cols{columns:2;column-gap:20px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#1e3a8a;margin:8px 0 3px;break-after:avoid}
ul{list-style:none;margin:0;padding:0}
li{display:flex;gap:6px;margin:0 0 3px;break-inside:avoid}
.box{flex:0 0 10px;height:10px;border:1.2px solid #334155;border-radius:2px;margin-top:1px}
.foot{margin-top:8px;padding-top:6px;border-top:1px solid #cbd5e1;color:#64748b;font-size:9.5px}
</style></head><body>
<h1>${esc(c.title)}</h1>
<p class="sub">${esc(c.blurb)}</p>
<div class="fields"><span>Bid / IFB #</span><span>Buyer</span><span>Due date &amp; time</span></div>
<div class="cols">${sections}</div>
<p class="foot">A general checklist of what public buyers commonly ask for. The solicitation and its addenda are the rules for each bid: follow them where they differ. Find open ${esc(c.tradeLabel)} bids at contrax.company/radar.</p>
</body></html>`;
}
