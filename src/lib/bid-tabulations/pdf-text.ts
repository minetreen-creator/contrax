/**
 * BID TABULATIONS — a NO-DEPENDENCY PDF text extractor.
 *
 * WHY THIS EXISTS. Phase 1 of bid tabulations reads ALDOT's per-letting
 * "Tabulation of Bids" PDFs (owner-picked source, 2026-10-09). The repo has no
 * PDF library and this PR must not add one, so the extraction is done here:
 * inflate each content stream (node:zlib) and read the text-showing operators.
 *
 * WHY IT IS POSITION-AWARE (and not a naive string scrape). A bid tabulation is
 * a TABLE: the bidder names sit in one header row and each bidder's money sits in
 * that bidder's COLUMN. A naive "collect every (string) in stream order" scrape
 * of ALDOT's PDF emits the totals row RIGHT-TO-LEFT, which would attach the wrong
 * amount to the wrong bidder — the exact failure mode that makes a price surface
 * dishonest. So every shown string is recorded with its text-space position, and
 * the output is grouped into LINES (same y) and ordered left-to-right by x.
 *
 * SCOPE / HONESTY OF THE APPROXIMATION:
 *   - `Tj` strings are placed at the current text-line origin; a whole table cell
 *     is one `Tj` in the sources we read, so the origin IS the cell's x.
 *   - `TD`/`Td`/`T*`/`Tm` update the text line matrix; `TJ` arrays concatenate.
 *   - The glyph-advance model is deliberately crude (a fixed per-character
 *     estimate) and is used ONLY to keep several strings shown on the SAME line
 *     in the order the publisher drew them. It is never used to decide which
 *     COLUMN a number belongs to — the caller matches columns on the concrete x
 *     of the header cell, and every parsed amount is otherwise parse-or-NULL.
 *   - Encodings: the PDFs use WinAnsi-style single-byte fonts; custom
 *     `/Differences` encodings and Type0/CID fonts are NOT decoded. A document
 *     that needs them simply yields little text, which the caller reads as the
 *     scanned/unextractable case rather than guessing.
 */
import { inflateSync, inflateRawSync } from "node:zlib";

/** One text-showing operation, at its position in the page's text space. */
export interface PdfTextItem {
  /** Page number (1-based, in content-stream order). */
  page: number;
  /** Text-space x of the item's origin. */
  x: number;
  /** Text-space y of the item's origin (grows upward in PDF space). */
  y: number;
  /** Font size in effect (used only for the intra-line advance estimate). */
  size: number;
  text: string;
}

/** Several items the publisher drew on one baseline, joined left-to-right. */
export interface PdfTextLine {
  page: number;
  y: number;
  text: string;
  items: PdfTextItem[];
}

/** Decode the printable text of a PDF, one line per extracted baseline. */
export function extractPdfLines(bytes: Uint8Array): PdfTextLine[] {
  const items: PdfTextItem[] = [];
  const streams = contentStreams(bytes);
  streams.forEach((content, index) => {
    items.push(...readContentStream(content, index + 1));
  });
  const byPage = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const list = byPage.get(item.page) ?? [];
    list.push(item);
    byPage.set(item.page, list);
  }
  const lines: PdfTextLine[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageItems = byPage.get(page)!;
    // Group by baseline. PDF rows are a few units apart at most; 2 units is
    // below a printed line-height and above the jitter between sibling cells.
    const groups: PdfTextItem[][] = [];
    for (const item of [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(last[0]!.y - item.y) <= 2) last.push(item);
      else groups.push([item]);
    }
    for (const group of groups) {
      const ordered = [...group].sort((a, b) => a.x - b.x);
      const text = joinRow(ordered);
      if (text) lines.push({ page, y: ordered[0]!.y, text, items: ordered });
    }
  }
  return lines;
}

/** The same content as plain text, one line per extracted baseline. */
export function extractPdfText(bytes: Uint8Array): string {
  return extractPdfLines(bytes)
    .map((l) => l.text)
    .join("\n");
}

