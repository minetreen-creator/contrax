# nh-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
New Hampshire Purchasing Group, fetched 2026-10-12 with a plain `curl` GET and a
desktop User-Agent — **no login, no CAPTCHA, no JavaScript, no cookies, no POST**
(the list paginates by URL, unlike the Periscope _buyer_ boards in
`periscope-bso.ts`, which need a PrimeFaces `_first/_rows` POST). The site's
stylesheets, scripts and shell markup are inside the captures because they are
server-rendered into every page.

| File                                 | Captured from                                         | Bytes (pre-gzip) | sha256 (pre-gzip)                                                  |
| ------------------------------------ | ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `open-bids-2026-10-12.html.gz`       | `GET /new-hampshire/solicitations/open-bids` (page 1) | 138326           | `bf834fbca9edb0720fe1479021e04ff551408cd2182c81dc5dbc7b166cf0f1df` |
| `open-bids-page2-2026-10-12.html.gz` | `GET /new-hampshire/solicitations/open-bids/page2`    | 139559           | `3391837b77d17170cc5043e5a20c2630bbe37075a7c77101c6a840e3cf68f4b7` |
| `open-bids-page3-2026-10-12.html.gz` | `GET /new-hampshire/solicitations/open-bids/page3`    | 139163           | `a4edcdd01276a3b4fbe85f78edd2efa645c23d1abbcc6bc206016579719194ba` |
| `open-bids-page4-2026-10-12.html.gz` | `GET /new-hampshire/solicitations/open-bids/page4`    | 115034           | `7f5102164444276ac0a731343f0df961eddd31cc8bab5f360bfc88ad52b62e1e` |

All four were fetched from `https://www.bidnetdirect.com` (host in the URL table
above is elided for width).

What the captures contained at that moment:

- the heading read **"91 Open Solicitations"**, and the page's own page selector
  advertised **4** pages of 25; the pages carried **25 + 25 + 25 + 16 = 91** rows,
  ids disjoint, which is what `nhBidnetStatedOpenCount` cross-checks;
- every row's region cell read "New Hampshire" and every closing cell carried the
  `open` state class;
- published dates spanned 2026-01-12 … 2026-10-09 and closing dates
  2026-10-14 … 2027-01-04;
- **ONE row prints no closing date at all**: `444149119063` ("Enterprise
  Investment Analytics and Portfolio Monitoring Platform") renders its closing
  cell as the literal text **"Not Available"**. The connector skips it (`bad_date`)
  rather than inventing a deadline — so the capture is 91 listed → **90 accepted +
  1 honestly skipped**, and the live gate re-proves that skip from the fetched
  bytes on every run;
- the list prints **dates without times**. The row's own public detail
  ("abstract") page does print a closing time in Eastern time, but LOCKS the
  Issuing Organization, Solicitation Number, Description and Source cells behind
  "Registered members only" (re-checked live 2026-10-12 on
  `/public/supplier/solicitations/statewide/444191619235/abstract?purchasingGroupId=845229551&origin=1`).
  No detail page is kept as a fixture because the connector reads none of its
  cells — it is the row's `source_url` target, and the opt-in live gate re-checks
  that this URL still resolves publicly and still locks those cells.

A re-fetch of the list minutes later returned the same rows and dates but not
byte-identical bytes (session/telemetry markup differs), so the fixtures are
**not** byte-stable across fetches and the tests never compare raw page bytes —
they assert the parsed rows, ids and dates.

Used by `../../nh-bidnet.test.ts` (deterministic, zero network) and
`../../nh-bidnet.source-validation.test.ts` (opt-in live re-verification against
the real source).
