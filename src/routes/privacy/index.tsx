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
      { property: "og:url", content: "https://www.contrax.company/privacy" },
      { property: "og:title", content: "Privacy Policy | Contrax" },
      {
        property: "og:description",
        content:
          "Learn how Contrax collects, uses, stores, and protects account, business, bid, and proposal information.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
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
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/privacy" }],
  }),
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: August 31, 2026</p>
        <div className="mt-10 space-y-8 text-slate-700 leading-relaxed">
          <p>Contrax respects your privacy. This Privacy Policy explains what information we collect when you visit or use Contrax, how we use that information, and the choices available to you.</p>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">1. Information We Collect</h2>
            <h3 className="mt-4 text-base font-semibold text-slate-900">Information You Provide</h3>
            <p className="mt-3">When you create an account, contact us, use Contrax, or otherwise provide information to us, we may collect information such as your name, email address, business information, contracting preferences, certifications, saved searches, proposal activity, and other information you choose to provide.</p>
            <h3 className="mt-4 text-base font-semibold text-slate-900">Information Collected Automatically</h3>
            <p className="mt-3">When you visit or interact with Contrax, we may automatically collect technical and usage information, including:</p>
            <ul className="mt-3 space-y-3 list-disc list-inside text-slate-700">
              <li>IP address;</li>
              <li>approximate geographic location derived from network or IP information;</li>
              <li>browser type and operating system;</li>
              <li>device type;</li>
              <li>referring website or traffic source;</li>
              <li>landing page;</li>
              <li>pages viewed and features used;</li>
              <li>dates and times of visits;</li>
              <li>anonymous visitor and session identifiers;</li>
              <li>interactions with features such as contract listings, Contrax Radar, example briefs, pricing pages, signup pages, and account activation; and</li>
              <li>information about the sequence of interactions during a visit or across return visits.</li>
            </ul>
            <p className="mt-3">This information allows Contrax to understand how visitors use the service, maintain security, diagnose technical problems, measure engagement, and improve the user experience.</p>
            <h3 className="mt-4 text-base font-semibold text-slate-900">Anonymous Visitor and Account Attribution</h3>
            <p className="mt-3">Contrax may assign an anonymous identifier to a browser or device so that we can recognize return visits and understand activity across sessions.</p>
            <p className="mt-3">If a visitor later creates a Contrax account, we may associate prior activity connected with that anonymous visitor identifier with the newly created account. This helps us understand how users discover and evaluate Contrax and improve the signup and customer experience.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">2. How We Use Information</h2>
            <p className="mt-3">We may use information we collect to:</p>
            <ul className="mt-3 space-y-3 list-disc list-inside text-slate-700">
              <li>provide, operate, maintain, and improve Contrax;</li>
              <li>match businesses with federal, state, and local government contracting opportunities;</li>
              <li>provide AI-powered summaries, analysis, proposal assistance, contracting intelligence, incumbent research, scoring, and compliance-related functionality;</li>
              <li>personalize the service based on business and contracting preferences;</li>
              <li>maintain accounts and authentication;</li>
              <li>understand how visitors navigate and interact with Contrax;</li>
              <li>measure engagement and conversion;</li>
              <li>identify signup or usability problems;</li>
              <li>determine which marketing, referral, or traffic sources result in visits, registrations, or customers;</li>
              <li>recognize repeat visits using first-party identifiers;</li>
              <li>associate pre-registration activity with an account after registration;</li>
              <li>detect bots, abuse, fraud, unauthorized access, and other security threats;</li>
              <li>diagnose technical problems and maintain service reliability;</li>
              <li>communicate with users and provide customer support;</li>
              <li>send service-related notifications and other communications permitted by law; and</li>
              <li>comply with applicable legal obligations and enforce our agreements.</li>
            </ul>
            <p className="mt-3">Contrax may use aggregated or de-identified information to analyze service performance, usage patterns, and business trends.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">3. IP Addresses and Network Information</h2>
            <p className="mt-3">Contrax may collect and retain IP addresses and related network information when visitors access the service.</p>
            <p className="mt-3">We may use this information for security, fraud and abuse prevention, troubleshooting, analytics, approximate geographic attribution, service improvement, and understanding traffic and usage patterns.</p>
            <p className="mt-3">An IP address does not necessarily identify a particular individual. IP addresses may represent households, businesses, mobile networks, Internet service providers, VPNs, proxies, shared networks, or other infrastructure. Contrax therefore does not treat an IP address alone as definitive proof of a person&rsquo;s identity.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">4. Cookies, Local Storage, and Similar Technologies</h2>
            <p className="mt-3">Contrax uses cookies, browser storage, and similar first-party technologies where necessary to operate and improve the service.</p>
            <p className="mt-3">These technologies may be used for:</p>
            <ul className="mt-3 space-y-3 list-disc list-inside text-slate-700">
              <li>authentication and login sessions;</li>
              <li>security;</li>
              <li>maintaining user preferences;</li>
              <li>anonymous visitor identifiers;</li>
              <li>session identifiers;</li>
              <li>recognizing return visits;</li>
              <li>first-party analytics;</li>
              <li>attribution; and</li>
              <li>measuring product and signup engagement.</li>
            </ul>
            <p className="mt-3">Contrax does not sell personal information in exchange for money.</p>
            <p className="mt-3">If Contrax later introduces advertising technologies, third-party behavioral tracking, or other materially different tracking practices, this Privacy Policy may be updated and consent mechanisms will be implemented where required by applicable law.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">5. Artificial Intelligence</h2>
            <p className="mt-3">Contrax uses artificial intelligence to provide features such as contract analysis, summaries, proposal assistance, opportunity evaluation, contracting intelligence, and related functionality.</p>
            <p className="mt-3">Information submitted to AI-powered features may be processed by service providers used to operate those features.</p>
            <p className="mt-3">Users should not submit sensitive personal information, classified information, export-controlled information, or other information they are not authorized to provide through AI-powered features.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">6. Third-Party Service Providers</h2>
            <p className="mt-3">Contrax uses third-party providers to operate portions of the service. These may include providers for hosting and infrastructure, databases, artificial-intelligence processing, payment processing, email delivery, security, and other operational services.</p>
            <p className="mt-3">Current providers may include Vercel, Neon, OpenAI, Stripe, and Resend.</p>
            <p className="mt-3">These providers may process information on our behalf as necessary to provide their services. Their handling of information is also governed by their respective terms and privacy practices.</p>
            <p className="mt-3">Contrax does not authorize service providers to use information provided by Contrax for purposes unrelated to providing their services to Contrax, except as permitted or required by law or their applicable agreements.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">7. Data Security</h2>
            <p className="mt-3">Contrax uses reasonable administrative, technical, and organizational safeguards designed to protect information against unauthorized access, alteration, disclosure, or destruction.</p>
            <p className="mt-3">These measures may include encryption, access controls, authentication, infrastructure security, and monitoring.</p>
            <p className="mt-3">However, no Internet transmission, computer system, or electronic storage method can be guaranteed to be completely secure.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">8. Data Retention</h2>
            <p className="mt-3">Contrax retains information for as long as reasonably necessary for the purposes described in this Policy, including providing the service, maintaining security, analyzing service performance, complying with legal obligations, resolving disputes, and enforcing agreements.</p>
            <p className="mt-3">Different categories of information may be retained for different periods depending on their purpose and legal requirements.</p>
            <p className="mt-3">Contrax may retain aggregated or de-identified information that can no longer reasonably be associated with an identifiable individual.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">9. Disclosure of Information</h2>
            <p className="mt-3">Contrax may disclose information:</p>
            <ul className="mt-3 space-y-3 list-disc list-inside text-slate-700">
              <li>to service providers operating on our behalf;</li>
              <li>when necessary to provide a feature requested by a user;</li>
              <li>to protect the security, rights, property, or safety of Contrax, its users, or others;</li>
              <li>when required by law, legal process, court order, or governmental request;</li>
              <li>in connection with a merger, financing, acquisition, reorganization, bankruptcy, sale of assets, or similar business transaction; or</li>
              <li>with the user&rsquo;s direction or consent.</li>
            </ul>
            <p className="mt-3">Contrax does not sell personal information for money.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">10. Your Privacy Rights</h2>
            <p className="mt-3">Depending on where you live, you may have rights regarding personal information Contrax maintains about you, including rights to request access, correction, deletion, or a copy of certain information, and rights to object to or restrict certain processing.</p>
            <p className="mt-3">Requests may be submitted to <a href="mailto:privacy@contrax.company" className="text-blue-600 hover:text-blue-500">privacy@contrax.company</a>.</p>
            <p className="mt-3">We may need to verify your identity before fulfilling certain requests. Some information may be retained when required or permitted by law, including for security, fraud prevention, recordkeeping, or legal compliance.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">11. California Residents</h2>
            <p className="mt-3">California residents may have additional rights under applicable California privacy laws, including rights concerning access, correction, deletion, and information about how personal information is collected, used, or disclosed.</p>
            <p className="mt-3">Contrax does not sell personal information for monetary consideration.</p>
            <p className="mt-3">California privacy requests may be submitted to <a href="mailto:privacy@contrax.company" className="text-blue-600 hover:text-blue-500">privacy@contrax.company</a>.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">12. European Economic Area, United Kingdom, and Similar Jurisdictions</h2>
            <p className="mt-3">Where applicable, Contrax processes personal information based on one or more lawful bases, including performance of a contract, legitimate interests, consent where required, and compliance with legal obligations.</p>
            <p className="mt-3">Applicable rights may include access, correction, deletion, portability, restriction, objection, and withdrawal of consent where processing relies upon consent.</p>
            <p className="mt-3">Requests may be submitted to <a href="mailto:privacy@contrax.company" className="text-blue-600 hover:text-blue-500">privacy@contrax.company</a>.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">13. Children&rsquo;s Privacy</h2>
            <p className="mt-3">Contrax is a business-oriented government contracting service and is not intended for children.</p>
            <p className="mt-3">We do not knowingly collect personal information from children under 13. If we learn that such information has been collected, we will take reasonable steps to delete it.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">14. Changes to This Privacy Policy</h2>
            <p className="mt-3">Contrax may update this Privacy Policy periodically as the service, technology, or applicable legal requirements change.</p>
            <p className="mt-3">The &ldquo;Last Updated&rdquo; date will indicate when the Policy was most recently revised. When appropriate or legally required, we may provide additional notice of material changes.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">15. Contact</h2>
            <p className="mt-3">Questions or privacy requests may be directed to:</p>
            <p className="mt-3">Contrax<br /><a href="mailto:privacy@contrax.company" className="text-blue-600 hover:text-blue-500">privacy@contrax.company</a><br /><a href="https://www.contrax.company" className="text-blue-600 hover:text-blue-500">contrax.company</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