/** Join the items of one baseline, inserting a space across a visible gap. */
function joinRow(items: PdfTextItem[]): string {
  let out = "";
  let cursor: number | null = null;
  for (const item of items) {
    if (cursor !== null && item.x - cursor > item.size * 0.25) out += " ";
    out += item.text;
    cursor = item.x + item.size * 0.5 * item.text.length;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Every decoded content stream, in document order. A stream is kept when it
 * inflates (or is already plain) AND looks like a content stream — a page's
 * drawing instructions always contain a text-showing operator.
 */
export function contentStreams(bytes: Uint8Array): string[] {
  const latin = latin1(bytes);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) continue;
    const raw = bytes.subarray(start, end);
    const decoded = tryInflate(raw);
    if (decoded === null) continue;
    if (!/\bT[Jj]\b/.test(decoded)) continue;
    out.push(decoded);
    re.lastIndex = end;
  }
  return out;
}

function tryInflate(raw: Uint8Array): string | null {
  // `maxOutputLength` bounds a decompression bomb: an image-heavy tabulation can
  // carry streams far larger inflated than on disk, and this reader runs inside
  // the web app's own process.
  const LIMIT = 24 * 1024 * 1024;
  for (const attempt of [inflateSync, inflateRawSync]) {
    try {
      return latin1(attempt(raw, { maxOutputLength: LIMIT }));
    } catch {
      /* try the next framing */
    }
  }
  // An uncompressed content stream is legal; accept it if it looks textual.
  const plain = latin1(raw);
  return /\bT[Jj]\b/.test(plain) ? plain : null;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

type Operand = { kind: "str"; value: string } | { kind: "num"; value: number } | { kind: "op"; value: string };

/** Interpret one content stream into positioned text items. */
function readContentStream(content: string, page: number): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  // Text matrix / line matrix, as [a b c d e f] with e,f the translation.
  let tm = { e: 0, f: 0 };
  let tlm = { e: 0, f: 0 };
  let leading = 0;
  let size = 12;
  let charSpace = 0;
  let wordSpace = 0;
  let horScale = 1;
  let pending: Operand[] = [];

  const advance = (text: string) => {
    // Crude but order-preserving: only used to keep same-baseline strings in the
    // publisher's own left-to-right order.
    const chars = text.length;
    return (size * 0.5 * chars + charSpace * chars) * (horScale / 100);
  };
  const show = (text: string) => {
    if (text.trim()) items.push({ page, x: tm.e, y: tm.f, size, text });
    tm = { e: tm.e + advance(text), f: tm.f };
  };

  for (const token of tokenize(content)) {
    if (token.kind !== "op") {
      pending.push(token);
      continue;
    }
    const op = token.value;
    const nums = pending.filter((p) => p.kind === "num").map((p) => (p as { value: number }).value);
    const strs = pending.filter((p) => p.kind === "str").map((p) => (p as { value: string }).value);
    switch (op) {
      case "BT":
        tm = { e: 0, f: 0 };
        tlm = { e: 0, f: 0 };
        break;
      case "Tf":
        if (nums.length) size = Math.abs(nums[nums.length - 1]!);
        break;
      case "TL":
        if (nums.length) leading = nums[nums.length - 1]!;
        break;
      case "Tc":
        if (nums.length) charSpace = nums[nums.length - 1]!;
        break;
      case "Tw":
        if (nums.length) wordSpace = nums[nums.length - 1]!;
        break;
      case "Tz":
        if (nums.length) horScale = nums[nums.length - 1]!;
        break;
      case "Tm":
        if (nums.length >= 6) {
          tlm = { e: nums[nums.length - 2]!, f: nums[nums.length - 1]! };
          tm = { ...tlm };
        }
        break;
      case "Td":
        if (nums.length >= 2) {
          tlm = { e: tlm.e + nums[nums.length - 2]!, f: tlm.f + nums[nums.length - 1]! };
          tm = { ...tlm };
        }
        break;
      case "TD":
        if (nums.length >= 2) {
          leading = -nums[nums.length - 1]!;
          tlm = { e: tlm.e + nums[nums.length - 2]!, f: tlm.f + nums[nums.length - 1]! };
          tm = { ...tlm };
        }
        break;
      case "T*":
        tlm = { e: tlm.e, f: tlm.f - leading };
        tm = { ...tlm };
        break;
      case "Tj":
        for (const s of strs) show(s);
        break;
      case "TJ":
        for (const s of strs) show(s);
        break;
      case "'":
        tlm = { e: tlm.e, f: tlm.f - leading };
        tm = { ...tlm };
        for (const s of strs) show(s);
        break;
      case '"':
        wordSpace = nums.length >= 3 ? nums[nums.length - 3]! : wordSpace;
        charSpace = nums.length >= 2 ? nums[nums.length - 2]! : charSpace;
        tlm = { e: tlm.e, f: tlm.f - leading };
        tm = { ...tlm };
        for (const s of strs) show(s);
        break;
      default:
        break;
    }
    pending = [];
  }
  return items;
}

