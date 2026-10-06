# tx_utsa_jaggaer fixture

`open-for-bid-2026-10-06.html.gz` is the **Open for Bid** page of UT San Antonio (the portal's own banner prints "The University of Texas at San Antonio"; its page title is the short "UTSA")'s public
JAGGAER site (bids.sciquest.com, `CustomerOrg=UTSA`), captured 2026-10-06 ~05:58Z from
the team sandbox with a browser-like `User-Agent`:

```
GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=UTSA&tab=PHX_NAV_SourcingOpenForBid
```

**No login, no cookie, no CAPTCHA** — and the page prints **no** "of N Results" total.

- **2** event rows, all status `Open`; sample row, as the source states it:
  `Job Order Design Services on an IDIQ Basis` / `743-2027-RFQ-1562` / close `10/29/2026, 2:30 PM CDT`.
- Re-probed the same day (**06:39Z**) with the connector's own URL — that same request
  **plus `&PageSize=200`**, the parameter `fetchJaggaerBids` sends — and got
  the same 2 open events, and again **no** "of N Results" total. So neither the row count nor the total behaviour is an artefact of the
  probe's URL.
- sha256 of the **captured** bytes (before redaction): `40ba784f4a93205f2dc8cef27c8c08cbea27ca1d586ee386dcd053f2c7b9a5a3` (41527 bytes).
- sha256 of the **fixture as committed**, uncompressed: `c31bbbbede6265ef8d62cbd55b4c6b7595e3c361df3e8afccc8ee2d0f12d1cbe`
  (37355 bytes); of the `.gz`: `40152d4d9d7bef20ce68dba36ee24e7679b54a5b0b6dd7f96c080c3702a7fdb3` (8868 bytes,
  `gzip -9`, no mtime).

## Redaction — a documented exception to "verbatim", and why it cannot change a parse

The captured page carries the portal's own **buyer contacts** (names, work emails, and 3 phone numbers)
and short-lived **signed link tokens**. This fixture redacts both, and nothing else
  (the capture carries 8 email values in total):

- the row-level contact cells (`id="SourcingPublicSite_LABEL_CONTACT…"` →
  `data-row-content`) → `REDACTED` — **2** cells, which takes
  the row's buyer name and work email with them;
- **4 email values and 3 phone numbers in the portal's own banner prose** ("…send an
  email to sourcing@… or call the UTSA Purchasing Department at …") → `REDACTED`, together with
  the one named person that prose names ("Contact Bruce Williams, HUB Program Manager") →
  `Contact REDACTED`.
- every `AuthToken=…` (**4**) and `X-Amz-…=…`
  (**14**) value → `REDACTED` (the mt_emacs family convention: those
  links expire within the hour), and `tmstmp=<digits>` (**10**) →
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

Provenance: `/home/team/shared/texas-bonfire-jaggaer-probe-2026-10-06/` — `raw-utsa-sciquest-open.html`, `raw-utsa-sciquest.html`, `h-out.json` — `parseJaggaerPage()` over these bytes → 2/2 accepted, 0 skipped.
The raw captured bytes are kept there; this fixture is derived from them.

Used by `../../tx-jaggaer.test.ts` (deterministic parser suite, zero network).
