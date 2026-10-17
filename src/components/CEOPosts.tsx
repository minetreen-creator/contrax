const whatsNew = [
  {
    heading: "🧭 Contrax Launchpad: your step-by-step path to your first government contract",
    items: [
      "Build a professional capability statement in minutes, with a live preview. Print it, save it as a PDF, or email it straight to your inbox in one click.",
      "A registration checklist so nothing slips through the cracks.",
      "A bid-planning worksheet to decide what to bid and what to pass on.",
      "Three courses (basics, preparing your bid, strategy), each with quizzes and a printable completion certificate.",
      "Matching bids in your inbox every week: tick one box when you email your statement. No account needed, unsubscribe anytime.",
      "Sign in and your Launchpad follows you to every device, with your progress right on your Contrax dashboard.",
    ],
  },
  {
    heading: "🏠 A brand-new homepage, built from your feedback",
    items: ["You told us what you wanted, and we listened. Type your trade and state and see real, open contracts right away, no account needed. Launchpad now has its own spot right on the homepage."],
  },
  {
    heading: "🧹 More janitorial work",
    items: ["We now catch window washing, day porters, disinfection, restroom cleaning, post-construction cleanup, and pressure and power washing."],
  },
  {
    heading: "❄️ Better HVAC matches",
    items: ["Rooftop units, cooling towers, heat pumps, mini-splits, refrigeration and building automation now land in your matches. Bids that are only for buying filters or equipment get screened out, so you see real work."],
  },
  {
    heading: "⏳ Contracts Ending Soon",
    items: ["See which federal contracts are about to end, who holds them now, and get ready before the rebid is posted."],
  },
];

const trialMessage = [
  "🚀 Big change at Contrax: every new account now starts with a 7-day Professional trial.",
  "Why are we doing this? Most people who signed up only ever saw the basic version of Contrax. They never saw the tools that actually help you win: the daily bid emails, the match scores and the past winners and award prices. You can’t know if something is worth paying for until you’ve used it. So now everyone gets the whole thing for a week, and you decide based on real results.",
  "No credit card. No catch. Just create your account and you get the full Contrax experience for a week:",
];

const trialFeatures = [
  "Unlimited Radar searches matched to your trade and area",
  "A daily 6 AM email of new government bids that fit your business",
  "Every state and trade you work in",
  "Unlimited saved bids, with deadlines in your calendar",
  "Past winners and award prices, so you know what it takes to win",
  "AI bid briefs and match scores",
];

const trialClosing = [
  "We cover federal, state and local bids in 45 states and DC, and every bid links straight to the official government posting.",
  "After 7 days, pick the plan that fits. Starter is just $19/month. Or keep searching on Basic at no cost.",
  "Already have an account? Your 7-day trial starts the next time you log in.",
];

const rhodeIslandMessage = [
  "We are proud to be working with the U.S. Small Business Administration’s Rhode Island District Office to share resources that help small business owners explore government contracting opportunities.",
  "At Contrax, we believe access to practical education can make a meaningful difference. Our introductory, intermediate, and advanced government contracting courses are free for everyone—and will remain free.",
  "From understanding the basics to preparing a bid and managing contract performance, these courses help business owners take their next step with greater confidence.",
  "We appreciate the Rhode Island SBA team’s commitment to supporting small businesses and the opportunity to contribute to that mission.",
];

const message = [
  "You can have the skills. You can have the determination. You can work hard every day—and still feel lost when it comes to government contracting.",
  "Where do you start? What does the paperwork mean? Is your business even ready to bid?",
  "Getting those answers shouldn’t depend on how much money you have.",
  "That’s why all three Contrax courses—introductory, intermediate, and advanced—are FREE for everyone. And they will stay free.",
  "I know what it feels like to build something, put your heart into it, and wonder whether the next opportunity will finally open a door. I want these courses to give someone a clearer path forward.",
  "Maybe you’re starting a business to support your family. Maybe you’re a veteran building your next chapter. Maybe you’ve spent years doing good work and are ready to explore something bigger.",
  "You deserve a place to begin.",
  "These courses won’t promise you a contract. They will give you a chance to learn, prepare, and take your next step with more confidence.",
  "From me, Nathaniel Minetree, and Contrax: the learning is free today, and it will stay free.",
  "Start whenever you’re ready."
];

