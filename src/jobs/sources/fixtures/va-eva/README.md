# eVA fixtures (`va_eva`)

## 2026-10-01 capture (shipped with the connector)

Verbatim responses from eVA's public opportunity search endpoint,
`https://mvendor.cgieva.com/Vendor/public/solrconnect.jsp`, captured on
2026-10-01 around 12:24Z with browser-like headers (the same request the public
"All Opportunities" page makes). No auth.

| File | Query | numFound | docs |
|---|---|---|---|
| `open-page1-rows25-2026-10-01.json` | `fq=status:("Open")`, `sort=pubdate desc,id desc`, `rows=25` | 582 | 25 |
| `airport-port-2026-10-01.json` | open + `agencyname:("Norfolk Airport Authority" OR "Virginia Port Authority")` | 3 | 3 |
| `non-open-sample-2026-10-01.json` | `status:("Closed" OR "Awarded" OR "Cancelled")`, `rows=5` | 222651 | 5 |

md5:

```
a6c8d2aa6151f2cd559b8f12825d0dcb  open-page1-rows25-2026-10-01.json
987d040f0596c7cbb4c4b826f5b3093b  airport-port-2026-10-01.json
1cfc2019deef70e132dcd3fa0e7be319  non-open-sample-2026-10-01.json
```

## 2026-10-08 capture (open-set scope, count gate, close-date zone)

Captured read-only on 2026-10-08 at 01:03Z from this sandbox, with the
connector's own browser-like headers and `%20` space encoding (a `+` gets HTTP
200 with a 5-byte body — that is fixture ⑤). Probe dir with the wider evidence:
`/home/team/shared/virginia-delivery-courier-probe-2026-10-08/raw/`.

**Redaction (the only edit made to any of these):** the two personal-data fields
every eVA Solr doc carries — the buyer's published name (`buyername`) and
(`buyerdeptname`) — are dropped. This connector never reads them. Every other
byte, field and value is verbatim, so BOTH hashes are recorded: the sha256 of the
bytes exactly as received, and the sha256 of the file committed here.

| File | Request | numFound | docs | as-fetched sha256 | committed sha256 |
|---|---|---|---|---|---|
| `open-page1-rows25-2026-10-08.json` | `q=app:IV AND status:Open AND closedate:[NOW TO *]`, `fl=` the 16 fields the connector reads, `sort=closedate asc,id asc`, `rows=25` | 572 | 25 | `f34151bf09a30df4a5bfe5e1e9b8611f72030400ec8a025c8b790c5803ea86fc` | `be9a33c83f333ee6e04bf40130e781b641086f546a44298a5f0d7794dcf7d301` |
| `odu-iv129024-2026-10-08.json` | `q=id:IV129024`, `fl=*`, `rows=1` | 1 | 1 | `38693ffe8d419a4096c414e0b19fcc15cf4a29a3199e147f9a70a409e2391084` | `21c4de3a8f3fcd5ec5d26a7611c9e2b4fc5720d13dd8421f639f848aa805738f` |
| `archived-vbo-open-2026-10-08.json` | `app:VBO AND status:Open`, `rows=3`, `fl=id,app,agencyname,shortdesc,closedate,status,doctype` | 1 | 1 | `62b72f72246a46c148520b33b58e7caf9ec4786eb020c367e1ffa35ef47eee29` | `f4c66b4aab037987d0f6cf28ffee92fefe9a9be8b5e031f2692264208d985ba5` |
| `open-agencyname-facets-2026-10-08.json` | `app:IV AND status:Open`, `facet.field=agencyname`, `rows=0` (`iv-open-agencyname-facets.json` in the probe dir) | 574 | 0 | `13a1320fdf9630bb4064202f8a8a58e192a67d91037d8780891ea832f1dc668f` | `b6af4568b5ac839d36135ee1a517af80f87b5407331e852cbe12c8feb10ffe2a` |
| `malformed-query-body-2026-10-08.txt` | a space sent as `+` instead of `%20` (HTTP **200**) | — | — | `7c370d9536d7d0d6a0f7cd7f9826692acd93e4fb05ba46f7b630b879740343d3` | `7c370d9536d7d0d6a0f7cd7f9826692acd93e4fb05ba46f7b630b879740343d3` |

Why each one is here:

- **`open-page1-rows25-2026-10-08.json`** — one genuine PAGE of the real open set,
  carrying every field the connector reads. Two jobs: it is the real-bytes proof
  that the **count gate refuses a partial read** (25 documents against the
  source's own `numFound=572`), and — with only the total set to the document
  count — it is the happy-path corpus the parse is exercised over. eVA's open set
  genuinely was **572** at capture (the probe measured 574 at 00:44Z): the index
  moves by the minute, which is exactly why no count may be hardcoded anywhere.
- **`odu-iv129024-2026-10-08.json`** — the build's fixture anchor: **Old Dominion
  University, `IFB #27-ODU-04-CCC - Hauling, Moving, and Labor Services`**, close
  date **`2026-10-16T11:00:00Z`**, `app:IV`, status Open, `internalid` 129024. It
  is also the one response whose `numFound` (1) equals its document count, so it
  drives the end-to-end fetch → count gate → parse path on real bytes. It is the
  honest reminder of the volume the probe found: of 574 open rows that day,
  **0** mention courier / freight / trucking / messenger / LTL.
- **`archived-vbo-open-2026-10-08.json`** — the ONE row in the whole index that is
  `status:Open` and belongs to the ARCHIVED `app:VBO` app
  (`VBO:IFQC:A208:170594`, close date 2026-08-01; legacy VBO frozen in 2023).
  Measured in the same minute: `status:Open` across the index = **575**,
  `app:IV AND status:Open` = **574**, and
  `app:IV AND status:Open AND closedate:[NOW TO *]` = **572** — so the query's two
  clauses remove exactly 3 rows: this archived notice, plus two `app:IV` rows whose
  close date has passed. The archived row must never be ingested as an open
  opportunity — hence the `app:IV` scope, with the `wrong_app` parse guard behind it.
- **`open-agencyname-facets-2026-10-08.json`** — the source's own 574-open
  `agencyname` facet: the honest record behind the buyer-mix copy (eVA hosts
  Virginia **local** governments, not only state agencies). Every count quoted
  comes from the source, never from our arithmetic.
- **`malformed-query-body-2026-10-08.txt`** — the measured failure mode: a
  malformed query is answered **HTTP 200 with a 5-byte body** (five newlines), so a
  naive reader stores zero rows and logs success. Reproduced live again at capture.
  Kept byte-exact (it is not JSON, hence `.txt`); both the unit suite and the opt-in
  live gate assert the connector fails closed on it.

**Parse-inert:** every `.json` fixture is plain JSON data — no HTML, no script
tags, no executable content, and nothing in it is ever evaluated (the suite
asserts this). The `.txt` fixture is five newline bytes.
