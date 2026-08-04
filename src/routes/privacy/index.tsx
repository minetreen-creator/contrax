import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy/")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy | Contrax" },
      {
        name: "description",
        content:
          "Learn how Contrax collects, uses, stores, and protects account, business, bid, and proposal information.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://contrax.company/privacy" },
      { property: "og:title", content: "Privacy Policy | Contrax" },
      {
        property: "og:description",
        content:
          "Learn how Contrax collects, uses, stores, and protects account, business, bid, and proposal information.",
      },
      { property: "og:image", content: "https://contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Privacy Policy | Contrax" },
      {
        name: "twitter:description",
        content:
          "Learn how Contrax collects, uses, stores, and protects account, business, bid, and proposal information.",
      },
      { name: "twitter:image", content: "https://contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company/privacy" }],
  }),
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: July 31, 2026</p>
        <div className="mt-10 space-y-8 text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-slate-900">1. Information We Collect</h2>
            <p className="mt-3">When you use Contrax, we collect information you provide directly: your name, email address, business details, and preferences when you create an account. We also collect information about your use of our services, including bid preferences, saved searches, and proposal activity.</p>
            <p className="mt-3">For our proposal and bid tools, we collect bid documents, solicitation text, and business information you provide for analysis and drafting.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">2. How We Use Your Information</h2>
            <p className="mt-3">We use your information to: provide our services, match your business with government contracts, generate plain-English summaries and proposals, score win probability, track certification deadlines, send notifications, and provide support.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">3. Data Storage and Security</h2>
            <p className="mt-3">Your data is stored on secure servers (Neon PostgreSQL, Vercel). We use industry-standard encryption. No method of electronic storage is 100% secure.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">4. Security</h2>
            <p className="mt-3">We protect personal and business information using administrative, technical, and physical safeguards appropriate to the nature of the data. Data is encrypted in transit using HTTPS/TLS, and our database and hosted application environments use encryption at rest provided by our infrastructure providers.</p>
            <p className="mt-3">Access to production systems is restricted to authorized personnel and services, with credentials managed through secure, access-controlled systems. We retain information only as long as needed to provide the service, meet legal obligations, resolve disputes, and enforce agreements. No method of electronic transmission or storage is completely secure, so we cannot guarantee absolute security.</p>
            <p className="mt-3">Contrax is hosted on Vercel and stores application data in Neon PostgreSQL. AI processing is provided by OpenAI; we send only the information needed for the requested feature and rely on our providers’ security controls. If we learn of a security incident affecting your information, we will provide notice as required by applicable law.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">5. Third-Party Services</h2>
            <p className="mt-3">We use Stripe (payments), OpenAI (AI processing), Resend (email), and Vercel (hosting). See their privacy policies for details.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">6. AI Data Handling</h2>
            <p className="mt-3">Contrax uses OpenAI (gpt-4o-mini and text-embedding-3-small) to power several features. Here&rsquo;s exactly what happens with your data when you use them:</p>
            <ul className="mt-3 space-y-3 list-disc list-inside text-slate-700">
              <li><strong>AI Copilot &amp; Proposal Drafting.</strong> The text you enter to draft proposals, analyze bids, or generate content is sent to OpenAI for processing. OpenAI does not use API-submitted data to train or improve their models. See <a href="https://openai.com/enterprise-privacy" className="text-blue-600 hover:text-blue-500" target="_blank" rel="noopener">OpenAI&rsquo;s enterprise privacy policy</a>.</li>
              <li><strong>AI Chat Support.</strong> Messages you send through the floating chat widget are processed by OpenAI to generate responses. Chat history is stored only in your browser session and is cleared when you close the page. Contrax does not store chat transcripts.</li>
              <li><strong>Win Probability Scoring.</strong> Bid details (title, agency, category, description) are sent to OpenAI to assess win likelihood. Scores and analysis are stored in our database so you can review them later.</li>
              <li><strong>Bid Summaries.</strong> Bid document text is sent to OpenAI for summarization. Summaries are stored in our database for your reference.</li>
            </ul>
            <p className="mt-3">We send only the minimum data needed for each feature. We do not send your account credentials, payment information, or full business profile to AI providers. All AI API calls use HTTPS encryption in transit.</p>
            <p className="mt-3">You can request deletion of your AI-generated content at any time by contacting us. We do not use your bid data or proposals to train AI models, build competing products, or share with third parties beyond our service providers.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">7. Cookies</h2>
            <p className="mt-3">We use essential cookies for login sessions. No advertising or tracking cookies.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">8. Your Rights</h2>
            <p className="mt-3">You may request access, correction, or deletion of your data at privacy@contrax.company. We will respond within 30 days.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">9. Changes</h2>
            <p className="mt-3">We may update this policy. Material changes will be notified via email or through the service.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">10. Contact</h2>
            <p className="mt-3">Questions? Contact <a href="mailto:privacy@contrax.company" className="text-blue-600 hover:text-blue-500">privacy@contrax.company</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
