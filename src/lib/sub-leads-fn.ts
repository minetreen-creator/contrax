import { createServerFn } from "@tanstack/react-start";
import type { SubLead } from "~/lib/sub-leads";

/**
 * Recent out-of-state service awards for the Subcontracting leads list on the
 * /subcontracts pages (owner 2026-10-30: a Las Vegas visitor came back 21 times
 * to /subcontracts and /subcontracts-in/nevada). [] hides the list.
 */
export const getSubLeads = createServerFn({ method: "GET" }).handler(async (): Promise<SubLead[]> => {
  try {
    const { recentSubLeads } = await import("~/lib/award-leads.server");
    return await recentSubLeads(80);
  } catch {
    return [];
  }
});
