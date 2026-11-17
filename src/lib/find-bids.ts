/** Words → one case-insensitive title pattern for the read-only find-bids job. PURE. */
export function findBidsPattern(words: string): string | null {
  const list = words.split(",").map((w) => w.trim().toLowerCase().replace(/[^a-z0-9 &/-]/g, "")).filter((w) => w.length >= 3).slice(0, 20);
  return list.length ? `(${list.map((w) => w.replace(/[/-]/g, "\\$&").replace(/ +/g, "[[:space:]]+")).join("|")})` : null;
}
