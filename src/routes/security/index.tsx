import { createFileRoute } from "@tanstack/react-router";

const PROD_URL = "https://www.contrax.company";
const TITLE = "Security at Contrax";
const DESC =
  "How Contrax protects your data: infrastructure on Vercel and Neon PostgreSQL, HTTPS/TLS encryption in transit, encryption at rest, restricted production access, data handling and retention, incident response, and our subprocessors.";

export const Route = createFileRoute("/security/")({
  component: SecurityPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/security` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: `${PROD_URL}/logo-square.png` },
      { name: "twitter:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/security` }],
  }),
});

function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="relative mx-auto max-w-7xl px-6 py-24 text-center sm:py-32">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-amber-400">
            Security
          </p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Security at{" "}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              Contrax
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100/80 sm:text-xl">
            Your bids, business data, and proposal work are business-critical.
            Here's exactly how we protect them — from infrastructure and
            encryption to access controls, data handling, and incident response.
          </p>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* Infrastructure */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">Infrastructure</h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Built on trusted, enterprise-grade providers
            </h3>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Contrax runs on leading cloud infrastructure. We deliberately keep
              our stack small and well-audited — every provider below is a major
              platform with SOC 2-type controls, published security documentation,
              and industry-standard compliance programs.
            </p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              {
                name: "Hosting — Vercel",
                detail: "The Contrax application is served from Vercel's global edge network. Vercel operates SOC 2 Type II–certified infrastructure, provides DDoS protection and WAF capabilities, and manages TLS certificates automatically.",
              },
              {
                name: "Database — Neon PostgreSQL",
                detail: "Application data lives in Neon's serverless Postgres. Data is stored in Neon's cloud, encrypted at rest, backed up, and protected by their access controls and security program.",
              },
              {
                name: "AI — OpenAI",
                detail: "AI features (summaries, scoring, proposal drafting) use OpenAI's API. We send only the information needed for the requested feature and rely on OpenAI's security, privacy, and data-use commitments for API traffic.",
              },
            ].map((item) => (
              <div key={item.name} className="rounded-2xl border border-gray-200/60 bg-gray-50 p-8">
                <h3 className="text-lg font-semibold text-slate-900">{item.name}</h3>
                <p className="mt-3 leading-relaxed text-gray-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Encryption */}
      <section className="bg-gray-50 py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">Encryption</h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Protected in transit and at rest
            </h3>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-900">In transit — HTTPS / TLS</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                All traffic to and from Contrax is encrypted with HTTPS using
                modern TLS. Every connection to our APIs, your dashboard, and our
                providers' services is protected against interception or
                tampering. We enforce secure connections end to end — the
                application, the database, and outbound AI and email calls all use
                TLS.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-900">At rest</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Data stored in our Neon PostgreSQL database is encrypted at rest
                using provider-managed encryption keys. Backups are encrypted as
                well. Your data is never stored in plaintext on disk anywhere in
                our stack.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Access controls */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">Access Controls</h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Least-privilege access to production
            </h3>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Access to production systems is restricted to the few people who
              genuinely need it, and every access path is credential-protected and
              auditable.
            </p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            {[
              {
                title: "Restricted production access",
                detail: "Only authorized personnel can reach production hosting, the database, and payment infrastructure. Access is granted on a least-privilege basis and reviewed as the team changes.",
              },
              {
                title: "Credential management",
                detail: "Production secrets — database URLs, API keys, payment keys, and sync tokens — are stored in environment variables and provider-managed secret stores. Secrets are never committed to source control, and credentials are rotated when needed.",
              },
              {
                title: "User authentication",
                detail: "Your account is protected by email/password authentication with session cookies. Within team workspaces, roles and permissions control what each member can view and do.",
              },
              {
                title: "Application security",
                detail: "Server functions validate all inputs, API endpoints are authenticated where required, and deployment is automated so code reaches production through a reviewable, reproducible build.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-gray-200/60 bg-gray-50 p-8">
                <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-gray-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data handling */}
      <section className="bg-gray-50 py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">Data Handling</h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Clear policies on storage, retention, and deletion
            </h3>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              {
                title: "What we store",
                detail: "Account and business profile data (name, email, business details, preferences), bid and opportunity data you interact with, AI-generated summaries and proposals, team activity, and payment records through Stripe. We do not sell your data and do not use advertising trackers.",
              },
              {
                title: "Retention",
                detail: "We retain data only as long as needed to provide the service, meet legal obligations, resolve disputes, and enforce agreements. Payment records are retained per Stripe's and applicable financial record-keeping requirements.",
              },
              {
                title: "Deletion",
                detail: "You can request deletion of your account and associated data at any time via privacy@contrax.company. We respond to access and deletion requests within 30 days and remove or anonymize data we no longer need.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-gray-600">{item.detail}</p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-10 max-w-3xl text-sm leading-relaxed text-gray-500">
            See our{" "}
            <a href="/privacy" className="font-medium text-blue-600 hover:text-blue-500">Privacy Policy</a>{" "}
            for the full picture of what we collect and how we use it.
          </p>
        </div>
      </section>

      {/* Incident response */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">Incident Response</h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              If something happens, you'll hear from us
            </h3>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              No system is immune to incidents, so we plan for them. If we become
              aware of a security incident that affects your information, we will
              provide notice as required by applicable law and as appropriate to
              the situation — including by email to the address on your account.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                "We monitor infrastructure and application health, including automated checks and cron-based jobs.",
                "We investigate suspected incidents promptly and take steps to contain and remediate them.",
                "We notify affected users without undue delay when their data may have been involved, along with what we know and what we're doing about it.",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <svg className="mt-1 h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="leading-relaxed text-gray-600">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Subprocessors */}
      <section className="bg-gray-50 py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">Subprocessors</h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Third parties that process data on our behalf
            </h3>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Contrax uses the following subprocessors to deliver the service.
              Each receives only the data needed for its specific function.
            </p>
          </div>
          <div className="mt-12 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-6 py-4">Subprocessor</th>
                  <th className="px-6 py-4">Purpose</th>
                  <th className="px-6 py-4">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  ["Vercel", "Hosting and content delivery", "Application data served to you; server logs"],
                  ["Neon", "Database hosting", "Account, business, bid, and proposal data"],
                  ["OpenAI", "AI processing (summaries, scoring, drafting)", "Content needed for the requested feature"],
                  ["Stripe", "Payments and billing", "Payment details, billing records, and transaction data"],
                  ["Resend", "Transactional email", "Recipient email addresses and message content"],
                ].map(([name, purpose, data]) => (
                  <tr key={name} className="transition-colors hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-slate-900">{name}</td>
                    <td className="px-6 py-4 text-gray-600">{purpose}</td>
                    <td className="px-6 py-4 text-gray-600">{data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mx-auto mt-8 max-w-3xl text-sm leading-relaxed text-gray-500">
            We will update this page if we add or change subprocessors. Questions
            about security or data handling? Email{" "}
            <a href="mailto:privacy@contrax.company" className="font-medium text-blue-600 hover:text-blue-500">
              privacy@contrax.company
            </a>.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 py-20">
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Focus on winning bids — we'll handle security
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-blue-100/80">
            Start competing for government contracts with confidence.
          </p>
          <a
            href="/signup"
            className="mt-8 inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
          >
            Get Started
            <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
        </div>
      </section>
    </div>
  );
}
