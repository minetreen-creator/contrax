# va-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
**Virginia & DC Purchasing Group**, fetched **2026-10-21** from this sandbox with a
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
     https://www.bidnetdirect.com/virginia/solicitations/open-bids[/page9]
```

| File                                  | Captured from                                        | Bytes (pre-gzip) | sha256 (pre-gzip)                                                  |
| ------------------------------------- | ---------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `open-bids-2026-10-21.html.gz`        | `GET /virginia/solicitations/open-bids` (page 1)     | 148061           | `8cddb5f989eae0fe7e6f51c03ec8593a6209118576260bf18468c2e7dc80c031` |
| `open-bids-page9-2026-10-21.html.gz`  | `GET /virginia/solicitations/open-bids/page9`        | 148320           | `3be2742d6b36c5af5b4ee19e9b1406e2f40a1f31c5128628c6e0f871fb8db5ff` |

Both were fetched from `https://www.bidnetdirect.com` (the host is elided from the
URL column for width). Page 9 is kept because this group is far larger than the SD
(2 pages) / NH (4 pages) groups: a second, non-adjacent page proves the reader's
pagination and identity rules against rows that are nowhere near page 1.

What the captures contained at that moment:

- the results header read **"1,176 Open Solicitations"** (note the **thousands
  comma** — the shared `bidNetStatedOpenCount` reads the comma form as one number;
  without that it would read `176`), and the page's own page selector advertised
  **48** pages: 47 × 25 + 1 = **1,176**, exactly the total the heading claims;
- page 1 carried **25** rows and page 9 carried **25** rows, ids disjoint, every
  closing cell carrying the `open` state class;
- **regions are per row**: page 1 has 23 rows reading `Virginia` and 2 reading
  `District of Columbia`; page 9 has 22 `Virginia` and 3 `District of Columbia`.
  The connector stores the row's own region text, so a DC-located solicitation is
  labeled District of Columbia — never relabelled Virginia, never dropped;
- page 1's published dates are all `10/21/2026`; page 9's are `10/16/2026` and
  `10/18/2026`. Closing dates span `10/22/2026 … 11/30/2026` across the two pages,
  so every captured row was still open at the capture time;
- the list prints **dates without times**. The row's own public detail ("abstract")
  page prints a closing time in Eastern time but LOCKS the Issuing Organization,
  Solicitation Number, Description and Source cells behind "Registered members
  only". No detail page is kept as a fixture because the connector reads none of its
  cells — it is the row's `source_url` target, and the opt-in live gate re-checks
  that the URL still resolves publicly and still locks those cells.

**The full live read on 2026-10-21** (all 48 pages, through the connector's own
`fetchBids`, 52.1 s): 1,176 rows listed → **1,168 accepted**, skips
`{ bad_date: 5, closed: 3 }` (five rows print no readable closing date and are
skipped rather than given an invented deadline; three had already closed), of which
**183 rows are District of Columbia** and 985 Virginia. That is why the group's page
cap is raised to 60 in `../../va-bidnet.ts` — the engine's default of 20 pages would
silently truncate it to the first 500 rows.

A re-fetch of the list minutes later returned the same rows and dates but not
byte-identical bytes (session/telemetry markup differs), so the fixtures are **not**
byte-stable across fetches and the tests never compare raw page bytes — they assert
the parsed rows, ids and dates.

Used by `../../va-bidnet.test.ts` (deterministic, zero network) and
`../../va-bidnet.source-validation.test.ts` (opt-in live re-verification against the
real source).
