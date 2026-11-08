/**
 * Text made ready to be spoken (owner 2026-11-08: "the mission control voice … doesn't pronounce
 * state names"). Voices read "Hampton, VA" as "Hampton, V A"; this spells the state out:
 * "Hampton, Virginia". Only a state code that follows a comma ("Hampton, VA") or a place word
 * ("in VA", "from VA") is spelled out, so "VA hospital" (Veterans Affairs) or an "ID" stay as they
 * are. PURE, browser-safe.
 */
import { STATE_CODE_TO_NAME } from "~/lib/location-state";

const CODE = "([A-Z]{2})";
// A place name right before the comma ("Hampton, VA"), and not a question ("…, OK?").
const AFTER_COMMA = new RegExp(`([A-Z][a-z]+\\.?)(,\\s*)${CODE}(?=$|[\\s.,;:!)\\]])`, "g");
const AFTER_WORD = new RegExp(`\\b(in|from|near|across|around)(\\s+)${CODE}(?=$|[\\s.,;:!)\\]])`, "g");

export function speakable(text: string): string {
  const name = (code: string) => STATE_CODE_TO_NAME[code];
  return text
    .replace(AFTER_COMMA, (m, place: string, lead: string, code: string) => (name(code) ? `${place}${lead}${name(code)}` : m))
    .replace(AFTER_WORD, (m, word: string, gap: string, code: string) => (name(code) ? `${word}${gap}${name(code)}` : m));
}
