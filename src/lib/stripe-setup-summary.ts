/**
 * What the daily Stripe check keeps (owner 2026-11-22, "You can handle stripe"): only whether each
 * piece a monthly plan needs is in place. No ids, addresses or keys, so it is safe to print in a
 * public log. PURE.
 */
export interface StripeSetupSummary {
  keyMode: string;
  webhookSecretSet: boolean;
  /** How many of our webhook endpoints Stripe has, how many are switched on, and events still missing. */
  endpoints: number;
  endpointsEnabled: number;
  missingEvents: string[];
  /** The page where a subscriber cancels or changes their card. */
  portalReady: boolean;
  /** True when everything a renewing plan needs is there. */
  ok: boolean;
}

export function stripeSetupSummary(status: {
  keyMode: string;
  webhookSecretSet: boolean;
  endpoints: Array<{ status?: string | null; missing: string[] }>;
  portal: { ready: boolean };
}): StripeSetupSummary {
  const enabled = status.endpoints.filter((e) => e.status === "enabled");
  const missingEvents = [...new Set(status.endpoints.flatMap((e) => e.missing))].sort();
  return {
    keyMode: String(status.keyMode),
    webhookSecretSet: status.webhookSecretSet,
    endpoints: status.endpoints.length,
    endpointsEnabled: enabled.length,
    missingEvents,
    portalReady: status.portal.ready,
    ok: status.keyMode === "live" && status.webhookSecretSet && enabled.length > 0 && missingEvents.length === 0 && status.portal.ready,
  };
}
