import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  Users,
  TrendingDown,
  Star,
  Sparkles,
  CheckCircle2,
  Activity,
  MessageSquareText,
  ShoppingBag,
  ClipboardList,
  Stethoscope,
  Upload,
  Search,
  BadgeCheck,
  Check,
  X,
  Menu,
  LayoutDashboard,
} from "lucide-react";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import {
  features,
  steps,
  testimonials,
  pricingPlans,
  sampleDiagnosis,
} from "~/data/savings";
import { redirectToCheckout } from "~/lib/checkout";

export const Route = createFileRoute("/savings/")({
  loader: () => getCurrentUser(),
  component: SavingsHome,
});

// ── Icon map ────────────────────────────────────────────────────────────────────

const featureIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  MessageSquareText,
  ShoppingBag,
  ClipboardList,
  Stethoscope,
};

const stepIconMap: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  Upload,
  Search,
  BadgeCheck,
};

// ── Page ────────────────────────────────────────────────────────────────────────

function SavingsHome() {
  const currentUser = Route.useLoaderData() as AuthUser | null;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F7F1E1] text-[#26251f] font-sans">
      <SavingsNavbar currentUser={currentUser} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <TestimonialsSection />
      <PricingSection />
      <CTASection />
      <SavingsFooter />
    </div>
  );
}

// ── Navbar ──────────────────────────────────────────────────────────────────────

