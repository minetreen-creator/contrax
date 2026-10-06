# tx_texastech_jaggaer fixture

`open-for-bid-2026-10-06.html.gz` is the **Open for Bid** page of Texas Tech's public
JAGGAER site (bids.sciquest.com, `CustomerOrg=TexasTech`), captured 2026-10-06 ~05:58Z from
the team sandbox with a browser-like `User-Agent`:

```
GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=TexasTech&tab=PHX_NAV_SourcingOpenForBid
```

**No login, no cookie, no CAPTCHA** — and the page prints **no** "of N Results" total.

- **4** event rows, all status `Open`; sample row, as the source states it:
  `RFP 2026-1191 Maintenance and Repair Staff Augmentation Services` / `2026-1191` / close `10/29/2026, 3:00 PM CDT`.
- Re-probed the same day (**06:39Z**) with the connector's own URL — that same request
  **plus `&PageSize=200`**, the parameter `fetchJaggaerBids` sends — and got
  the same 4 open events, and again **no** "of N Results" total. So neither the row count nor the total behaviour is an artefact of the
  probe's URL.
- sha256 of the **captured** bytes (before redaction): `06bca70b3906c461831f400ebc59565abf41b8870400e84cdfa1b3718565dfae` (52334 bytes).
- sha256 of the **fixture as committed**, uncompressed: `bbe2cf934b15a2a494a588def5c26f585a82f85a6def4633dad5769d5ee30051`
  (43987 bytes); of the `.gz`: `f4d3dd0a533594ba851811043fb77321705e6aa3b57661f52ebe99ad3372a53c` (8678 bytes,
  `gzip -9`, no mtime).

## Redaction — a documented exception to "verbatim", and why it cannot change a parse

The captured page carries the portal's own **buyer contacts** (names, work emails)
and short-lived **signed link tokens**. This fixture redacts both, and nothing else
  (the capture carries 12 email values in total):

- the row-level contact cells (`id="SourcingPublicSite_LABEL_CONTACT…"` →
  `data-row-content`) → `REDACTED` — **6** cells, which takes
  the row's buyer name and work email with them;
- every `AuthToken=…` (**8**) and `X-Amz-…=…`
  (**28**) value → `REDACTED` (the mt_emacs family convention: those
  links expire within the hour), and `tmstmp=<digits>` (**14**) →
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

Provenance: `/home/team/shared/texas-bonfire-jaggaer-probe-2026-10-06/` — `raw-tt-sciquest-open.html`, `raw-tt-sciquest.html`, `h-out.json` — `parseJaggaerPage()` over these bytes → 4/4 accepted, 0 skipped.
The raw captured bytes are kept there; this fixture is derived from them.

Used by `../../tx-jaggaer.test.ts` (deterministic parser suite, zero network).
