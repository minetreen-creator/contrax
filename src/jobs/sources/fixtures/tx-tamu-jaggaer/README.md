# tx_tamu_jaggaer fixture

`open-for-bid-2026-10-06.html.gz` is the **Open for Bid** page of Texas A&M University's public
JAGGAER site (bids.sciquest.com, `CustomerOrg=TAMU`), captured 2026-10-06 ~06:00Z from
the team sandbox with a browser-like `User-Agent`:

```
GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=TAMU&tab=PHX_NAV_SourcingOpenForBid&PageSize=200
```

**No login, no cookie, no CAPTCHA** — and this tenant **does** print its own total: "1-21 of 21 Results".

- **21** event rows, all status `Open`; sample row, as the source states it:
  `Campus Sponsorship Asset Valuation` / `04-TARLTON-RFP-0024` / close `10/27/2026, 2:00 PM CDT`.
- Re-probed the same day (**06:39Z**) with the connector's own URL — that same request
  **plus `&PageSize=200`**, the parameter `fetchJaggaerBids` sends — and got
  the same 21 open events and the same "1-21 of 21 Results" total. So neither the row count nor the total behaviour is an artefact of the
  probe's URL.
- sha256 of the **captured** bytes (before redaction): `2c9b915bc4de64f39b7efb51ffde336178d71d052479a70f6339431e8f764b2b` (172453 bytes).
- sha256 of the **fixture as committed**, uncompressed: `8a1dcf5262089562f74ba4b1ef86bdbedfc9549ad3309978a8f57876245c9b0f`
  (129959 bytes); of the `.gz`: `10eca01202de6f3799d634f00b63a6f40b18bdb0ecfe251e763b0f14de994151` (14331 bytes,
  `gzip -9`, no mtime).

## Redaction — a documented exception to "verbatim", and why it cannot change a parse

The captured page carries the portal's own **buyer contacts** (names, work emails)
and short-lived **signed link tokens**. This fixture redacts both, and nothing else
  (the capture carries 42 email values in total):

- the row-level contact cells (`id="SourcingPublicSite_LABEL_CONTACT…"` →
  `data-row-content`) → `REDACTED` — **21** cells, which takes
  the row's buyer name and work email with them;
- every `AuthToken=…` (**42**) and `X-Amz-…=…`
  (**147**) value → `REDACTED` (the mt_emacs family convention: those
  links expire within the hour), and `tmstmp=<digits>` (**50**) →
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

Provenance: `/home/team/shared/texas-bonfire-jaggaer-probe-2026-10-06/` — `raw-tamu-sciquest-open.html`, `h-out.json` / `h2-out.json` — `parseJaggaerPage()` over these bytes → 21/21 accepted, total 21, 0 skipped.
The raw captured bytes are kept there; this fixture is derived from them.

Used by `../../tx-jaggaer.test.ts` (deterministic parser suite, zero network).