/** Minimal content-stream tokenizer: literal strings, numbers and operators. */
function tokenize(content: string): Operand[] {
  const out: Operand[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i]!;
    if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0") {
      i += 1;
      continue;
    }
    if (c === "%") {
      while (i < n && content[i] !== "\n") i += 1;
      continue;
    }
    if (c === "(") {
      const [value, next] = readLiteralString(content, i);
      out.push({ kind: "str", value });
      i = next;
      continue;
    }
    if (c === "<") {
      if (content[i + 1] === "<") {
        i = skipDictionary(content, i);
        continue;
      }
      const close = content.indexOf(">", i);
      out.push({ kind: "str", value: decodeHexString(content.slice(i + 1, close < 0 ? n : close)) });
      i = close < 0 ? n : close + 1;
      continue;
    }
    if (c === "[" || c === "]") {
      i += 1;
      continue;
    }
    if (c === "/") {
      i += 1;
      while (i < n && !isDelimiter(content[i]!)) i += 1;
      continue;
    }
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(content[j]!) && !(j > i && (content[j] === "+" || content[j] === "-") && content[j - 1] !== "e" && content[j - 1] !== "E")) {
        j += 1;
      }
      const num = Number(content.slice(i, j));
      out.push({ kind: "num", value: Number.isFinite(num) ? num : 0 });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      out.push({ kind: "op", value: c });
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !isDelimiter(content[j]!)) j += 1;
    // A bare delimiter we do not model (`>`, `{`, `}`) must still advance, or the
    // scanner spins forever on the first `>>` an inline dictionary leaves behind.
    if (j === i) {
      i += 1;
      continue;
    }
    out.push({ kind: "op", value: content.slice(i, j) });
    i = j;
  }
  return out;
}

function isDelimiter(c: string): boolean {
  return (
    c === " " ||
    c === "\n" ||
    c === "\r" ||
    c === "\t" ||
    c === "\f" ||
    c === "\0" ||
    c === "(" ||
    c === ")" ||
    c === "<" ||
    c === ">" ||
    c === "[" ||
    c === "]" ||
    c === "{" ||
    c === "}" ||
    c === "/" ||
    c === "%"
  );
}

function readLiteralString(content: string, start: number): [string, number] {
  let i = start + 1;
  let depth = 1;
  let out = "";
  const n = content.length;
  while (i < n) {
    const c = content[i]!;
    if (c === "\\") {
      const e = content[i + 1];
      i += 2;
      switch (e) {
        case "n": out += "\n"; break;
        case "r": out += "\r"; break;
        case "t": out += "\t"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "(": out += "("; break;
        case ")": out += ")"; break;
        case "\\": out += "\\"; break;
        case "\n": break;
        case "\r": if (content[i] === "\n") i += 1; break;
        default:
          if (e !== undefined && e >= "0" && e <= "7") {
            const octal = content.slice(i - 1, i + 2).match(/^[0-7]{1,3}/)![0];
            out += String.fromCharCode(parseInt(octal, 8));
            i += octal.length - 1;
          } else if (e !== undefined) {
            out += e;
          }
          break;
      }
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") {
      depth -= 1;
      if (depth === 0) return [out, i + 1];
    }
    out += c;
    i += 1;
  }
  return [out, n];
}

function skipDictionary(content: string, start: number): number {
  let i = start + 2;
  let depth = 1;
  const n = content.length;
  while (i < n && depth > 0) {
    const c = content[i]!;
    if (c === "<" && content[i + 1] === "<") {
      depth += 1;
      i += 2;
      continue;
    }
    if (c === ">" && content[i + 1] === ">") {
      depth -= 1;
      i += 2;
      continue;
    }
    if (c === "(") {
      const [, next] = readLiteralString(content, i);
      i = next;
      continue;
    }
    i += 1;
  }
  return i;
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}
