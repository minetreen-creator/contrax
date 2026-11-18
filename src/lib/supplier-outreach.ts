/**
 * The supplier email (owner 2026-11-18: "now we have what it takes to pitch the higher plans" →
 * "do that"). Sent to businesses that sell to contractors: it opens with real rows from their own
 * state's public record and offers the weekly report free once. The price comes after they have
 * seen it. Every fact in the email is copied from the live sample (see ./supplier-report.server).
 * PURE: no database, no network.
 */
import { SUPPLIER_PRICE, SUPPLIER_TYPES, supplierDay, supplierMoney, type SupplierSample } from "./supplier-report";

export interface SupplierPitch {
  /** SUPPLIER_TYPES id. */
  type: string;
  open: number;
  closing: number;
  job: { title: string; agency: string; due: string } | null;
  award: { company: string; where: string; amount: number; what: string; contact: string | null } | null;
}

/** The pitch for one state, from its live sample; null when there is nothing real to say. */
export function supplierPitch(sample: SupplierSample | null, type: string): SupplierPitch | null {
  if (!sample || sample.open <= 0) return null;
  const j = sample.newJobs[0];
  const a = sample.awards[0];
  if (!j && !a) return null;
  return {
    type: SUPPLIER_TYPES.some((t) => t.id === type) ? type : "other",
    open: sample.open,
    closing: sample.closingSoon,
    job: j ? { title: j.title, agency: j.agency, due: j.due } : null,
    award: a ? { company: a.company, where: a.where, amount: a.amount, what: a.what, contact: a.contact } : null,
  };
}

export function packSupplierPitch(p: SupplierPitch): string {
  return JSON.stringify(p);
}

export function unpackSupplierPitch(raw: string | null | undefined): SupplierPitch | null {
  try {
    const p = JSON.parse(String(raw ?? "")) as SupplierPitch;
    return p && typeof p.open === "number" && typeof p.type === "string" ? p : null;
  } catch {
    return null;
  }
}

/** "Brantley Construction Services" from "Brantley Construction Services, LLC". */
function shortCompany(name: string): string {
  return name.replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LP|LLP|JV)\.?$/i, "").trim();
}

export function supplierPitchSubject(stateName: string, p: SupplierPitch): string {
  const money = p.award ? supplierMoney(p.award.amount) : "";
  if (p.award && money) return `${shortCompany(p.award.company)} just won ${money} of federal work in ${stateName}`.slice(0, 140);
  return `${p.open} public construction jobs are open in ${stateName} right now`;
}

/** The body lines above the signature block. `sampleLink` is the tracked link to /suppliers. */
export function supplierPitchBody(business: string, stateName: string, p: SupplierPitch | null, sampleLink: string): string[] {
  if (!p) {
    return ["Hi,", "", `We prepare a weekly list of the public construction jobs opening in ${stateName} for businesses that sell to contractors. This week's sample:`, sampleLink, "", "I'm Nathaniel, and I run Contrax."];
  }
  const why = SUPPLIER_TYPES.find((t) => t.id === p.type)?.why ?? "";
  const rows: string[] = [];
  if (p.job) rows.push(`- ${p.job.title}${p.job.agency ? `, ${p.job.agency}` : ""}, bids due ${supplierDay(p.job.due)}. Contractors are pricing it now.`);
  rows.push(`- ${p.open} public construction jobs are open in ${stateName}${p.closing > 0 ? `, and ${p.closing} of them close in the next 7 days` : ""}.`);
  if (p.award) {
    const money = supplierMoney(p.award.amount);
    rows.push(`- ${p.award.company}${p.award.where ? ` (${p.award.where})` : ""} was just awarded ${money} of federal work: ${p.award.what}.${p.award.contact ? ` The contact on file there is ${p.award.contact}.` : ""}`);
  }
  return [
    "Hi,",
    "",
    `${business} sells to contractors in ${stateName}, so this is for whoever runs sales.`,
    "",
    "Three things from this week's public records:",
    "",
    ...rows,
    "",
    "We put this together every week: the new jobs, what closes soon, who just won federal work with the company's address and named contact, and the federal contracts about to end.",
    ...(why ? ["", why] : []),
    "",
    `Reply "report" and I'll send you this week's ${stateName} report, free. This week's sample is here:`,
    sampleLink,
    "",
    `After the free one it is ${SUPPLIER_PRICE} a month, month to month, and only if you want it.`,
    "",
    "I'm Nathaniel, and I run Contrax.",
  ];
}
