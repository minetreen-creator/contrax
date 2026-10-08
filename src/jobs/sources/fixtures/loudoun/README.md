# Loudoun County bid-board fixtures (`va_loudoun`)

PROVENANCE — captured 2026-10-08 from `https://www.loudoun.gov/bids.aspx` with a bare `GET` (no query
params, no cookies) and exactly these request headers:
* `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
* `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`

| File | What it is | as-fetched bytes | as-fetched sha256 | committed bytes | committed sha256 |
|---|---|---|---|---|---|
| `loudoun-open-2026-10-08-fetch1.html` | verbatim open-board response, fetch 1 (the parse fixture) | 118757 | `7fb0b65ebb45bea8843625c199d4b5363a0e0da5ffb972b1237b41afab3d1be8` | 118769 | `e94e700b2c5ef401410122cd5f7b23351504ff1bfe5222dbe6bbeff6721b6078` |
| `loudoun-open-2026-10-08-fetch2.html` | verbatim open-board response, fetch 2 (stability cross-check) | 118757 | `6c02b0c8d7c76b1c8c7f485e48eaec046ac0cfc2655f6954f3ebfb3923e20a0a` | 118769 | `0c3acd7aa10238dd048819e90bd9f771bad80ad5d2c5f87e5cf29cbbcda923d6` |
| `loudoun-query-param-all-2026-10-08.html` | the `?showAllBids=true&Status=all` trap response | 97720 | `86fab56f7bfdf3126c6ac0a03fd3f653a87c167e581e8d80b1ce135bb6c728c2` | 97728 | `18a7fe4475e0e95fd2ab0e763c339eeec81298f4e29b157fea694d396151d290` |

## PII redaction — the ONLY edit made to the as-fetched bytes

* `loudoun-open-2026-10-08-fetch1.html`: emails none; phone numbers ['703-777-0100', '703-777-0403']; values redacted → none / ['703-777-0100', '703-777-0403'].
* `loudoun-open-2026-10-08-fetch2.html`: emails none; phone numbers ['703-777-0100', '703-777-0403']; values redacted → none / ['703-777-0100', '703-777-0403'].
* `loudoun-query-param-all-2026-10-08.html`: emails none; phone numbers ['703-777-0100']; values redacted → none / ['703-777-0100'].

No redacted value falls inside the parsed item region (`piiInsideParseRegion` is empty
for every file), and the parse fingerprint of every file is byte-for-byte IDENTICAL
before and after redaction — that is asserted by the fixture-prep script and again by
the test suite. `listserv@civicplus.com` is the platform's own generic mailing-list
address (CivicPlus boilerplate, not personal data) and is deliberately left verbatim.

## The trap response (why the BARE URL is the only request)

On Dayton the same query-param URL answers **HTTP 200 with the item container absent**
(the silent-empty trap). On THIS board it answers **HTTP 404, 97720 bytes, zero
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

* fetch1: 118757 bytes, sha256 `7fb0b65ebb45bea8843625c199d4b5363a0e0da5ffb972b1237b41afab3d1be8`
* fetch2: 118757 bytes, sha256 `6c02b0c8d7c76b1c8c7f485e48eaec046ac0cfc2655f6954f3ebfb3923e20a0a`
* fetch3: 118757 bytes, sha256 `f5f5b148b6a074877a8c65ab373f07c95c20f0a66e64e9e737080e56bc1cf7d0`
* fetch4: 118757 bytes, sha256 `eee2e381786e804938ab83ed5b385574405d0f21925e382bc4bb2c0cc6f3c876`

Open rows the board itself listed at capture time: **10** (identical in all four fetches).

**Do not edit these files.** Re-capture instead. A parse failure against these bytes
is the intended signal that the live board changed.
