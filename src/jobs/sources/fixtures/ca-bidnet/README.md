# ca-bidnet fixtures
Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
**California Purchasing Group**, fetched **2026-10-21** from this sandbox with a
plain `curl` GET and a browser-like User-Agent — **no login, no CAPTCHA, no
JavaScript, no cookies, no POST** (the list paginates by URL, unlike the Periscope
_buyer_ boards in `periscope-bso.ts`, which need a PrimeFaces `_first/_rows` POST).
The site's stylesheets, scripts and shell markup are inside the captures because they
are server-rendered into every page.
A plain `curl/8.5.0` User-Agent is refused (**HTTP 403**) by BidNet's bot wall from
this egress — for every group, including the already-live South Dakota list — so the
fetch used the same browser-like header the connector's own `getHtml` sends:
```
curl -sS -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" \
     -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
     https://www.bidnetdirect.com/california/solicitations/open-bids[/page2]
```
| File                                 | Captured from                                      | Bytes (pre-gzip) | sha256 (pre-gzip)                                                  |
| ------------------------------------ | -------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `open-bids-2026-10-21.html.gz`       | `GET /california/solicitations/open-bids` (page 1) | 164679           | `cda7e338b52fba4680bc1926fbce37b9618ebcbd6d57fa9f5c5d64e88c65fd2f` |
| `open-bids-page2-2026-10-21.html.gz` | `GET /california/solicitations/open-bids/page2`    | 164993           | `609cf173cc284cd5fb2493cc83c35a92520daf1a518156a47f23f4f58f10e96f` |
Both were fetched from `https://www.bidnetdirect.com` (the host is elided from the
URL column for width). Page 2 is kept because this is by far the largest group the
engine reads: a second, non-adjacent page proves the reader's pagination and identity
rules against rows that are nowhere near page 1.
What the captures contained at that moment:
- the results header read **"2,468 Open Solicitations"** (note the **thousands
  comma** — the shared `bidNetStatedOpenCount` reads the comma form as one number;
  without that it would read `468`), and the page's own page selector advertised
  **99** pages: 98 × 25 + 18 = **2,468**, exactly the total the heading claims;
- page 1 carried **25** rows and page 2 carried **25** rows, ids disjoint, every
  closing cell carrying the `open` state class;
- **every row reads region `California`** on both pages (unlike the Virginia & DC
  group, this one is single-region). The connector still stores the row's OWN region
  text and only falls back to the group's state when a row prints none;
- page 1's published dates are all `10/21/2026`, and page 2's are too; closing dates
  across the two captures span `10/26/2026 … 12/08/2026`, so every captured row was
  still open at the capture time;
- every row's detail link carries `purchasingGroupId=88020151`, and its `id` is the
  numeric solicitation id of that link (`…/statewide/444205633248/abstract`);
- the list prints **dates without times**. The row's own public detail (\"abstract\")
  page prints a closing time in Eastern time but LOCKS the Issuing Organization,
  Solicitation Number, Description and Source cells behind \"Registered members
  only\". No detail page is kept as a fixture because the connector reads none of its
  cells — it is the row's `source_url` target, and the opt-in live gate re-checks
  that the URL still resolves publicly and still locks those cells.
**The full live read on 2026-10-21** (all 99 pages, through the connector's own
`fetchBids`, **131.1 s**): 2,467 rows listed against a heading of 2,468 (the group
itself moved during the ≈2-minute walk) → **2,453 accepted**, skips
`{ bad_date: 11, duplicate: 3 }` (11 rows print no readable closing date and are
skipped rather than given an invented deadline; 3 solicitations were listed twice
while the pages were being walked, and the parser keeps the first), **every accepted
row California**. Two consequences are pinned in `../../ca-bidnet.ts`:
- the **page cap** is raised to 150 — the engine's default of 20 pages would silently
  truncate the group to the first 500 rows;
- this group's **per-pass abort** is raised to 240 s: the measured pass took 131 s,
  so the engine's 120 s default would have aborted it (fail-closed, zero rows). A
  pass that still overruns keeps failing closed rather than reporting a partial
  group.
A re-fetch of the list minutes later returned the same rows and dates but not
byte-identical bytes (session/telemetry markup differs), so the fixtures are **not**
byte-stable across fetches and the tests never compare raw page bytes — they assert
the parsed rows, ids and dates.
Used by `../../ca-bidnet.test.ts` (deterministic, zero network) and
`../../ca-bidnet.source-validation.test.ts` (opt-in live re-verification against the
real source).
