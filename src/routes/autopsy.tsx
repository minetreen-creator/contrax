import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef } from "react";
import { getCurrentUser } from "~/lib/auth";
import { buildAutopsy } from "~/lib/award-autopsy";
import {
  getGiftedAutopsy,
  type AutopsyDraft,
  type GiftedAutopsyResult,
  AUTOPSY_DRAFT_STORAGE_KEY,
} from "~/lib/autopsy-funnel";
import { trackEvent } from "~/lib/track";

/**
 * Public "Why did you lose?" entry — the acquisition front door of the
 * FREE-FIRST-AUTOPSY funnel (owner-endorsed 2026-09-05).
 *
 * A stranger (NO login) enters the lost solicitation; the route does the LIVE
 * USAspending lookup via the existing cached getFPDSIntel (through the shared
 * award-autopsy lib) and renders the award-found preview: winner + amount +
 * difference — the honest hook that converts — visible BEFORE any account.
 * After the preview a signup wall gates the COMPLETE autopsy: "Create a free
 * account (no card) to see the full autopsy." Landing on /signup via the
 * standard free-Basic flow (no card = free forever). When the new account
 * returns here, stage 3 (complete report) is delivered as the one-time gift.
 *
 * The ⚡ Contrax Learning memory stays PAID-ONLY (Professional+) — never on this
 * path (no bid_losses row, no memory banner), server-gated exactly as today.
 */

// ── Server side ───────────────────────────────────────────────────────────────

/** Payload for the public award preview (never fabricated — real USAspending). */
export interface AutopsyPreview {
  found: boolean;
  fallbackMessage: string | null;
  winner: string | null;
  winningAmount: number | null;
  youBid: number | null;
  difference: number | null;
  differencePct: number | null;
}

/** Public preview lookup — no auth, rate-limited at the intake level. */
export const getPublicPreview = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as AutopsyDraft)
  .handler(async ({ data }): Promise<AutopsyPreview> => {
    const draft: AutopsyDraft = {
      bidTitle: String(data.bidTitle ?? "").slice(0, 300),
      agency: String(data.agency ?? "").slice(0, 200),
      naicsCode: String(data.naicsCode ?? "").slice(0, 24),
      estimatedValue: String(data.estimatedValue ?? "").slice(0, 40),
    };
    const { autopsy } = await buildAutopsy({
      bidTitle: draft.bidTitle,
      agency: draft.agency,
      naicsCode: draft.naicsCode,
      estimatedValue: draft.estimatedValue,
    });
    return {
      found: autopsy.found,
      fallbackMessage: autopsy.fallbackMessage,
      winner: autopsy.winner,
      winningAmount: autopsy.winningAmount,
      youBid: autopsy.youBid,
      difference: autopsy.difference,
      differencePct: autopsy.differencePct,
    };
  });

/** Post-signup complete-report delivery: the one-time free gift. */
export const getGiftedReport = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { draft: AutopsyDraft | null })
  .handler(async ({ data }): Promise<GiftedAutopsyResult> => {
    const user = await getCurrentUser();
    if (!user) {
      return { gifted: false, delivered: false, autopsy: null, reason: "not_authenticated" };
    }
    const draft: AutopsyDraft | null =
      data.draft && typeof data.draft === "object"
        ? {
            bidTitle: String(data.draft.bidTitle ?? "").slice(0, 300),
            agency: String(data.draft.agency ?? "").slice(0, 200),
            naicsCode: String(data.draft.naicsCode ?? "").slice(0, 24),
            estimatedValue: String(data.draft.estimatedValue ?? "").slice(0, 40),
          }
        : null;
    return getGiftedAutopsy(user.id, draft);
  });

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/autopsy")({
  component: AutopsyPage,
  head: () => ({
    meta: [
      { title: "Why did you lose that bid? See the real winner — free | Contrax" },
      {
        name: "description",
        content:
          "Lost a government bid? Enter the solicitation to see the real award winner, the winning amount, and your difference — then get your free full Award Autopsy.",
      },
      // Public acquisition page — must be indexable so shared links surface it.
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Why did you lose that bid? See the real winner — free | Contrax" },
      {
        property: "og:description",
        content:
          "Enter the lost solicitation to see the real award winner, the winning amount, and your difference — live from USAspending data.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/autopsy" },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
    ],
  }),
});

