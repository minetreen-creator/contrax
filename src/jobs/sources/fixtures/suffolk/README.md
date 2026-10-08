# City of Suffolk bid-board fixtures (`va_suffolk`)

PROVENANCE — captured 2026-10-08 from `https://www.suffolkva.us/bids.aspx` with a bare `GET` (no query
params, no cookies) and exactly these request headers:
* `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
* `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`

| File | What it is | as-fetched bytes | as-fetched sha256 | committed bytes | committed sha256 |
|---|---|---|---|---|---|
| `suffolk-open-2026-10-08-fetch1.html` | verbatim open-board response, fetch 1 (the parse fixture) | 129879 | `3a4c84a8f55821d63658f1c76abc8fa1a708719d13205a6c40e31312876d9750` | 129887 | `7941209c70e5e85aef1dd3d1ec3e35848e95656a5655646bb6e67092f4c33661` |
| `suffolk-open-2026-10-08-fetch2.html` | verbatim open-board response, fetch 2 (stability cross-check) | 129879 | `4c6dd5d0c3a4f16b379e312bbae8b6bf39012a1bd4bde6c1912c882947e2bfe2` | 129887 | `31f228c5b95a32694f2d96217ccc358f646433902ce35c9213fdd9b552dec43b` |
| `suffolk-query-param-all-2026-10-08.html` | the `?showAllBids=true&Status=all` trap response | 109182 | `f99ed700d8ec9911d56ef5ebbe3e9f2288ba725181d5bc9d301e363dc13843e5` | 109190 | `fd9e072c6eaee965e3546f5c5f0f4b8f97248b2c44a3c4372d8e9699090e1a04` |

## PII redaction — the ONLY edit made to the as-fetched bytes

* `suffolk-open-2026-10-08-fetch1.html`: emails none; phone numbers ['757-514-4000']; values redacted → none / ['757-514-4000'].
* `suffolk-open-2026-10-08-fetch2.html`: emails none; phone numbers ['757-514-4000']; values redacted → none / ['757-514-4000'].
* `suffolk-query-param-all-2026-10-08.html`: emails none; phone numbers ['757-514-4000']; values redacted → none / ['757-514-4000'].

No redacted value falls inside the parsed item region (`piiInsideParseRegion` is empty
for every file), and the parse fingerprint of every file is byte-for-byte IDENTICAL
before and after redaction — that is asserted by the fixture-prep script and again by
the test suite. `listserv@civicplus.com` is the platform's own generic mailing-list
address (CivicPlus boilerplate, not personal data) and is deliberately left verbatim.

## The trap response (why the BARE URL is the only request)

On Dayton the same query-param URL answers **HTTP 200 with the item container absent**
(the silent-empty trap). On THIS board it answers **HTTP 404, 109182 bytes, zero
`bidItems listItems` anchors, zero `listItemsRow bid` rows** (measured 2026-10-08).
Either way the fetched page is not the open board, so the connector never requests it
and the parse refuses it (`shape_change`).

## Live-capture stability (2026-10-08)

FOUR bare fetches were taken; all four parsed to the SAME row fingerprint
(`group|bidID|BidNo|title|status|closes`, document order), which is the no-churn
property the connector relies on. The raw bytes differ (ASP.NET session cookie echo,
`__VIEWSTATE` / `__EVENTVALIDATION`, per-request `BidStatus<bidID><CatID>` element ids)
— so the connector NEVER hash-compares raw HTML. Two of the four fetches are committed
(`fetch1`/`fetch2`); the four as-fetched sha256s are:

* fetch1: 129879 bytes, sha256 `3a4c84a8f55821d63658f1c76abc8fa1a708719d13205a6c40e31312876d9750`
* fetch2: 129879 bytes, sha256 `4c6dd5d0c3a4f16b379e312bbae8b6bf39012a1bd4bde6c1912c882947e2bfe2`
* fetch3: 129879 bytes, sha256 `2f013cf6729d546e85372306fe9bfb9c0fdf02ddeeab367a45334707a3913611`
* fetch4: 129879 bytes, sha256 `a19864d3a2fac53e3a97dad95bf6bcc8b159b94f6df96ddc15b31a65d9a9bd85`

Open rows the board itself listed at capture time: **8** (identical in all four fetches).

**Do not edit these files.** Re-capture instead. A parse failure against these bytes
is the intended signal that the live board changed.
