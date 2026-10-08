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

export function FromTheCEO() {
  return (
    <section id="from-the-ceo" aria-labelledby="from-the-ceo-title" className="mx-auto mt-12 max-w-[1120px] px-4 sm:px-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto max-w-[680px]">
          <h2 id="from-the-ceo-title" className="text-2xl font-bold text-slate-900 dark:text-white">From the CEO</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Nathaniel Minetree · Founder &amp; CEO, Contrax</p>
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
