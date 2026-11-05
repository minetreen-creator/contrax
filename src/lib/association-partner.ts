/**
 * Association Partner plan (owner 2026-11-05: "We need a checkout option for
 * that $149/month"). An association pays $149 a month and Contrax prepares its
 * weekly, ready-to-send bid list for members (src/lib/association-digest.ts).
 *
 * PURE: the price, the product line tag and the sign-up form rules.
 */
export const PARTNER_PRODUCT = "association_partner";
export const PARTNER_CENTS = 14_900;
export const PARTNER_PRODUCT_NAME = "Contrax Association Partner — weekly member bid list";
export const PARTNER_PRODUCT_DESCRIPTION =
  "Every week: a ready-to-send list of open public bids for your region, sorted by trade, with due dates and links, under your association's name. Cancel anytime.";

export interface PartnerForm {
  organization: string;
  contactName: string;
  email: string;
  region: string;
  website: string;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validate the /associations sign-up form. PURE. */
export function validatePartnerForm(body: unknown): { ok: true; value: PartnerForm } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  // A filled hidden field is a bot.
  if (clean(b.company_site, 200)) return { ok: false, error: "Something went wrong. Please try again." };
  const organization = clean(b.organization, 160);
  const contactName = clean(b.contactName, 120);
  const email = clean(b.email, 200).toLowerCase();
  const region = clean(b.region, 200);
  const website = clean(b.website, 200);
  if (organization.length < 2) return { ok: false, error: "Please enter your organization's name." };
  if (contactName.length < 2) return { ok: false, error: "Please enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Please enter a valid email address." };
  if (region.length < 2) return { ok: false, error: "Tell us the region your members work in (for example: Central Texas, or MD, DC and VA)." };
  return { ok: true, value: { organization, contactName, email, region, website } };
}

/** Stripe metadata (500 characters per value). PURE. */
export function partnerMetadata(f: PartnerForm): Record<string, string> {
  return {
    product: PARTNER_PRODUCT,
    organization: f.organization.slice(0, 160),
    contact_name: f.contactName.slice(0, 120),
    region: f.region.slice(0, 200),
    website: f.website.slice(0, 200),
  };
}

/** The owner's push when an association starts paying. PURE. */
export function partnerOwnerAlert(organization: string, email: string): { title: string; body: string; tag: string; url: string } {
  return {
    title: "💰 New Association Partner: $149/month",
    body: `${organization} (${email}) just subscribed. Send their first weekly bid list.`,
    tag: "association-partner",
    url: "/admin/command",
  };
}
