/** Compact labels fit tracking-intake's 128-character limit. Never store URL
 * queries, fragments, credentials, or email addresses in outbound metadata. */
export type SubcontractSource = "SBA directory" | "GSA directory" | "DOT directory" | "USAspending" | "SBA SUBNet";
const SOURCES: readonly string[] = ["SBA directory", "GSA directory", "DOT directory", "USAspending", "SBA SUBNet"];

export function subcontractOutboundLabel(source: SubcontractSource, listing: string, href: string): string | null {
  try {
    const url = new URL(href);
    if (!SOURCES.includes(source) || !["https:", "http:"].includes(url.protocol)) return null;
    const name = listing.replace(/[|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 56) || source;
    return `outbound|${source}|${name}|${url.hostname.slice(0, 40)}`;
  } catch {
    return null;
  }
}

/** Legacy events retain their existing label; only our bounded metadata is expanded. */
export function subcontractOutboundTimelineLabel(event: string, label: unknown): string | null {
  if (event !== "subcontract_source_open" || typeof label !== "string" || label.length > 128) return null;
  const parts = label.split("|");
  if (parts.length !== 4 || parts[0] !== "outbound" || !SOURCES.includes(parts[1]) || !parts[2] || !parts[3]) return null;
  return `Opened ${parts[1]}: ${parts[2]} → ${parts[3]}`;
}