export function CEOPosts() {
  return (
    <section id="from-the-ceo" aria-labelledby="from-the-ceo-title" className="mx-auto mt-12 max-w-[1120px] px-4 sm:px-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto max-w-[680px]">
          <h2 id="from-the-ceo-title" className="text-2xl font-bold text-slate-900 dark:text-white">From the CEO</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Nathaniel Minetree · Founder &amp; CEO, Contrax</p>
          <article className="mt-6 border-b border-slate-200 pb-8 dark:border-slate-700" aria-labelledby="ceo-whats-new-title">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">What&apos;s new · October 2026</p>
            <h3 id="ceo-whats-new-title" className="mt-2 text-xl font-bold text-slate-900 dark:text-white">A big week at Contrax</h3>
            <p className="mt-3 text-base leading-relaxed text-slate-700 dark:text-slate-300">Here is everything that just went live.</p>
            <div className="mt-5 space-y-5">
              {whatsNew.map(section => (
                <div key={section.heading}>
                  <h4 className="font-bold text-slate-900 dark:text-white">{section.heading}</h4>
                  {section.items.length > 1 ? (
                    <ul className="mt-2 space-y-1.5 text-base leading-relaxed text-slate-700 dark:text-slate-300">{section.items.map(item => <li key={item}>✅ {item}</li>)}</ul>
                  ) : (
                    <p className="mt-2 text-base leading-relaxed text-slate-700 dark:text-slate-300">{section.items[0]}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-5 text-base leading-relaxed text-slate-700 dark:text-slate-300">Government contracts aren&apos;t just for the big guys. Small businesses win them every day, and Contrax helps you find yours.</p>
            <a href="/launchpad" className="mt-5 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">Open Contrax Launchpad →</a>
          </article>
          <article className="mt-6 border-b border-slate-200 pb-8 dark:border-slate-700" aria-labelledby="ceo-trial-title">
            <h3 id="ceo-trial-title" className="text-xl font-bold text-slate-900 dark:text-white">Every account now starts with a 7-day trial</h3>
            <p className="mt-3 text-base leading-relaxed text-slate-700 dark:text-slate-300">Most people only ever saw the basic version of Contrax. Now everyone gets the full Professional tools for a week, and decides based on real results.</p>
            <figure className="mt-4">
              <a href="/images/from-the-ceo-trial.png" target="_blank" rel="noopener noreferrer" aria-label="Open the 7-day trial announcement screenshot full size (new tab)" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
                <img src="/images/from-the-ceo-trial.png" width={690} height={542} loading="lazy" decoding="async" alt="Contrax Facebook announcement that every new account now starts with a 7-day Professional trial, and why. The announcement is available as text below." className="h-auto w-full rounded-xl border border-slate-200 dark:border-slate-700" />
              </a>
              <figcaption className="mt-2 text-xs text-slate-500 dark:text-slate-400">Our 7-day trial announcement. Select the screenshot to open it full size.</figcaption>
            </figure>
            <details className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">Read the trial announcement as text</summary>
              <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-700 dark:text-slate-300">
                {trialMessage.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                <ul className="space-y-1">{trialFeatures.map(feature => <li key={feature}>✅ {feature}</li>)}</ul>
                {trialClosing.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                <p>Find your next contract at <a href="/" className="text-blue-700 underline dark:text-blue-300">contrax.company</a></p>
                <p>📧 Questions? <a href="mailto:contrax.companyllc@gmail.com" className="text-blue-700 underline dark:text-blue-300">contrax.companyllc@gmail.com</a></p>
              </div>
            </details>
            <a href="/signup" className="mt-5 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">Start my 7-day trial →</a>
          </article>
          <article className="mt-6 border-b border-slate-200 pb-8 dark:border-slate-700" aria-labelledby="ceo-crm-title">
            <h3 id="ceo-crm-title" className="text-xl font-bold text-slate-900 dark:text-white">Big upgrade. Same price.</h3>
            <p className="mt-3 text-base leading-relaxed text-slate-700 dark:text-slate-300">Our paid plans now include a built-in CRM to organize contacts, connect them to saved bids, and keep your next steps in sight.</p>
            <figure className="mt-4">
              <a href="/images/from-the-ceo-crm.png" target="_blank" rel="noopener noreferrer" aria-label="Open the CRM announcement screenshot full size (new tab)" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
                <img src="/images/from-the-ceo-crm.png" width={682} height={387} loading="lazy" decoding="async" alt="Contrax Facebook announcement introducing the CRM included in Starter and Professional plans with no price increase. The announcement is available as text below." className="h-auto w-full rounded-xl border border-slate-200 dark:border-slate-700" />
              </a>
              <figcaption className="mt-2 text-xs text-slate-500 dark:text-slate-400">Our CRM announcement. Select the screenshot to open it full size.</figcaption>
            </figure>
            <details className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">Read the CRM announcement as text</summary>
              <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-700 dark:text-slate-300">
                <p>🚀 BIG UPGRADE. SAME PRICE.</p>
                <p>Contrax’s paid plans just got a whole lot more powerful—with a NEW built-in CRM!</p>
                <p>Finding a government contract is only the beginning. Now you can organize your contacts, connect them to saved bids, and keep your next steps in sight—all inside Contrax.</p>
                <p>💼 STARTER — $19/month<br />Up to 100 contacts, notes, next actions, manual follow-up dates, and saved-bid linking.</p>
                <p>⚡ PROFESSIONAL — $79/month<br />Up to 1,000 contacts, relationship history, opt-in email reminders, and AI follow-up drafts ready for your review.</p>
                <p>🔥 More tools. More organization. No price increase.</p>
                <p>Already subscribed? These improvements are included in your plan.</p>
                <p>Your next opportunity deserves more than a forgotten bookmark. Give it a place in your pipeline.</p>
              </div>
            </details>
            <a href="/pricing" className="mt-5 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">Explore the upgraded plans →</a>
          </article>
          <article className="mt-6 border-b border-slate-200 pb-8 dark:border-slate-700" aria-labelledby="ceo-rhode-island-title">
            <h3 id="ceo-rhode-island-title" className="text-xl font-bold text-slate-900 dark:text-white">Working with Rhode Island SBA</h3>
            <figure className="mt-4">
              <a href="/images/from-the-ceo-rhode-island-sba.png" target="_blank" rel="noopener noreferrer" aria-label="Open the Rhode Island SBA announcement screenshot full size (new tab)" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
                <img src="/images/from-the-ceo-rhode-island-sba.png" width={682} height={366} loading="lazy" decoding="async" alt="Contrax Facebook announcement about working with the Rhode Island SBA District Office and offering three free government contracting courses. Read the complete announcement in the text version below." className="h-auto w-full rounded-xl border border-slate-200 dark:border-slate-700" />
              </a>
              <figcaption className="mt-2 text-xs text-slate-500 dark:text-slate-400">Our Rhode Island SBA announcement. Select the screenshot to open it full size.</figcaption>
            </figure>
            <details className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">Read the Rhode Island SBA announcement as text</summary>
              <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-700 dark:text-slate-300">
                {rhodeIslandMessage.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                <p>Explore our free courses at <a href="/learn" className="text-blue-700 underline dark:text-blue-300">www.contrax.company/learn</a>.</p>
              </div>
            </details>
          </article>
          <h3 className="mt-8 text-xl font-bold text-slate-900 dark:text-white">Why our courses will stay free</h3>
          <p className="mt-3 text-base leading-relaxed text-slate-700 dark:text-slate-300">Why our introductory, intermediate, and advanced courses are free—and will stay free.</p>
          <figure className="mt-6">
            <a href="/images/from-the-ceo.png" target="_blank" rel="noopener noreferrer" aria-label="Open the CEO message screenshot full size (new tab)" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
              <img src="/images/from-the-ceo.png" width={680} height={417} loading="lazy" decoding="async" alt="Contrax Facebook post from Nathaniel Minetree explaining why all three government contracting courses are free for everyone and will stay free. The full message is available in the text version below." className="h-auto w-full rounded-xl border border-slate-200 dark:border-slate-700" />
            </a>
            <figcaption className="mt-2 text-xs text-slate-500 dark:text-slate-400">A message from our CEO. Select the screenshot to open it full size.</figcaption>
          </figure>
          <details className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">Read the message as text</summary>
            <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-700 dark:text-slate-300">{message.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
          </details>
          <div className="mt-6 flex flex-wrap items-center gap-4">
          <a href="/learn" className=" inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">Explore all three free courses →</a>
          <a href="https://www.facebook.com/profile.php?id=61593835047770" target="_blank" rel="noopener noreferrer" aria-label="Follow Contrax on Facebook (opens in a new tab)" className="rounded-xl border border-blue-200 px-5 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-950">Follow Contrax on Facebook ↗</a>
          </div>
        </div>
      </div>
    </section>
  );
}
