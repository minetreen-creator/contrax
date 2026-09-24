export interface ConversionOpportunity {
  reasons: { points: number; reason: string }[];
  best_next: string;
  obstacle: string;
  cta: string;
  channel: "outreach" | "onsite";
}

export interface ConversionOpportunitySignals {
  signedUp: boolean;
  signupStarted: boolean;
  radarCompleted: boolean;
  pricingViewed: boolean;
  savedBid: boolean;
  incumbentViewed: boolean;
  briefViewed: boolean;
  autopsyAwardFound: boolean;
  autopsyReportViewed: boolean;
  emailKnown: boolean;
  reasons: { points: number; reason: string }[];
}

/** Pure contactability-aware guidance for the owner dashboard. */
export function buildConversionOpportunity(o: ConversionOpportunitySignals): ConversionOpportunity {
  let best_next: string;
  let obstacle: string;
  let cta: string;
  const channel: ConversionOpportunity["channel"] = o.emailKnown ? "outreach" : "onsite";

  if (!o.emailKnown && o.signupStarted && !o.signedUp) {
    best_next = "Show a continue-signup prompt when they return — no contact information is available.";
    obstacle = "Anonymous abandoned signup — outreach is not possible.";
    cta = "Continue your free account setup";
  } else if (!o.emailKnown && !o.signedUp) {
    best_next = "Use an on-site free-account prompt — this visitor cannot be contacted directly.";
    obstacle = "Hasn't started signup.";
    cta = "Save these matches and get your next 3 →";
  } else if (o.signupStarted && !o.signedUp) {
    best_next = "Recover the abandoned signup — send one useful reminder.";
    obstacle = "Abandoned signup.";
    cta = "Continue your free account setup";
  } else if (o.signedUp && !o.radarCompleted) {
    best_next = "Activate product value: get them to complete a Radar scan / run an Award Autopsy.";
    obstacle = "Free account, not yet activated.";
    cta = "Run your first Executive Brief";
  } else if (o.radarCompleted && !o.emailKnown) {
    best_next = "Capture their email for match alerts (no account required).";
    obstacle = "Anonymous — no email captured.";
    cta = "Want new matches when we find them?";
  } else {
    best_next = "Re-engage with a relevant value message (new matching opportunities).";
    obstacle = "Needs a genuine commercial event.";
    cta = "Review your latest matches";
  }

  if (o.autopsyAwardFound || o.autopsyReportViewed) {
    best_next = o.emailKnown ? "Send one useful invitation to run a full Award Autopsy." : "Show an on-site invitation to run a full Award Autopsy.";
    obstacle = o.emailKnown ? "Autopsy interest, no account yet." : "Anonymous Autopsy interest — outreach is not possible.";
    cta = "Unlock your full free Award Autopsy";
  } else if (o.savedBid && !o.signedUp) {
    best_next = o.emailKnown ? "Send one useful reminder to create a free account and keep the saved match." : "Show an on-site free-account prompt so they can keep the saved match.";
    obstacle = "Saved a bid but no account to keep it.";
    cta = "Save your matches so they don't expire";
  } else if (o.incumbentViewed && !o.signedUp) {
    best_next = o.emailKnown ? "Send one useful invitation to save their matches and incumbent intelligence." : "Show an on-site free-account prompt to keep matches and incumbent intelligence.";
    obstacle = o.emailKnown ? "Viewed incumbent intel, no account yet." : "Anonymous incumbent viewer — outreach is not possible.";
    cta = "Create a free account to keep your matches";
  } else if (o.signedUp && (o.savedBid || o.briefViewed)) {
    best_next = "Suggest a Professional trial — saved bids + briefs both point to drafting.";
    obstacle = "Free account, seeing value but not yet upgraded.";
    cta = "Try Professional free for 14 days";
  } else if (o.pricingViewed && o.signedUp) {
    best_next = "Suggest a Professional trial — they already compared plans.";
    obstacle = "Free account, compared pricing, hasn't upgraded.";
    cta = "Try Professional free for 14 days";
  }
  return { reasons: o.reasons, best_next, obstacle, cta, channel };
}
