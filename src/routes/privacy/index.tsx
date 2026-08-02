import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy/")({
  component: PrivacyPage,
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
            <p className="mt-3">For our Savings product, we collect bill images, receipt data, and pricing information you upload for analysis.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">2. How We Use Your Information</h2>
            <p className="mt-3">We use your information to: provide our services, match your business with government contracts, generate AI-powered summaries and proposals, analyze bills for savings, send notifications, and provide support.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">3. Data Storage and Security</h2>
            <p className="mt-3">Your data is stored on secure servers (Neon PostgreSQL, Vercel). We use industry-standard encryption. No method of electronic storage is 100% secure.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">4. Third-Party Services</h2>
            <p className="mt-3">We use Stripe (payments), OpenAI (AI processing), Resend (email), and Vercel (hosting). See their privacy policies for details.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">5. Cookies</h2>
            <p className="mt-3">We use essential cookies for login sessions. No advertising or tracking cookies.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">6. Your Rights</h2>
            <p className="mt-3">You may request access, correction, or deletion of your data at privacy@contrax.app. We will respond within 30 days.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">7. Changes</h2>
            <p className="mt-3">We may update this policy. Material changes will be notified via email or through the service.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">8. Contact</h2>
            <p className="mt-3">Questions? Contact <a href="mailto:privacy@contrax.app" className="text-blue-600 hover:text-blue-500">privacy@contrax.app</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
