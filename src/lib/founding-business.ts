import { z } from "zod";

export const FOUNDING_BUSINESS_LIMIT = 10;
export const FOUNDING_BUSINESS_FIRST_YEAR_CENTS = 9900;
export const FOUNDING_BUSINESS_RENEWAL_CENTS = 19000;
export const FOUNDING_BUSINESS_TERMS =
  "$99 today for your first year of Starter. Renews at $190/year unless canceled before renewal. Your company feature lasts 12 months from publication and includes one Facebook spotlight. Promotion is not renewed automatically. No guaranteed traffic, leads, contracts or government endorsement.";
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (!value) return true;
    try {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Use a full https:// URL.");
export const foundingBusinessSchema = z.object({
  company: z.string().trim().min(2).max(100),
  services: z.string().trim().min(10).max(600),
  serviceArea: z.string().trim().min(2).max(200),
  website: httpsUrl.refine(Boolean, "A company website is required."),
  logoUrl: httpsUrl.default(""),
  consent: z.literal(true, {
    error:
      "Accept the offer terms and permission to publish your company details.",
  }),
});
export type FoundingBusinessProfile = z.infer<typeof foundingBusinessSchema>;
export type FoundingBusinessListing = {
  slot: number;
  company: string;
  services: string;
  serviceArea: string;
  website: string;
  logoUrl: string;
};
