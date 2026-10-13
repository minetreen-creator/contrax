import { z } from "zod";
import { BID_FIT_STATUSES } from "./bid-fit-review.server";

// Postgres BIGSERIAL values can be serialized as decimal strings by Neon.
// Accept only positive, safely representable IDs, not arbitrary coercions.
export const reviewAdminUpdateSchema = z.object({
  id: z.union([
    z.number(),
    z.string().regex(/^[1-9]\d*$/).transform(Number),
  ]).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
  status: z.enum(BID_FIT_STATUSES).optional(),
  action: z.enum(["accept", "checkout", "access", "delete"]).optional(),
});
