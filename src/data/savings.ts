// Mock data for Price Doctor / Savings section

export const stats = [
  { icon: "Users", label: "12,400+", suffix: "bills analyzed" },
  { icon: "TrendingDown", label: "Average savings:", suffix: "$487/year" },
  { icon: "Star", label: "4.9", suffix: "/ 5" },
];

export const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

export interface Feature {
  icon: string;
  title: string;
  desc: string;
  badge: string;
  badgeRight: string;
  body: string;
  footer: string;
}

export const features: Feature[] = [
  {
    icon: "MessageSquareText",
    title: "AI Negotiation Assistant",
    desc: "Get a personalized negotiation letter written for you. Just copy, paste, and send — we handle the awkward part.",
    badge: "NEGOTIATION LETTER",
    badgeRight: "READY TO SEND",
    body: '"I\'ve been a customer for 5 years. Similar plans are $60/month..."',
    footer: "Avg. saves $240/year",
  },
  {
    icon: "ShoppingBag",
    title: "Shopping Doctor",
    desc: "Before you buy, paste a link or product name. We check if it's the best price, if it's dropped before, and if better alternatives exist.",
    badge: "PRICE CHECK",
    badgeRight: "BETTER DEAL FOUND",
    body: "Same item available $47 cheaper at 2 other retailers",
    footer: "Save $47 today",
  },
  {
    icon: "ClipboardList",
    title: "Savings Prescription",
    desc: "We don't just flag the problem — we give you a step-by-step action plan to fix it, including exact scripts to use.",
    badge: "PRESCRIPTION",
    badgeRight: "3 STEPS",
    body: "Call provider · Request loyalty discount · Compare alternatives",
    footer: "$720/year if followed",
  },
  {
    icon: "Stethoscope",
    title: "Price Checkup",
    desc: "Upload any bill, quote, or receipt and get an instant market comparison. We tell you if you're overpaying and by how much.",
    badge: "DIAGNOSIS",
    badgeRight: "OVERPAYING",
    body: "Car repair estimate is 28% above typical market rate",
    footer: "$420 potential savings",
  },
];

export interface Step {
  icon: string;
  title: string;
  desc: string;
}

export const steps: Step[] = [
  {
    icon: "Upload",
    title: "Upload",
    desc: "Snap a photo or upload your bill, quote, receipt, or subscription. We accept PDFs, images, and links.",
  },
  {
    icon: "Search",
    title: "Diagnose",
    desc: "Our AI compares your price against thousands of real market data points and identifies overcharges instantly.",
  },
  {
    icon: "BadgeCheck",
    title: "Save",
    desc: "Get your savings prescription — a clear action plan with scripts, alternatives, and negotiation letters ready to use.",
  },
];

export interface Testimonial {
  quote: string;
  name: string;
  city: string;
  savings: string;
}

export const testimonials: Testimonial[] = [
  {
    quote:
      '"I uploaded my cable bill and Price Doctor found I was paying for three channels I hadn\'t watched in two years. Called the provider with their script and saved $840 this year."',
    name: "Sarah M.",
    city: "Austin, TX",
    savings: "$840 saved",
  },
  {
    quote:
      '"Got a contractor quote for my bathroom renovation. Price Doctor flagged it as 31% above market and gave me a counter-offer script. Final price came in $1,900 lower."',
    name: "James R.",
    city: "Chicago, IL",
    savings: "$1,900 saved",
  },
  {
    quote:
      '"Found I was overpaying $200/year on car insurance. The comparison took 30 seconds. Switched providers the same day using their recommendation."',
    name: "Priya K.",
    city: "Seattle, WA",
    savings: "$200/year saved",
  },
];

export interface PricingFeature {
  text: string;
  included: boolean;
}

export interface PricingPlan {
  name: string;
  tagline: string;
  price: string;
  period: string;
  cta: string;
  popular: boolean;
  stripeLink?: string;
  features: PricingFeature[];
}

export const pricingPlans: PricingPlan[] = [
  {
    name: "Free",
    tagline: "Perfect for trying it out",
    price: "$0",
    period: "/forever",
    cta: "Get Started Free",
    popular: false,
    features: [
      { text: "2 price checks per month", included: true },
      { text: "Basic diagnosis report", included: true },
      { text: "Market comparison", included: true },
      { text: "Email support", included: true },
      { text: "No bill monitoring", included: false },
      { text: "No negotiation letters", included: false },
      { text: "No price alerts", included: false },
    ],
  },
  {
    name: "Premium",
    tagline: "For serious savers",
    price: "$9.99",
    period: "/per month",
    cta: "Start Premium Free",
    popular: true,
    stripeLink: "https://buy.stripe.com/9B614p3TpdvSfAEdD2f7i06",
    features: [
      { text: "Unlimited price checks", included: true },
      { text: "Contractor quote analysis (HVAC, roofing, plumbing & more)", included: true },
      { text: "Location-aware comparisons for your state", included: true },
      { text: "Full savings prescription", included: true },
      { text: "AI negotiation letters", included: true },
      { text: "Bill monitoring & alerts", included: true },
      { text: "Price drop notifications", included: true },
      { text: "Shopping price comparisons", included: true },
      { text: "Receipt scanning & analysis", included: true },
      { text: "Price tracking over time", included: true },
      { text: "Family accounts (up to 5)", included: true },
      { text: "Priority support", included: true },
    ],
  },
];

export interface Diagnosis {
  type: string;
  status: string;
  detail: string;
  savings: string;
  steps: string[];
}

export const sampleDiagnosis: Diagnosis = {
  type: "Internet Bill — Comcast",
  status: "Overpaying",
  detail: "Your plan is 34% above market rate for comparable speeds in your area.",
  savings: "$360/year",
  steps: ["Call provider", "Request loyalty discount", "Compare alternatives"],
};

export const mockDiagnoses: Diagnosis[] = [
  {
    type: "Internet Bill — Comcast",
    status: "Overpaying",
    detail: "Your plan is 34% above market rate for comparable speeds in your area.",
    savings: "$360/year",
    steps: ["Call provider", "Request loyalty discount", "Compare alternatives"],
  },
  {
    type: "Auto Insurance — State Farm",
    status: "Overpaying",
    detail: "Similar coverage available for 22% less from top-rated insurers in your state.",
    savings: "$240/year",
    steps: ["Get 3 quotes", "Bundle home & auto", "Ask about safe-driver discount"],
  },
  {
    type: "Contractor Quote — Bathroom Reno",
    status: "Overpaying",
    detail: "Quote is 31% above typical market rate for comparable scope in your zip.",
    savings: "$1,900",
    steps: ["Request itemized breakdown", "Get 2 more bids", "Counter with market rate"],
  },
];
