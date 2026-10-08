# City of Lynchburg bid-board fixtures (`va_lynchburg`)

PROVENANCE — captured 2026-10-08 from `https://www.lynchburgva.gov/bids.aspx` with a bare `GET` (no query
params, no cookies) and exactly these request headers:
* `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
* `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`

| File | What it is | as-fetched bytes | as-fetched sha256 | committed bytes | committed sha256 |
|---|---|---|---|---|---|
| `lynchburg-open-2026-10-08-fetch1.html` | verbatim open-board response, fetch 1 (the parse fixture) | 98713 | `840ba6374b4b99d810375b99f81c912da12c49834b7bd02ccc360d6339ed898a` | 98725 | `c4cf8c789af7c3a536de198572b7dea7d0441b219ed0fb8dd7b1776c2ad3fbe5` |
| `lynchburg-open-2026-10-08-fetch2.html` | verbatim open-board response, fetch 2 (stability cross-check) | 98713 | `e555d22b86d29414d2ea5266484bc423ec78d17739e539938a629cb25c3e0896` | 98725 | `58ac498fdd3136f8a5b6db38527760e3950c09ef0d17d64c238a30b7bda0745f` |
| `lynchburg-query-param-all-2026-10-08.html` | the `?showAllBids=true&Status=all` trap response | 85952 | `3653b09f649b25472a588bef27568c1bcad635906dd0ddb35901bb9bcb25b6eb` | 85964 | `93cf68a0caad3fb796c6c598cf0902915d1d89812ec4b033489801029646ae29` |

## PII redaction — the ONLY edit made to the as-fetched bytes

* `lynchburg-open-2026-10-08-fetch1.html`: emails ['listserv@civicplus.com']; phone numbers ['434-856-2489']; values redacted → none / ['434-856-2489'].
* `lynchburg-open-2026-10-08-fetch2.html`: emails ['listserv@civicplus.com']; phone numbers ['434-856-2489']; values redacted → none / ['434-856-2489'].
* `lynchburg-query-param-all-2026-10-08.html`: emails none; phone numbers ['434-856-2489']; values redacted → none / ['434-856-2489'].

No redacted value falls inside the parsed item region (`piiInsideParseRegion` is empty
for every file), and the parse fingerprint of every file is byte-for-byte IDENTICAL
before and after redaction — that is asserted by the fixture-prep script and again by
the test suite. `listserv@civicplus.com` is the platform's own generic mailing-list
address (CivicPlus boilerplate, not personal data) and is deliberately left verbatim.

## The trap response (why the BARE URL is the only request)

On Dayton the same query-param URL answers **HTTP 200 with the item container absent**
(the silent-empty trap). On THIS board it answers **HTTP 404, 85952 bytes, zero
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

* fetch1: 98713 bytes, sha256 `840ba6374b4b99d810375b99f81c912da12c49834b7bd02ccc360d6339ed898a`
* fetch2: 98713 bytes, sha256 `e555d22b86d29414d2ea5266484bc423ec78d17739e539938a629cb25c3e0896`
* fetch3: 98713 bytes, sha256 `18ca586aaa08b7f203ec3800e567046e3b7036acc332cc28d103335efd24e378`
* fetch4: 98713 bytes, sha256 `f8c285fb133d29a281b6304fa0b724e0b687c071bea99a5589d36eac18375292`

Open rows the board itself listed at capture time: **3** (identical in all four fetches).

**Do not edit these files.** Re-capture instead. A parse failure against these bytes
is the intended signal that the live board changed.
