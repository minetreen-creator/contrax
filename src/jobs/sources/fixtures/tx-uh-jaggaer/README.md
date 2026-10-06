# tx_uh_jaggaer fixture

`open-for-bid-2026-10-06.html.gz` is the **Open for Bid** page of the University of Houston's public
JAGGAER site (bids.sciquest.com, `CustomerOrg=UH`), captured 2026-10-06 ~05:58Z from
the team sandbox with a browser-like `User-Agent`:

```
GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=UH&tab=PHX_NAV_SourcingOpenForBid
```

**No login, no cookie, no CAPTCHA** — and the page prints **no** "of N Results" total.

- **5** event rows, all status `Open`; sample row, as the source states it:
  `University of Houston Fleet Collision Repair Support FY27` / `RFP-730-UofH-3154` / close `10/23/2026, 3:00 PM CDT`.
- Re-probed the same day (**06:39Z**) with the connector's own URL — that same request
  **plus `&PageSize=200`**, the parameter `fetchJaggaerBids` sends — and got
  same 5 open events, and again **no** "of N Results" total. So neither the row count nor the total behaviour is an artefact of the
  probe's URL.
- sha256 of the **captured** bytes (before redaction): `7cbed716a1931f5fc5e7e14027816770b0cb39db6f6333d00ec3065926674b23` (59614 bytes).
- sha256 of the **fixture as committed**, uncompressed: `da92d1606137b298dfb49eb03a5a361bad804830a5fa9edc93609aee91f03b32`
  (49602 bytes); of the `.gz`: `f58158be509ecf5c3cec6b8de8cef3ca3231e43ed838d4b32117b550464ad36d` (9259 bytes,
  `gzip -9`, no mtime).

## Redaction — a documented exception to "verbatim", and why it cannot change a parse

The captured page carries the portal's own **buyer contacts** (names, work emails)
and short-lived **signed link tokens**. This fixture redacts both, and nothing else
  (the capture carries 12 email values in total):

- the row-level contact cells (`id="SourcingPublicSite_LABEL_CONTACT…"` →
  `data-row-content`) → `REDACTED` — **6** cells, which takes
  the row's buyer name and work email with them;
- every `AuthToken=…` (**10**) and `X-Amz-…=…`
  (**35**) value → `REDACTED` (the mt_emacs family convention: those
  links expire within the hour), and `tmstmp=<digits>` (**16**) →
  `tmstmp=REDACTED`.
- **No other byte was touched** — not one title, number, type, close date, status, event id,
  PDF path or event row.

**It cannot change what the connector reads** — proven, not assumed: the repo's own
`parseJaggaerPage()` run over the captured bytes and over this fixture returned
**byte-identical** results (rows, events, total, skips) for this page (measured 2026-10-06).
The connector ingests no contact data at all: buyer contacts are never read, and any email
inside a description is replaced with "(email on the event page)" (`jaggaer-public.ts`).

**Contact data in this fixture: none.** A post-redaction scan finds no email- or
phone-shaped value except the deliberate `redacted@example.invalid` placeholder, and no
person's name from the captured contact blocks remains.

Provenance: `/home/team/shared/texas-bonfire-jaggaer-probe-2026-10-06/` — `raw-uh-jaggaer-sciquest-open.html`, `raw-uh-jaggaer-bids01-open.html` (the same org on the other JAGGAER host, same 5 rows), `repoheader-uh-jaggaer.html`, `h-out.json` — `parseJaggaerPage()` over these bytes → 5/5 accepted, 0 skipped.
The raw captured bytes are kept there; this fixture is derived from them.

Used by `../../tx-jaggaer.test.ts` (deterministic parser suite, zero network).