// ── Client helpers ────────────────────────────────────────────────────────────

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function loadDraft(): AutopsyDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(AUTOPSY_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AutopsyDraft;
    if (parsed && typeof parsed.bidTitle === "string" && typeof parsed.agency === "string") {
      return parsed;
    }
  } catch {
    /* corrupt/blocked storage — no draft */
  }
  return null;
}

function saveDraft(d: AutopsyDraft): void {
  try {
    window.sessionStorage.setItem(AUTOPSY_DRAFT_STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* storage blocked — gift delivery falls back to empty; user re-enters */
  }
}

function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(AUTOPSY_DRAFT_STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

interface FormState {
  bidTitle: string;
  agency: string;
  naicsCode: string;
  estimatedValue: string;
}

const EMPTY_FORM: FormState = { bidTitle: "", agency: "", naicsCode: "", estimatedValue: "" };

function AutopsyPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<AutopsyPreview | null>(null);
  const [gift, setGift] = useState<GiftedAutopsyResult | null>(null);
  const [giftBusy, setGiftBusy] = useState(false);
  // Logged-in state so the page can skip the wall once the user signs up.
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const landingFired = useRef(false);

  // Stage 1 — autopsy_landing (fire once per mount; __root already records the
  // page view separately via /api/track-visitor kind=page).
  useEffect(() => {
    if (landingFired.current) return;
    landingFired.current = true;
    trackEvent("autopsy_landing", "autopsy_funnel", "/autopsy");
  }, []);

  // Resolve the current user after hydration (prevents a flash of the wall for
  // a signed-in user returning to see their gifted report).
  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        if (u && u.id != null && typeof u.email === "string") {
          setCurrentUser({ id: String(u.id), email: u.email });
        }
      })
      .catch(() => { /* anonymous — wall stays */ });
  }, []);

  // When a logged-in user lands here with a stored draft and no preview yet,
  // deliver the gifted complete report right away (post-signup return).
  useEffect(() => {
    if (!currentUser || preview || giftBusy) return;
    const draft = loadDraft();
    if (!draft) return;
    setGiftBusy(true);
    getGiftedReport({ data: { draft } })
      .then((r) => {
        setGift(r);
        if (r.delivered) {
          trackEvent("autopsy_report_viewed", "autopsy_funnel", "/autopsy");
          clearDraft();
        }
      })
      .catch(() => setGift((prev) => prev ?? null))
      .finally(() => setGiftBusy(false));
  }, [currentUser, preview, giftBusy]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    // Store the draft FIRST so the post-signup return can deliver the gift even
    // if the lookup below fails (the server re-looks-up at delivery time).
    const draft: AutopsyDraft = {
      bidTitle: form.bidTitle.trim(),
      agency: form.agency.trim(),
      naicsCode: form.naicsCode.trim(),
      estimatedValue: form.estimatedValue.trim(),
    };
    saveDraft(draft);
    // Stage 2 — lost solicitation entered.
    trackEvent("autopsy_contract_entered", "autopsy_funnel", "/autopsy");
    try {
      const p = await getPublicPreview({ data: draft });
      setPreview(p);
      if (p.found) {
        // Stage 3 — real award matched (winner + amount + difference found).
        trackEvent("autopsy_award_found", "autopsy_funnel", "/autopsy");
        // Stage 4 — autopsy preview generated (pre-signup).
        trackEvent("autopsy_generated", "autopsy_funnel", "/autopsy");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not look up the award. Please try again.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setPreview(null);
    setGift(null);
  };

  const refreshGift = async () => {
    if (!currentUser || giftBusy) return;
    setGiftBusy(true);
    try {
      const r = await getGiftedReport({ data: { draft: loadDraft() } });
      setGift(r);
      if (r.delivered) {
        trackEvent("autopsy_report_viewed", "autopsy_funnel", "/autopsy");
        clearDraft();
      }
    } catch { /* keep current state */ } finally {
      setGiftBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-4 text-sm">
            {currentUser ? (
              <a href="/radar" className="font-medium text-amber-600 hover:text-amber-700">
                📡 Try Radar →
              </a>
            ) : (
              <a href="/signup" className="font-medium text-slate-600 hover:text-slate-900">
                Sign up free
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-amber-600">Free Award Autopsy</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
            Why did you lose that bid?
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600">
            Enter the solicitation and see who actually won — the real winner, the winning amount,
            and your difference. Live from USAspending data, no account needed for the preview.
          </p>
        </div>

        {/* Step 1: the entry form (always shown while no preview) */}
        {!preview && (
          <form onSubmit={submit} className="mt-8 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-slate-700">Solicitation title *</label>
                <input
                  required
                  value={form.bidTitle}
                  onChange={(e) => setForm({ ...form, bidTitle: e.target.value })}
                  placeholder='e.g. "Janitorial Services, DHA Facilities, San Antonio"'
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Agency *</label>
                <input
                  required
                  value={form.agency}
                  onChange={(e) => setForm({ ...form, agency: e.target.value })}
                  placeholder='e.g. "Department of Veterans Affairs"'
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">NAICS code (optional)</label>
                <input
                  value={form.naicsCode}
                  onChange={(e) => setForm({ ...form, naicsCode: e.target.value })}
                  placeholder="e.g. 561720"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-slate-700">Your bid amount (optional)</label>
                <input
                  value={form.estimatedValue}
                  onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
                  placeholder="e.g. 250000"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              disabled={busy}
              className="mt-5 w-full rounded-xl bg-amber-500 px-5 py-3 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? "Looking up the real award…" : "See who won →"}
            </button>
            <p className="mt-3 text-center text-xs text-slate-400">
              Live lookup via USAspending — nothing invented. No account needed to see the preview.
            </p>
          </form>
        )}

        {/* Step 2: the award preview (pre-signup hook) */}
        {preview && !gift?.delivered && (
          <div className="mt-8">
            <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">⚖ The real award</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  Live USAspending data
                </span>
              </div>
              {preview.found ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">You bid</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{fmtMoney(preview.youBid)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winner</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{preview.winner}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winning amount</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{fmtMoney(preview.winningAmount)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Difference</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {preview.difference != null && preview.differencePct != null
                          ? `${fmtMoney(Math.abs(preview.difference))} / ${Math.abs(preview.differencePct).toFixed(1)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Step 4→5: signup wall after the preview */}
                  {!preview.found && (
                    <p className="mt-4 text-sm text-slate-600">{preview.fallbackMessage}</p>
                  )}

                  <div className="mt-6 rounded-xl bg-gradient-to-r from-amber-50 to-white border border-amber-100 p-5">
                    <h3 className="text-base font-bold text-slate-900">
                      See the full autopsy — free
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Your first complete Award Autopsy is free: what probably hurt you, historical
                      pricing at this agency, and a target price range for similar opportunities.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {currentUser ? (
                        <button
                          onClick={() => { trackEvent("autopsy_signup_wall", "autopsy_funnel", "/autopsy"); refreshGift(); }}
                          disabled={giftBusy}
                          className="rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
                        >
                          {giftBusy ? "Generating…" : "Generate my free complete autopsy →"}
                        </button>
                      ) : (
                        <a
                          href="/signup?plan=basic&source=autopsy&next=/autopsy"
                          onClick={() => {
                            // Stage 5 — signup gate shown (after the preview).
                            trackEvent("autopsy_signup_wall", "autopsy_funnel", "/autopsy");
                          }}
                          className="inline-block rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-400"
                        >
                          Create a free account (no card) to see the full autopsy →
                        </a>
                      )}
                      <button onClick={reset} className="text-sm text-slate-500 underline hover:text-slate-700">
                        Look up a different solicitation
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-slate-400">
                      Free account, no credit card, free forever. Basic includes 1 Award Autopsy/month — the
                      first one is yours free.
                    </p>
                  </div>
                </>
              ) : (
                <div className="mt-3 text-sm text-slate-600">
                  <p>{preview.fallbackMessage}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    The lookup uses the title, agency, and NAICS you entered. Try a more specific title or
                    add the NAICS code — or{" "}
                    <button onClick={reset} className="underline hover:text-slate-600">start over</button>.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 6→7: the gifted COMPLETE report (post-signup) */}
        {gift && (
          <div className="mt-8">
            {gift.delivered && gift.autopsy && (
              <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-900">⚖ Your complete Award Autopsy</h2>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    Your free first autopsy — complete
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">You bid</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{fmtMoney(gift.autopsy.youBid)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winner</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{gift.autopsy.winner}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winning amount</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{fmtMoney(gift.autopsy.winningAmount)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Difference</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {gift.autopsy.difference != null && gift.autopsy.differencePct != null
                        ? `${fmtMoney(Math.abs(gift.autopsy.difference))} / ${Math.abs(gift.autopsy.differencePct).toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incumbent</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {gift.autopsy.winner}
                      {gift.autopsy.incumbentRetained != null
                        ? gift.autopsy.incumbentRetained
                          ? " · Incumbent retained contract: Yes"
                          : " · Incumbent retained contract: No"
                        : " · Incumbent retained contract: not disclosed"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Competition</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {gift.autopsy.competition != null
                        ? `${gift.autopsy.competition} offers received`
                        : "Competition: not disclosed"}
                    </p>
                  </div>
                </div>

                {gift.autopsy.findings.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-slate-800">What probably hurt you</h3>
                    <div className="mt-2 space-y-2">
                      {gift.autopsy.findings.map((f, i) => (
                        <div key={i} className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
                          {f.emoji} {f.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {gift.autopsy.recommendation && (
                  <div className="mt-5 rounded-xl bg-amber-50 p-4">
                    <p className="text-sm font-bold text-amber-900">Contrax recommendation</p>
                    <p className="mt-1 text-sm text-amber-800">{gift.autopsy.recommendation}</p>
                  </div>
                )}

                {gift.autopsy.historicalPricing.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Historical awards — this agency &amp; NAICS
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {gift.autopsy.historicalPricing.map((h) => (
                        <span key={h.fiscal_year} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                          FY{h.fiscal_year}: {fmtMoney(h.total_obligated)} across {h.award_count} award
                          {h.award_count === 1 ? "" : "s"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stage 8 — Radar cross-sell card (retention handoff) */}
                <div className="mt-6 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-5">
                  <h3 className="text-base font-bold text-slate-900">Ready for the next opportunity?</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Radar found contracts matching your business. Find your next contract before the
                    competition does.
                  </p>
                  <a
                    href="/radar"
                    onClick={() => trackEvent("autopsy_radar_cta", "autopsy_funnel", "/autopsy")}
                    className="mt-3 inline-block rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-700"
                  >
                    Find my next contract →
                  </a>
                </div>
              </div>
            )}

            {!gift.delivered && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <h2 className="text-lg font-bold text-slate-900">⚖ Award Autopsy</h2>
                {gift.autopsy && !gift.autopsy.found ? (
                  <p className="mt-3 text-sm text-slate-600">{gift.autopsy.fallbackMessage}</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">{gift.reason}</p>
                )}
                <div className="mt-4 flex gap-3">
                  <button onClick={reset} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400">
                    Try another solicitation
                  </button>
                  <a href="/losses" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                    Log a lost bid on /losses
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quiet footer */}
        <p className="mt-10 text-center text-xs text-slate-400">
          Award data comes from USAspending.gov (public federal contract data). Everything shown is real —
          competition counts are shown only when a source provides them.
        </p>
      </main>
    </div>
  );
}