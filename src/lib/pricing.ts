/** Competitive Pricing Engine types. */
export interface PricingRecommendation {
  bid_id: string;
  bid_title: string;
  suggested_low: number;
  suggested_high: number;
  suggested_median: number;
  confidence: number;
  comparable_awards: { title: string; agency: string; amount: string; year: string }[];
  rationale: string;
  pricing_strategy: "aggressive" | "competitive" | "safe";
  created_at: string;
}

