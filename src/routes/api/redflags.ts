import { createFileRoute } from "@tanstack/react-router";
import { PAGE_MARK, scanRedFlags, type RedFlag } from "~/lib/red-flags";

/**
 * POST /api/redflags — scan a solicitation for red flags (owner 2026-11-08).
 * Body: multipart form with `file` (PDF or .txt), or JSON { text }.
 *
 * Everyone sees which red flags were found, how many times, and why they matter. The quoted
 * sentences (with page numbers) are for paid members; a free viewer gets one quoted sentence as a
 * sample. The document is read in memory and never stored.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 400;
const MAX_TEXT = 2_000_000;

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > MAX_PAGES) throw new Error(`That PDF has ${pdf.numPages} pages; the scanner reads up to ${MAX_PAGES}.`);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text as string[];
  return { text: pages.join(PAGE_MARK), pages: pages.length };
}

async function handler({ request }: { request: Request }) {
  try {
    const { checkIpLimit } = await import("~/lib/rate-limit");
    const limit = await checkIpLimit(request, "redflags", 20, 3600);
    if (!limit.allowed) return Response.json({ error: "That's a lot of scans. Try again in a little while." }, { status: 429 });

    let text = "";
    let pages = 0;
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Choose a PDF or text file." }, { status: 400 });
      if (file.size > MAX_BYTES) return Response.json({ error: "That file is over 15 MB." }, { status: 413 });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name) || new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
      if (isPdf) ({ text, pages } = await pdfText(bytes));
      else text = new TextDecoder().decode(bytes);
    } else {
      const body = (await request.json().catch(() => ({}))) as { text?: unknown };
      text = String(body.text ?? "");
    }
    text = text.slice(0, MAX_TEXT);
    if (text.replace(/\s/g, "").length < 40) {
      return Response.json({ error: pages ? "No readable text in that PDF (it may be a scanned image)." : "Paste more of the solicitation text." }, { status: 400 });
    }

    const flags = scanRedFlags(text);
    const { getUserFromRequest } = await import("~/lib/api-auth");
    const { hasPaidBidAccess } = await import("~/lib/head-start.server");
    const paid = await hasPaidBidAccess(await getUserFromRequest(request));
    // Free: every flag's label, count and reason; one quoted sentence in total as a sample.
    const shown: RedFlag[] = paid ? flags : flags.map((f, i) => ({ ...f, snippets: i === 0 ? f.snippets.slice(0, 1) : [] }));
    return Response.json(
      { flags: shown, paid, pages, words: text.split(/\s+/).filter(Boolean).length },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const msg = (err as Error).message ?? "";
    console.error("[api/redflags] scan failed:", msg.slice(0, 200));
    return Response.json({ error: /pages; the scanner/.test(msg) ? msg : "Couldn't read that file. Try a different PDF, or paste the text." }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/redflags")({
  server: { handlers: { POST: handler } },
});
