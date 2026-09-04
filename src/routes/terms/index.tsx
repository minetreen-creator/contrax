import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms/")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms of Service | Contrax" },
      {
        name: "description",
        content:
          "Read Contrax's Terms of Service covering accounts, billing, AI-generated content, acceptable use, and your responsibilities.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/terms" },
      { property: "og:title", content: "Terms of Service | Contrax" },
      {
        property: "og:description",
        content:
          "Read Contrax's Terms of Service covering accounts, billing, AI-generated content, acceptable use, and your responsibilities.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Terms of Service | Contrax" },
      {
        name: "twitter:description",
        content:
          "Read Contrax's Terms of Service covering accounts, billing, AI-generated content, acceptable use, and your responsibilities.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/terms" }],
  }),
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: July 31, 2026</p>
        <div className="mt-10 space-y-8 text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-slate-900">1. Acceptance of Terms</h2>
            <p className="mt-3">By accessing or using Contrax ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service. We may update these terms at any time; continued use after changes constitutes acceptance.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">2. Description of Service</h2>
            <p className="mt-3">Contrax is a service that helps small businesses discover, understand, and respond to government contract opportunities with AI-powered tools. Tell Contrax what your business does and Radar finds the opportunities that match.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">3. Accounts and Billing</h2>
            <p className="mt-3">You must create an account to access paid features. All fees are billed in advance on a monthly basis via Stripe. You may cancel at any time; cancellation takes effect at the end of the current billing period. No refunds for partial months.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">4. Acceptable Use</h2>
            <p className="mt-3">You agree not to use the Service for any unlawful purpose, submit false information, circumvent security features, resell or scrape the Service, submit fraudulent bids, or upload malicious code.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">5. AI-Generated Content</h2>
            <p className="mt-3">AI-generated content (summaries, proposals, recommendations) is provided as a starting point. Review and verify all AI output before use. We make no guarantees about accuracy or suitability. You are responsible for final content you submit using our tools.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">6. Intellectual Property</h2>
            <p className="mt-3">The Contrax platform (code, design, logos) is owned by Contrax. You retain ownership of content you create using the Service. By using the Service, you grant us a limited license to process your content solely to provide the Service.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">7. Third-Party Services</h2>
            <p className="mt-3">The Service integrates with government procurement databases, Stripe, OpenAI, and other third-party services. We are not responsible for their availability, accuracy, or content.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">8. Limitation of Liability</h2>
            <p className="mt-3">To the fullest extent permitted by law, Contrax shall not be liable for any indirect, incidental, or consequential damages. Our total liability is limited to amounts you paid us in the 12 months preceding the claim. The Service is provided "as is."</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">9. Termination</h2>
            <p className="mt-3">We may suspend or terminate access for violation of these terms. Data is retained for 30 days after termination for export upon request.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">10. Governing Law</h2>
            <p className="mt-3">These terms are governed by United States law. Disputes shall be resolved through binding arbitration.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">11. Contact</h2>
            <p className="mt-3">For questions, contact <a href="mailto:legal@contrax.company" className="text-blue-600 hover:text-blue-500">legal@contrax.company</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
