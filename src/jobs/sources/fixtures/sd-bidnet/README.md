# sd-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
South Dakota Purchasing Group, fetched 2026-10-12 with a plain `curl` GET and a
desktop User-Agent — **no login, no CAPTCHA, no JavaScript, no cookies, no POST**
(the list paginates by URL, unlike the Periscope _buyer_ boards in
`periscope-bso.ts`, which need a PrimeFaces `_first/_rows` POST). The site's
stylesheets, scripts and shell markup are inside the captures because they are
server-rendered into every page.

| File                                 | Captured from                                        | Bytes (pre-gzip) | sha256 (pre-gzip)                                                  |
| ------------------------------------ | ---------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `open-bids-2026-10-12.html.gz`       | `GET /south-dakota/solicitations/open-bids` (page 1) | 143531           | `16c92b6a3c469e511e5f382ebaa6178d38cf2f7a6fda35e350112ecf4890649d` |
| `open-bids-page2-2026-10-12.html.gz` | `GET /south-dakota/solicitations/open-bids/page2`    | 128311           | `eb81184311dc70383b826a35c5981cb8d6e2494c6428fa81249e22aee5ce3cb1` |

What the captures contained at that moment:

- the heading read **"44 Open Solicitations"**, and the page's own page selector
  advertised 2 pages of 25; page 1 carried **25** rows and page 2 **19** — 44 in
  total, ids disjoint, which is what `sdBidnetStatedOpenCount` cross-checks;
- every row's region cell read "South Dakota" and every closing cell carried the
  `open` state class;
- published dates spanned 2026-07-16 … 2026-10-09 and closing dates
  2026-10-14 … 2027-10-15;
- the list prints **dates without times**. The row's own public detail
  ("abstract") page does print a closing time in Eastern time — captured
  2026-10-12 for `/public/supplier/solicitations/statewide/2719424597/abstract?purchasingGroupId=845232051&origin=1`:
  title, Location "South Dakota", `Publication Date 10/09/2026 02:30 PM EDT`,
  `Closing Date 10/26/2026 01:00 PM EDT`, and then **Issuing Organization,
  Solicitation Number, Description and Source all rendered "Locked / Registered
  members only"**. No detail page is kept as a fixture because the connector reads
  none of its cells — it is the row's `source_url` target, and the opt-in live
  gate re-checks that this URL still resolves publicly.

A re-fetch of the list minutes later returned the same rows and dates but not
byte-identical bytes (session/telemetry markup differs), so the fixtures are
**not** byte-stable across fetches and the tests never compare raw page bytes —
they assert the parsed rows, ids and dates.

Used by `../../sd-bidnet.test.ts` (deterministic, zero network) and
`../../sd-bidnet.source-validation.test.ts` (opt-in live re-verification against
the real source).
