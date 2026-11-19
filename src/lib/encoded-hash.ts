/**
 * Some email programs and link scanners turn the "#" in a link into "%23", so
 * "/federal-construction-by-state#list" arrives as the path "/federal-construction-by-state%23list",
 * which is no page at all (2026-11-19: a visitor from an emailed link landed on an error). This
 * returns where such a request should be sent, or null when the path is fine. PURE.
 */
export function encodedHashTarget(pathname: string, search: string = ""): string | null {
  const i = pathname.toLowerCase().indexOf("%23");
  if (i <= 0) return null;
  const path = pathname.slice(0, i);
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/api/")) return null;
  const section = pathname.slice(i + 3);
  // Only a plain section name is carried over; anything else is dropped and the page itself opens.
  const hash = /^[A-Za-z0-9_-]{1,60}$/.test(section) ? `#${section}` : "";
  return `${path}${search}${hash}`;
}
