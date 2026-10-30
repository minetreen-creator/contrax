import { useEffect, useRef, useState } from "react";
import { coinLabel, coinValue, perSecond } from "~/lib/money-jar";
import { trackEvent } from "~/lib/track";

const MAX_COINS_IN_FLIGHT = 6;
const JAR_LEVEL_STEPS = 60;

/**
 * Homepage money jar (owner 2026-10-30): coins drop at the real pace of
 * federal contract spending in the trades Contrax covers (last complete fiscal
 * year, USAspending), and a counter shows how much went out while the visitor
 * has been on the page. The card states the source, the pace and each coin's value.
 */
export function MoneyJar({ data }: { data: { fiscalYear: number; total: number; trades: number } | null }) {
  const rate = perSecond(data?.total ?? 0);
  const coin = coinValue(rate);
  const [elapsed, setElapsed] = useState(0);
  const [coins, setCoins] = useState<number[]>([]);
  const [dropped, setDropped] = useState(0);
  const started = useRef(0);
  const shown = useRef(false);

  useEffect(() => {
    if (!rate) return;
    started.current = performance.now();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = window.setInterval(() => setElapsed((performance.now() - started.current) / 1000), reduce ? 1000 : 100);
    let next = 0;
    const drop = window.setInterval(() => {
      setDropped((d) => d + 1);
      if (reduce) return;
      const id = next++;
      setCoins((c) => [...c.slice(-(MAX_COINS_IN_FLIGHT - 1)), id]);
      window.setTimeout(() => setCoins((c) => c.filter((x) => x !== id)), 1100);
    }, (coin / rate) * 1000);
    if (!shown.current) {
      shown.current = true;
      trackEvent("money_jar_shown", String(data?.fiscalYear ?? ""));
    }
    return () => {
      window.clearInterval(tick);
      window.clearInterval(drop);
    };
  }, [rate, coin, data?.fiscalYear]);

  if (!data || !rate || !coin) return null;
  const sinceOpen = Math.floor(elapsed * rate);
  const level = Math.min(dropped, JAR_LEVEL_STEPS) / JAR_LEVEL_STEPS;
  const yearly = data.total >= 1e9 ? `$${(data.total / 1e9).toFixed(1).replace(/\.0$/, "")} billion` : `$${Math.round(data.total / 1e6)} million`;

  return (
    <section aria-labelledby="money-jar-title" className="mx-auto max-w-[1120px] px-4 py-10 sm:px-6">
      <div className="grid items-center gap-8 rounded-3xl border border-amber-400/30 bg-[#0b1630] p-6 text-white shadow-[0_10px_40px_rgba(245,158,11,0.15)] sm:p-10 md:grid-cols-[260px_1fr]">
        <div className="relative mx-auto h-[260px] w-[200px]" aria-hidden="true">
          {coins.map((id) => (
            <span key={id} className="money-jar-coin absolute left-1/2 top-0 -ml-[14px] flex h-7 w-7 items-center justify-center rounded-full border-2 border-amber-200 bg-amber-400 text-xs font-black text-amber-900 shadow">
              $
            </span>
          ))}
          <svg viewBox="0 0 200 260" className="absolute inset-0 h-full w-full">
            <defs>
              <clipPath id="money-jar-glass">
                <path d="M55 40 h90 v18 q30 12 30 50 v110 q0 32 -32 32 h-86 q-32 0 -32 -32 v-110 q0 -38 30 -50 z" />
              </clipPath>
            </defs>
            <g clipPath="url(#money-jar-glass)">
              <rect x="0" y={250 - 190 * (0.08 + 0.85 * level)} width="200" height="260" fill="#f59e0b" opacity="0.9" style={{ transition: "y 0.8s ease-out" }} />
              <rect x="0" y={250 - 190 * (0.08 + 0.85 * level)} width="200" height="6" fill="#fde68a" style={{ transition: "y 0.8s ease-out" }} />
            </g>
            <path d="M55 40 h90 v18 q30 12 30 50 v110 q0 32 -32 32 h-86 q-32 0 -32 -32 v-110 q0 -38 30 -50 z" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.55)" strokeWidth="4" />
            <rect x="50" y="28" width="100" height="16" rx="5" fill="#94a3b8" />
            <text x="100" y="170" textAnchor="middle" fontSize="15" fontWeight="800" fill="#0b1630" opacity="0.75">GOV $</text>
          </svg>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">The money jar</p>
          <h2 id="money-jar-title" className="mt-2 text-2xl font-extrabold sm:text-3xl">
            Since you opened this page, the federal government has spent this much on contractors in trades like yours
          </h2>
          <p className="mt-3 font-[Georgia,serif] text-5xl font-extrabold tabular-nums text-amber-300 sm:text-6xl" aria-live="off">
            ${sinceOpen.toLocaleString("en-US")}
          </p>
          <p className="mt-3 text-sm text-slate-300">
            Each coin is {coinLabel(coin)}. The jar fills at the real pace of federal contract spending in the {data.trades} trades Contrax
            covers: {yearly} in fiscal year {data.fiscalYear}, from USAspending.gov, spread evenly over the year.
          </p>
          <a
            href="/radar?source=money_jar"
            onClick={() => trackEvent("money_jar_click")}
            className="mt-5 inline-block rounded-xl bg-amber-500 px-6 py-3 font-bold text-white transition hover:bg-amber-400 active:scale-[0.98]"
          >
            Get your share: see open bids →
          </a>
        </div>
      </div>
    </section>
  );
}