function SavingsNavbar({
  currentUser,
  mobileOpen,
  setMobileOpen,
}: {
  currentUser: AuthUser | null;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}) {
  return (
    <header className="sticky top-0 z-40 w-full bg-[#F7F1E1]/90 backdrop-blur-md border-b border-[#E5DDC8]">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <a href="/savings" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6C8A55]">
            <Stethoscope className="h-5 w-5 text-white" />
          </span>
          <span className="text-xl font-bold tracking-tight text-[#26251f] font-serif">Contrax Savings</span>
        </a>

        <nav className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-[15px] text-[#3b3a35] hover:text-[#4F6142] transition-colors">
            Features
          </a>
          <a href="#how-it-works" className="text-[15px] text-[#3b3a35] hover:text-[#4F6142] transition-colors">
            How It Works
          </a>
          <a href="#pricing" className="text-[15px] text-[#3b3a35] hover:text-[#4F6142] transition-colors">
            Pricing
          </a>
        </nav>

        <div className="hidden md:flex items-center gap-5">
          {currentUser ? (
            <Link
              to="/savings/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-[#6C8A55] hover:bg-[#5c7848] text-white text-[14px] font-medium px-5 py-2.5 transition-all shadow-sm hover:shadow-md"
            >
              <LayoutDashboard className="h-4 w-4" />
              My Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="text-[14px] text-[#3b3a35] hover:text-[#4F6142] transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/savings/checkup"
                className="inline-flex items-center rounded-full bg-[#6C8A55] hover:bg-[#5c7848] text-white text-[14px] font-medium px-5 py-2.5 transition-all shadow-sm hover:shadow-md"
              >
                Get Started Free
              </Link>
            </>
          )}
        </div>

        <button
          className="md:hidden text-[#2b2b28]"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[#F7F1E1] border-t border-[#E5DDC8] px-6 py-4 space-y-3">
          <a href="#features" onClick={() => setMobileOpen(false)} className="block text-[#3b3a35]">
            Features
          </a>
          <a href="#how-it-works" onClick={() => setMobileOpen(false)} className="block text-[#3b3a35]">
            How It Works
          </a>
          <a href="#pricing" onClick={() => setMobileOpen(false)} className="block text-[#3b3a35]">
            Pricing
          </a>
          {currentUser ? (
            <Link
              to="/savings/dashboard"
              onClick={() => setMobileOpen(false)}
              className="inline-flex items-center gap-2 rounded-full bg-[#6C8A55] text-white font-medium px-5 py-2.5"
            >
              <LayoutDashboard className="h-4 w-4" />
              My Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="block text-[#3b3a35]"
              >
                Sign In
              </Link>
              <Link
                to="/savings/checkup"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center rounded-full bg-[#6C8A55] text-white font-medium px-5 py-2.5"
              >
                Get Started Free
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute -left-40 -top-24 h-[380px] w-[380px] rounded-full bg-[#C7D1B0]/50 blur-2xl" />
        <div className="absolute right-[-160px] top-16 h-[520px] w-[520px] rounded-full bg-[#EAE0C4]/70" />
        <div className="absolute left-1/2 top-24 h-24 w-24 rounded-full bg-[#D8CDA8]/60" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 lg:px-10 pt-14 pb-24 lg:pt-24 lg:pb-32">
        {/* stats row */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-[14px] text-[#3b3a35] mb-8">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#4F6142]" />
            <span className="font-semibold text-[#2b2b28]">12,400+</span>
            <span className="text-[#6b6a63]">bills analyzed</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-[#4F6142]" />
            <span className="text-[#6b6a63]">Average savings:</span>
            <span className="font-semibold text-[#2b2b28]">$487/year</span>
          </div>
          <div className="flex items-center gap-1">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="h-4 w-4 fill-[#E8B44A] text-[#E8B44A]" />
            ))}
            <span className="ml-1 font-semibold text-[#2b2b28]">4.9</span>
            <span className="text-[#6b6a63]">/ 5</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/70 border border-[#E5DDC8] px-3.5 py-1.5 text-[13px] text-[#4F6142] mb-6">
              <Sparkles className="h-3.5 w-3.5" />
              AI-powered price diagnosis
            </div>
            <h1 className="font-serif text-[44px] sm:text-[52px] lg:text-[64px] leading-[1.05] tracking-tight text-[#26251f]">
              The average person overpays{" "}
              <span className="text-[#6C8A55] italic font-medium">$487 a year.</span>{" "}
              Are you one of them?
            </h1>
            <p className="mt-6 text-[17px] leading-relaxed text-[#5c5b53] max-w-xl">
              Upload any bill, quote, or receipt. Contrax Savings AI compares it against live market
              rates and tells you exactly what you should be paying — in under 60 seconds.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Link
                to="/savings/checkup"
                className="group inline-flex items-center gap-2 rounded-full bg-[#6C8A55] hover:bg-[#5c7848] text-white font-medium px-6 py-3.5 shadow-sm hover:shadow-md transition-all"
              >
                Find Out Now — It's Free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <p className="text-[13.5px] text-[#6b6a63]">
                No credit card required · 2 free checks/month
              </p>
            </div>
          </div>

          {/* Diagnosis card */}
          <div className="relative">
            <div className="absolute -top-6 -left-6 h-24 w-24 rounded-full bg-[#C7D1B0]/60 blur-md" />
            <div className="absolute -bottom-8 right-4 h-20 w-20 rounded-full bg-[#EAE0C4]/80 blur-sm" />
            <div className="relative bg-white/70 backdrop-blur-sm rounded-3xl p-6 lg:p-8 border border-[#E7DFC9] shadow-[0_18px_50px_-20px_rgba(76,84,58,0.25)]">
              <div className="bg-white rounded-2xl p-6 border border-[#EBE3CE]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-[#8FA57A]/20 border border-[#8FA57A]/30 flex items-center justify-center">
                      <Activity className="h-4 w-4 text-[#4F6142]" />
                    </div>
                    <span className="text-[11px] tracking-[0.14em] font-semibold text-[#6b6a63]">
                      DIAGNOSIS
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#F7D6D0] text-[#B44536]">
                    {sampleDiagnosis.status}
                  </span>
                </div>
                <h3 className="font-serif text-xl text-[#26251f]">{sampleDiagnosis.type}</h3>
                <p className="mt-2 text-[14.5px] text-[#5c5b53] leading-relaxed">
                  {sampleDiagnosis.detail}
                </p>
                <div className="mt-5 rounded-xl bg-[#F4EED8] p-4">
                  <p className="text-[12px] text-[#6b6a63]">Estimated savings</p>
                  <p className="font-serif text-3xl text-[#6C8A55] mt-1">{sampleDiagnosis.savings}</p>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[13px] text-[#6b6a63]">
                  <CheckCircle2 className="h-4 w-4 text-[#6C8A55]" />
                  Diagnosis complete
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Features ────────────────────────────────────────────────────────────────────

function FeaturesSection() {
  return (
    <section id="features" className="relative py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="text-center mb-16">
          <p className="text-[13px] tracking-[0.16em] text-[#8B8A7F] uppercase mb-3">
            What Contrax Savings does
          </p>
          <h2 className="font-serif text-4xl lg:text-5xl text-[#26251f] tracking-tight">
            Four ways we help you save
          </h2>
          <p className="mt-4 text-[17px] text-[#6b6a63]">
            Upload anything. Get a diagnosis. Start saving.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          {features.map((f, i) => {
            const Icon = featureIconMap[f.icon];
            return (
              <div
                key={i}
                className="group relative bg-white/60 backdrop-blur-sm border border-[#EBE3CE] rounded-3xl p-7 lg:p-8 hover:bg-white hover:-translate-y-1 hover:shadow-[0_18px_40px_-20px_rgba(76,84,58,0.3)] transition-all duration-300"
              >
                <div className="flex items-start gap-4 mb-5">
                  <div className="h-12 w-12 rounded-2xl bg-[#8FA57A]/20 border border-[#8FA57A]/25 flex items-center justify-center text-[#4F6142] shrink-0">
                    {Icon && <Icon className="h-5 w-5" />}
                  </div>
                  <div>
                    <h3 className="font-serif text-2xl text-[#26251f]">{f.title}</h3>
                    <p className="mt-2 text-[15px] text-[#6b6a63] leading-relaxed">{f.desc}</p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl bg-[#F4EED8]/70 border border-[#E7DFC9] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10.5px] tracking-[0.16em] font-semibold text-[#6b6a63]">
                      {f.badge}
                    </span>
                    <span className="text-[10.5px] tracking-[0.14em] font-semibold px-2 py-1 rounded-full bg-white text-[#4F6142] border border-[#DDD3B6]">
                      {f.badgeRight}
                    </span>
                  </div>
                  <p className="text-[14.5px] text-[#3b3a35]">{f.body}</p>
                  <div className="mt-3 flex items-center gap-1.5 text-[13px] text-[#4F6142] font-medium">
                    <TrendingDown className="h-3.5 w-3.5" />
                    {f.footer}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── How It Works ────────────────────────────────────────────────────────────────

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative py-24 lg:py-28 overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-40 top-24 h-[440px] w-[440px] rounded-full bg-[#EAE0C4]/70" />
        <div className="absolute -left-20 bottom-10 h-40 w-40 rounded-full bg-[#C7D1B0]/40" />
      </div>
      <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
        <div className="text-center mb-16">
          <p className="text-[13px] tracking-[0.16em] text-[#8B8A7F] uppercase mb-3">Simple process</p>
          <h2 className="font-serif text-4xl lg:text-5xl text-[#26251f] tracking-tight">
            Three steps to savings
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-10 lg:gap-14">
          {steps.map((s, i) => {
            const Icon = stepIconMap[s.icon];
            return (
              <div key={i} className="text-center group">
                <div className="relative inline-flex">
                  <div className="absolute inset-0 rounded-full bg-[#C7D1B0]/40 blur-xl scale-125 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative h-20 w-20 rounded-full bg-[#8FA57A]/25 border border-[#8FA57A]/30 flex items-center justify-center text-[#4F6142] mx-auto mb-6 transition-transform group-hover:-translate-y-1">
                    {Icon && <Icon className="h-7 w-7" strokeWidth={1.75} />}
                  </div>
                </div>
                <div className="text-[13px] font-semibold text-[#4F6142] mb-2">{i + 1}</div>
                <h3 className="font-serif text-2xl text-[#26251f] mb-3">{s.title}</h3>
                <p className="text-[15px] text-[#6b6a63] leading-relaxed max-w-xs mx-auto">{s.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Testimonials ────────────────────────────────────────────────────────────────

function TestimonialsSection() {
  return (
    <section className="py-24 lg:py-28">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="text-center mb-14">
          <p className="text-[13px] tracking-[0.16em] text-[#8B8A7F] uppercase mb-3">Real savings</p>
          <h2 className="font-serif text-4xl lg:text-5xl text-[#26251f] tracking-tight">
            People are saving real money
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <div
              key={i}
              className="bg-white/70 border border-[#EBE3CE] rounded-2xl p-6 hover:bg-white hover:shadow-[0_18px_40px_-24px_rgba(76,84,58,0.28)] hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="flex items-center gap-0.5 mb-4">
                {[...Array(5)].map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-[#E8B44A] text-[#E8B44A]" />
                ))}
              </div>
              <p className="text-[15px] leading-relaxed text-[#3b3a35] mb-6">{t.quote}</p>
              <div className="pt-4 border-t border-[#EBE3CE] flex items-end justify-between">
                <div>
                  <p className="font-semibold text-[#26251f] text-[14px]">{t.name}</p>
                  <p className="text-[13px] text-[#8B8A7F]">{t.city}</p>
                </div>
                <span className="text-[12.5px] font-semibold px-2.5 py-1 rounded-full bg-[#EAF0DB] text-[#4F6142] border border-[#CFDBB2]">
                  {t.savings}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────────────────

function PricingSection() {
  return (
    <section id="pricing" className="relative py-24 lg:py-28">
      <div className="max-w-6xl mx-auto px-6 lg:px-10">
        <div className="text-center mb-14">
          <p className="text-[13px] tracking-[0.16em] text-[#8B8A7F] uppercase mb-3">Simple pricing</p>
          <h2 className="font-serif text-4xl lg:text-5xl text-[#26251f] tracking-tight">
            Start free. Save more with Premium.
          </h2>
          <p className="mt-4 text-[17px] text-[#6b6a63]">
            Most people save hundreds of dollars in their first month.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          {pricingPlans.map((p, i) => (
            <div
              key={i}
              className={`relative rounded-3xl p-8 lg:p-10 border transition-all duration-300 ${
                p.popular
                  ? "bg-white border-[#8FA57A]/50 shadow-[0_24px_60px_-30px_rgba(76,84,58,0.4)]"
                  : "bg-white/60 border-[#EBE3CE] hover:bg-white"
              }`}
            >
              {p.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[12px] font-semibold tracking-wide px-3 py-1 rounded-full bg-[#6C8A55] text-white">
                  Most Popular
                </span>
              )}
              <h3 className="font-serif text-3xl text-[#26251f]">{p.name}</h3>
              <p className="mt-1 text-[14.5px] text-[#8B8A7F]">{p.tagline}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="font-serif text-5xl text-[#26251f]">{p.price}</span>
                <span className="text-[14px] text-[#8B8A7F]">{p.period}</span>
              </div>

              <ul className="mt-8 space-y-3">
                {p.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-3">
                    {f.included ? (
                      <Check className="h-[18px] w-[18px] mt-0.5 text-[#6C8A55] shrink-0" />
                    ) : (
                      <X className="h-[18px] w-[18px] mt-0.5 text-[#C1B896] shrink-0" />
                    )}
                    <span
                      className={`text-[14.5px] ${
                        f.included ? "text-[#3b3a35]" : "text-[#9C9584] line-through"
                      }`}
                    >
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>

              {p.stripeLink ? (
                <button
                  type="button"
                  onClick={() => redirectToCheckout("savings_premium", p.stripeLink)}
                  className={`mt-8 group inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 font-medium transition-all bg-[#6C8A55] hover:bg-[#5c7848] text-white shadow-sm hover:shadow-md`}
                >
                  {p.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              ) : (
                <Link
                  to="/savings/checkup"
                  className={`mt-8 group inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 font-medium transition-all bg-white border border-[#DDD3B6] text-[#26251f] hover:border-[#8FA57A]/60`}
                >
                  {p.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CTA ─────────────────────────────────────────────────────────────────────────

function CTASection() {
  return (
    <section className="relative py-24 lg:py-28 overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-10 -translate-x-1/2 h-[520px] w-[820px] rounded-full bg-[#C7D1B0]/25 blur-2xl" />
      </div>
      <div className="relative max-w-5xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-serif text-4xl lg:text-5xl text-[#26251f] tracking-tight leading-[1.1]">
              Ready to stop overpaying?
            </h2>
            <p className="mt-5 text-[17px] text-[#6b6a63] leading-relaxed">
              Upload your first bill and get your diagnosis in under 60 seconds. It's free to start.
            </p>
            <Link
              to="/savings/checkup"
              className="mt-8 group inline-flex items-center gap-2 rounded-full bg-[#6C8A55] hover:bg-[#5c7848] text-white font-medium px-6 py-3.5 shadow-sm hover:shadow-md transition-all"
            >
              Get My Free Diagnosis
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <p className="mt-4 text-[13.5px] text-[#8B8A7F]">
              Join thousands of people saving money every month
            </p>
          </div>

          <div className="relative">
            <div className="rounded-3xl border-2 border-dashed border-[#C1B896] bg-white/60 backdrop-blur-sm p-10 text-center hover:border-[#8FA57A] hover:bg-white transition-colors duration-300">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-[#8FA57A]/20 border border-[#8FA57A]/30 flex items-center justify-center text-[#4F6142] mb-4">
                <Upload className="h-6 w-6" />
              </div>
              <h3 className="font-serif text-2xl text-[#26251f]">Drop your bill here</h3>
              <p className="mt-1 text-[14px] text-[#8B8A7F]">PDF, image, or paste a link</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[12.5px] text-[#6b6a63]">
                <span className="px-2.5 py-1 rounded-full bg-[#F4EED8] border border-[#E7DFC9]">Bills</span>
                <span className="px-2.5 py-1 rounded-full bg-[#F4EED8] border border-[#E7DFC9]">Quotes</span>
                <span className="px-2.5 py-1 rounded-full bg-[#F4EED8] border border-[#E7DFC9]">Receipts</span>
                <span className="px-2.5 py-1 rounded-full bg-[#F4EED8] border border-[#E7DFC9]">Subscriptions</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────────

function SavingsFooter() {
  return (
    <footer className="border-t border-[#E5DDC8] bg-[#F1E9D2]/70">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12">
        <div className="grid md:grid-cols-4 gap-10">
          <div className="md:col-span-2">
            <a href="/savings" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6C8A55]">
                <Stethoscope className="h-5 w-5 text-white" />
              </span>
              <span className="text-xl font-bold tracking-tight text-[#26251f] font-serif">Contrax Savings</span>
            </a>
            <p className="mt-4 text-[14.5px] text-[#6b6a63] max-w-sm leading-relaxed">
              Your AI-powered advisor that analyzes bills, quotes, and purchases — and tells you exactly how much you could save.
            </p>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#26251f] tracking-wide uppercase mb-3">Product</p>
            <ul className="space-y-2 text-[14.5px] text-[#6b6a63]">
              <li><a href="#features" className="hover:text-[#4F6142] transition-colors">Features</a></li>
              <li><a href="#how-it-works" className="hover:text-[#4F6142] transition-colors">How it works</a></li>
              <li><a href="#pricing" className="hover:text-[#4F6142] transition-colors">Pricing</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#26251f] tracking-wide uppercase mb-3">Company</p>
            <ul className="space-y-2 text-[14.5px] text-[#6b6a63]">
              <li><a href="#" className="hover:text-[#4F6142] transition-colors">About</a></li>
              <li><a href="#" className="hover:text-[#4F6142] transition-colors">Privacy</a></li>
              <li><a href="#" className="hover:text-[#4F6142] transition-colors">Terms</a></li>
              <li><a href="#" className="hover:text-[#4F6142] transition-colors">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-[#E5DDC8] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[13px] text-[#8B8A7F]">
          <p>© {new Date().getFullYear()} Contrax. All rights reserved.</p>
          <p>Stop overpaying. Get a second opinion.</p>
        </div>
      </div>
    </footer>
  );
}
