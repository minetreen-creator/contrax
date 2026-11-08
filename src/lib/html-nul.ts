/**
 * Null characters out of server-rendered HTML (owner 2026-11-08: "automated page-fetchers currently
 * receive an inaccessible response on the root domain").
 *
 * The router's dehydration script writes its internal match ids with raw NUL (U+0000) separators
 * inside JavaScript string literals ({i:"__root__\0"}). Browsers and Googlebot don't mind, but many
 * simple fetchers (and some AI assistants' page readers) treat any response containing a NUL byte as
 * binary and refuse to read it. Rewriting each NUL byte as the 6-character JavaScript escape
 * \u0000 leaves every string's value identical and makes the page plain text.
 *
 * Byte-level is safe: in UTF-8 a 0x00 byte only ever encodes U+0000 itself, never part of another
 * character.
 */
const ESCAPED = new TextEncoder().encode("\\u0000");

/** Replace every 0x00 byte with the bytes of `\u0000`. PURE. */
export function escapeNulBytes(chunk: Uint8Array): Uint8Array {
  let count = 0;
  for (let i = 0; i < chunk.length; i++) if (chunk[i] === 0) count++;
  if (count === 0) return chunk;
  const out = new Uint8Array(chunk.length + count * (ESCAPED.length - 1));
  let o = 0;
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === 0) {
      out.set(ESCAPED, o);
      o += ESCAPED.length;
    } else {
      out[o++] = chunk[i];
    }
  }
  return out;
}

/** An HTML response with its NUL bytes escaped (streamed); any other response untouched. */
export function withoutHtmlNulls(res: Response): Response {
  const type = res.headers.get("content-type") ?? "";
  if (!res.body || !/text\/html/i.test(type) || res.headers.get("content-encoding")) return res;
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(escapeNulBytes(chunk));
      },
    }),
  );
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}
