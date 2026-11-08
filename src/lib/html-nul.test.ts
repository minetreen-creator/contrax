import { describe, expect, test } from "bun:test";
import { escapeNulBytes, withoutHtmlNulls } from "./html-nul";

// Owner 2026-11-08: page fetchers saw the homepage as unreadable; the cause was raw NUL characters
// in the router's dehydration script.
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("NUL bytes out of HTML", () => {
  test("each NUL becomes the \\u0000 escape; the JavaScript value is unchanged", () => {
    const src = 'matches:[{i:"__root__\u0000",u:1},{i:"\u0000\u0000",u:2}]';
    const out = dec(escapeNulBytes(enc(src)));
    expect(out).toBe('matches:[{i:"__root__\\u0000",u:1},{i:"\\u0000\\u0000",u:2}]');
    expect(out.includes("\u0000")).toBe(false);
    // Same values once parsed as JavaScript.
    expect(new Function(`return [${out.slice(8)}]`)()).toEqual(new Function(`return [${src.slice(8)}]`)());
  });

  test("text without NULs, and multi-byte characters, pass through untouched", () => {
    const b = enc("Café — 29,702 bids ✓");
    expect(escapeNulBytes(b)).toBe(b);
    expect(dec(escapeNulBytes(enc("é\u0000✓")))).toBe("é\\u0000✓");
  });

  test("only HTML responses are rewritten, streamed, without a stale content-length", async () => {
    const html = withoutHtmlNulls(new Response('<script>x="\u0000"</script>', { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-length": "22" } }));
    expect(await html.text()).toBe('<script>x="\\u0000"</script>');
    expect(html.headers.get("content-length")).toBeNull();
    expect(html.status).toBe(200);
    const json = new Response('{"a":"\u0000"}', { headers: { "content-type": "application/json" } });
    expect(withoutHtmlNulls(json)).toBe(json);
  });
});
