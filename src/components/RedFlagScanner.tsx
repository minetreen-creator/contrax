/**
 * Red-flag scanner on a bid page (owner 2026-11-08). Two parts:
 *  1. The notice text Contrax has is scanned right away in the browser (src/lib/red-flags.ts).
 *  2. "Scan the full solicitation": upload the PDF or paste its text; /api/redflags reads it in
 *     memory (never stored) and returns the flags. Paid members see every quoted line with its page;
 *     free viewers see the flags, counts and reasons, plus one quoted line as a sample.
 */
import { useMemo, useState } from "react";
import { scanRedFlags, type RedFlag } from "~/lib/red-flags";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";

type ScanResult = { flags: RedFlag[]; paid: boolean; pages: number; words: number };

export function RedFlagScanner({ noticeText, bidId }: { noticeText: string | null; bidId: number }) {
  const fromNotice = useMemo(() => scanRedFlags(noticeText ?? ""), [noticeText]);
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);

  const scan = async () => {
    setBusy(true);
    setError("");
    trackEvent("redflags_scan", file ? "file" : "paste");
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.set("file", file);
        res = await fetch("/api/redflags", { method: "POST", body: form });
      } else {
        res = await fetch("/api/redflags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: paste }) });
      }
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Couldn't scan that.");
      setResult(data as ScanResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Red-flag scanner" className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-base font-bold text-white">🚩 Red-flag scanner</h2>
      <p className="mt-1 text-sm text-slate-400">
        Liquidated damages, clearances, prevailing wage, bonds, mandatory meetings, insurance limits and more, before you spend hours reading.
      </p>

      {fromNotice.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">In the notice text</p>
          <FlagList flags={fromNotice} locked={false} />
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
        <p className="text-sm font-semibold text-white">Scan the full solicitation</p>
        <p className="mt-0.5 text-xs text-slate-400">Upload the PDF from the agency's bid page, or paste its text. It's read once and not stored.</p>
        <input
          type="file"
          accept="application/pdf,.pdf,text/plain,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          aria-label="Solicitation PDF"
        />
        {!file ? (
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="…or paste the solicitation text here"
            rows={3}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-white placeholder:text-slate-500"
          />
        ) : null}
        <button
          type="button"
          onClick={scan}
          disabled={busy || (!file && paste.trim().length < 40)}
          className="mt-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? "Scanning…" : "Scan for red flags"}
        </button>
        {error ? <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p> : null}

        {result ? (
          <div className="mt-4" aria-live="polite">
            <p className="text-sm text-slate-300">
              {result.flags.length
                ? `${result.flags.length} kind${result.flags.length === 1 ? "" : "s"} of red flag found`
                : "No red flags found in the text we could read"}
              {result.pages ? ` in ${result.pages} pages` : ""} ({result.words.toLocaleString("en-US")} words).
            </p>
            {result.flags.length ? <FlagList flags={result.flags} locked={!result.paid} /> : null}
            {!result.paid && result.flags.length ? (
              <a
                href={`/upgrade?plan=starter&source=redflags&bid=${bidId}`}
                onClick={() => trackEvent("redflags_unlock_click", String(bidId))}
                className="mt-3 inline-block rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400"
              >
                See every quoted line and page · ${STARTER_FIRST_MONTH_PRICE} for 30 days
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-slate-500">A flag means "read this part", not "skip this bid". The solicitation's own words are the rules.</p>
    </section>
  );
}

function FlagList({ flags, locked }: { flags: RedFlag[]; locked: boolean }) {
  return (
    <ul className="mt-2 space-y-2">
      {flags.map((f) => (
        <li key={f.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
          <p className="text-sm font-semibold text-rose-200">
            {f.label} <span className="font-normal text-slate-400">· {f.count}×</span>
          </p>
          <p className="text-xs text-slate-400">{f.why}</p>
          {f.snippets.map((s, i) => (
            <p key={i} className="mt-1 border-l-2 border-rose-400/50 pl-2 text-xs text-slate-200">
              {s.page ? <span className="font-semibold text-slate-400">p. {s.page}: </span> : null}"{s.text}"
            </p>
          ))}
          {locked && !f.snippets.length ? (
            <p className="mt-1 select-none border-l-2 border-rose-400/30 pl-2 text-xs text-slate-300 blur-[4px]" aria-hidden="true">
              p. 00: "Xxxxxxx xxx xxxxx xx xxx xxxxxx xxxx xxxxx xxxxxxx xx xxxx xxx."
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
