/**
 * Date check on Max's answers (owner 2026-11-09: "date accuracy … a top priority"; citations were
 * dropped at the owner's request). Every calendar date Max says must match a due date the lookups
 * returned, a date written in the data Max was given (a pre-bid meeting, a question deadline), or
 * today. A date that matches none is corrected in the answer before anyone sees it. PURE.
 */

export type MaxLangCode = "en" | "es" | "zh";

export interface MaxEvidence {
  /** Due dates (YYYY-MM-DD) of the bids the lookups returned. */
  dueDates: string[];
  /** Everything the lookups returned, as the model saw it. */
  text: string;
}

export interface DateCheck {
  status: "ok" | "corrected" | "none";
  /** The single bid's due date when the answer is about one bid. */
  due: string | null;
  /** Dates Max said that matched nothing. */
  mismatches: string[];
}

const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ES_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface FoundDate {
  month: number;
  day: number;
  year: number | null;
  raw: string;
}

/** Calendar dates written in English, Spanish, Chinese or as 12/7(/2026). PURE. */
export function extractDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const t = String(text ?? "");
  const push = (month: number, day: number, year: string | undefined, raw: string) => {
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push({ month, day, year: year ? Number(year) : null, raw });
  };
  // December 7, 2026 · Dec. 7th · Sept 7
  const en = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  for (const m of t.matchAll(en)) push(EN_MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]), m[3], m[0]);
  // Mon Dec 07 2026 (the lookups' own format) is covered above; 7 December 2026
  const enDayFirst = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b,?(?:\s+(\d{4}))?/gi;
  for (const m of t.matchAll(enDayFirst)) push(EN_MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, Number(m[1]), m[3], m[0]);
  // 7 de diciembre (de 2026)
  const es = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${ES_MONTHS.join("|")})(?:\\s+(?:de|del)\\s+(\\d{4}))?`, "gi");
  for (const m of t.matchAll(es)) push(ES_MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]), m[3], m[0]);
  // 2026年12月7日 · 12月7日
  for (const m of t.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g)) push(Number(m[2]), Number(m[3]), m[1], m[0]);
  // 12/7/2026 (the year is required: "1/2 acre" is not a date)
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) push(Number(m[1]), Number(m[2]), m[3], m[0]);
  // 2026-12-07 (also inside 2026-12-07T20:00:00Z)
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) push(Number(m[2]), Number(m[3]), m[1], m[0]);
  return out;
}

function sameDay(a: FoundDate, b: FoundDate): boolean {
  return a.month === b.month && a.day === b.day && (a.year === null || b.year === null || a.year === b.year);
}

function fromIso(d: string): FoundDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), raw: d } : null;
}

export function dueLabel(isoDate: string, lang: MaxLangCode): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (lang === "zh") return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  if (lang === "es") return `${d.getUTCDate()} de ${ES_MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Check the dates in Max's answer against the evidence. PURE. */
export function checkMaxDates(say: string, ev: MaxEvidence, today: Date = new Date()): DateCheck {
  const said = extractDates(say);
  const dues = [...new Set(ev.dueDates.map((d) => d.slice(0, 10)))];
  const due = dues.length === 1 ? dues[0] : null;
  if (!said.length) return { status: "none", due, mismatches: [] };
  const allowed: FoundDate[] = [...dues.map(fromIso).filter((d): d is FoundDate => d !== null), ...extractDates(ev.text)];
  const t = { month: today.getUTCMonth() + 1, day: today.getUTCDate(), year: today.getUTCFullYear(), raw: "today" };
  allowed.push(t);
  const mismatches = said.filter((s) => !allowed.some((a) => sameDay(s, a))).map((s) => s.raw);
  return { status: mismatches.length ? "corrected" : "ok", due, mismatches: [...new Set(mismatches)] };
}

/** The sentence added to an answer whose date matched nothing. PURE. */
export function dateCorrection(check: DateCheck, lang: MaxLangCode): string {
  if (check.status !== "corrected") return "";
  if (check.due) {
    const d = dueLabel(check.due, lang);
    return lang === "es"
      ? ` Corrección: según el aviso, la fecha límite es el ${d}.`
      : lang === "zh"
        ? ` 更正：根据公告，截止日期是${d}。`
        : ` Correction: the notice lists the due date as ${d}.`;
  }
  return lang === "es"
    ? " Revisa las fechas en las tarjetas de abajo: vienen directo de cada aviso."
    : lang === "zh"
      ? " 请以下方卡片上的日期为准：它们直接来自每份公告。"
      : " Check the due dates on the cards below: they come straight from each notice.";
}
