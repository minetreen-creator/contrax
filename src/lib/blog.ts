// Shared logic for the Contrax blog: frontmatter parsing, a tiny
// markdown-to-HTML renderer, read-time estimation, and the post registry.
//
// Posts are imported as raw text (?raw) so the content ships inside the
// server/client bundles — the pages work on any host (Vercel lambda included)
// with no filesystem access at runtime. Add a new post by dropping a .md file
// into src/content/blog/ and registering it in RAW_POSTS below.

import findSetAside from "../content/blog/find-set-aside-contracts.md?raw";
import eightACertification from "../content/blog/8a-certification-guide.md?raw";
import proposalTips from "../content/blog/proposal-writing-tips.md?raw";
import sdvosbContracts from "../content/blog/sdvosb-government-contracts.md?raw";
import samGovGuide from "../content/blog/sam-gov-registration-guide.md?raw";
import beginnersGuide from "../content/blog/government-contracting-beginners.md?raw";
import samGovVsContrax from "../content/blog/sam-gov-vs-contrax.md?raw";
import contractTeardown from "../content/blog/contract-teardown-set-aside-rfp.md?raw";
import hubzoneWorthIt from "../content/blog/hubzone-certification-worth-it.md?raw";

export type BlogPost = {
  slug: string;
  title: string;
  /** ISO date, e.g. "2026-08-05". */
  date: string;
  excerpt: string;
  tags: string[];
  readMinutes: number;
  /** Raw markdown body (frontmatter stripped). */
  body: string;
  /** Body rendered to HTML. */
  html: string;
};

type Frontmatter = {
  title?: string;
  date?: string;
  excerpt?: string;
  tags?: string;
};

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const frontmatter: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    frontmatter[line.slice(0, idx).trim() as keyof Frontmatter] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body: raw.slice(match[0].length) };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  let html = escapeHtml(text);
  // [label](url) links first, so their markup isn't touched by escaping.
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

/** Minimal markdown → HTML: #/##/### headings, - and 1. lists, paragraphs, **bold**, [links](url). */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const rawLine of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      closeList();
      out.push(`<h3>${renderInline(h3[1])}</h3>`);
      continue;
    }
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      closeList();
      out.push(`<h2>${renderInline(h2[1])}</h2>`);
      continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      closeList();
      out.push(`<h1>${renderInline(h1[1])}</h1>`);
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function readMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

const RAW_POSTS: { slug: string; raw: string }[] = [
  { slug: "find-set-aside-contracts", raw: findSetAside },
  { slug: "8a-certification-guide", raw: eightACertification },
  { slug: "proposal-writing-tips", raw: proposalTips },
  { slug: "sdvosb-government-contracts", raw: sdvosbContracts },
  { slug: "sam-gov-registration-guide", raw: samGovGuide },
  { slug: "government-contracting-beginners", raw: beginnersGuide },
  { slug: "sam-gov-vs-contrax", raw: samGovVsContrax },
  { slug: "contract-teardown-set-aside-rfp", raw: contractTeardown },
  { slug: "hubzone-certification-worth-it", raw: hubzoneWorthIt },
];

export const BLOG_POSTS: BlogPost[] = RAW_POSTS.map(({ slug, raw }) => {
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    slug,
    title: frontmatter.title ?? slug,
    date: frontmatter.date ?? "",
    excerpt: frontmatter.excerpt ?? "",
    tags: (frontmatter.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    readMinutes: readMinutes(body),
    body,
    html: renderMarkdown(body),
  };
}).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function formatBlogDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
