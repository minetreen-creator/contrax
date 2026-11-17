import { STATE_NAMES } from "~/lib/contract-map";

/**
 * Two-letter state codes that are also ordinary words or agency names ("for the VA", "Phase IN",
 * "and/OR"). They count only after a comma ("Richmond, VA"), never bare at the end of a title.
 */
const AMBIGUOUS_BARE = new Set(["VA", "IN", "OR", "ME", "OK", "HI", "MA", "PA", "ID", "AL", "DE", "CO", "LA", "MD", "MS", "NE", "OH"]);

/**
 * The place a federal title names itself (owner 2026-11-17: 19 of 32 open federal janitorial notices
 * still said only "United States" though titles read "Janitorial Services Wichita, KS" or
 * "Base+4 - Florence SC"). Used only when the notice gives no place of performance.
 *
 *  - "City, ST" anywhere in the title, ST an upper-case state code;
 *  - "City ST" at the very end of the title, for codes that are not also ordinary words.
 *
 * Returns "City, ST", or null when the title names no state or names two different ones.
 */
export function titlePlace(title: string | null | undefined): string | null {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const allCaps = !/[a-z]/.test(t);
  const found: { city: string; code: string }[] = [];
  const city = "((?:[A-Z][A-Za-z.'’]*)(?: [A-Z][A-Za-z.'’]*){0,2})";
  const comma = new RegExp(`${city}, ?([A-Z]{2})(?=$|[\\s,.;)\\]/-])`, "g");
  let m: RegExpExecArray | null;
  while ((m = comma.exec(t)) !== null) {
    // An all-capitals title makes "REPAIR, OR REPLACE" look like Oregon: word-like codes need mixed case.
    if (STATE_NAMES[m[2]] && !(allCaps && AMBIGUOUS_BARE.has(m[2]))) found.push({ city: m[1], code: m[2] });
  }
  if (found.length === 0) {
    const end = new RegExp(`${city} ([A-Z]{2})$`).exec(t);
    if (end && STATE_NAMES[end[2]] && !AMBIGUOUS_BARE.has(end[2])) found.push({ city: end[1], code: end[2] });
  }
  if (found.length === 0) return null;
  if (new Set(found.map((f) => f.code)).size > 1) return null;
  const { city: c, code } = found[0];
  // Leading service words swallowed by the city pattern ("Janitorial Services Wichita") are dropped:
  // keep the last word, or the last two when the first is a place prefix ("Rapid City", "Fort Wayne").
  const words = c.split(" ");
  const last = words[words.length - 1];
  const prev = words[words.length - 2];
  const two = /^(?:City|Falls|Beach|Springs|Rapids|Island|Junction|Lake|Park|Rock|Bay|Hill|Point|Valley|Heights)$/i.test(last) ||
    /^(?:Fort|Ft\.?|New|San|Santa|Los|Las|St\.?|Saint|Mount|Mt\.?|Port|El|West|East|North|South|Grand|Rapid|Sioux|Key|Cape|Camp|Lake|Salt|Des|Baton|Corpus|Colorado|Little|Kansas|Oklahoma|Jersey|Virginia|Long|Palm|Red|Big|Great|Green|White|Black)$/i.test(prev ?? "");
  const name = two && prev ? `${prev} ${last}` : last;
  return `${name}, ${code}`;
}
