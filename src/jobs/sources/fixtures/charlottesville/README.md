# City of Charlottesville bid-board fixtures (`va_charlottesville`)

PROVENANCE — captured 2026-10-08 from `https://www.charlottesville.gov/bids.aspx` with a bare `GET` (no query
params, no cookies) and exactly these request headers:
* `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
* `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`

| File | What it is | as-fetched bytes | as-fetched sha256 | committed bytes | committed sha256 |
|---|---|---|---|---|---|
| `charlottesville-open-2026-10-08-fetch1.html` | verbatim open-board response, fetch 1 (the parse fixture) | 103846 | `2028c57c167d57e853184cb81cdb41094dd3238d95b481f2a80224011de95c32` | 103846 | `2028c57c167d57e853184cb81cdb41094dd3238d95b481f2a80224011de95c32` |
| `charlottesville-open-2026-10-08-fetch2.html` | verbatim open-board response, fetch 2 (stability cross-check) | 103846 | `417a15c2396f36b2b232f55a3f84f306101e19e639ffa020a5b7ee873d09e9eb` | 103846 | `417a15c2396f36b2b232f55a3f84f306101e19e639ffa020a5b7ee873d09e9eb` |
| `charlottesville-query-param-all-2026-10-08.html` | the `?showAllBids=true&Status=all` trap response | 93087 | `34ee88a7f41b538a281ffcad0160524504265d593f5a27d4e17b1af5ee6d1521` | 93087 | `34ee88a7f41b538a281ffcad0160524504265d593f5a27d4e17b1af5ee6d1521` |

## PII redaction — the ONLY edit made to the as-fetched bytes

* `charlottesville-open-2026-10-08-fetch1.html`: emails none; phone numbers none; values redacted → none / none.
* `charlottesville-open-2026-10-08-fetch2.html`: emails none; phone numbers none; values redacted → none / none.
* `charlottesville-query-param-all-2026-10-08.html`: emails none; phone numbers none; values redacted → none / none.

No redacted value falls inside the parsed item region (`piiInsideParseRegion` is empty
for every file), and the parse fingerprint of every file is byte-for-byte IDENTICAL
before and after redaction — that is asserted by the fixture-prep script and again by
the test suite. `listserv@civicplus.com` is the platform's own generic mailing-list
address (CivicPlus boilerplate, not personal data) and is deliberately left verbatim.

## The trap response (why the BARE URL is the only request)

On Dayton the same query-param URL answers **HTTP 200 with the item container absent**
(the silent-empty trap). On THIS board it answers **HTTP 404, 93087 bytes, zero
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

* fetch1: 103846 bytes, sha256 `2028c57c167d57e853184cb81cdb41094dd3238d95b481f2a80224011de95c32`
* fetch2: 103846 bytes, sha256 `417a15c2396f36b2b232f55a3f84f306101e19e639ffa020a5b7ee873d09e9eb`
* fetch3: 103846 bytes, sha256 `e926b0abf2a3d678e47e8dddbc433710301fceeab2bd45171fdff05677543709`
* fetch4: 103846 bytes, sha256 `e3fca981b8f7d984600e1cb91b92bff9d603c773f74e6f39e02cd3be7b14ce8f`

Open rows the board itself listed at capture time: **1** (identical in all four fetches).

**Do not edit these files.** Re-capture instead. A parse failure against these bytes
is the intended signal that the live board changed.
