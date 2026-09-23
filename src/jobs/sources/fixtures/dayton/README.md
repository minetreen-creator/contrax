# City of Dayton bid-board fixtures (Ohio Phase 3, `oh_dayton`)

PROVENANCE — captured 2026-09-23 (probe window 02:39:26Z → 02:41:40Z) from
`https://www.daytonohio.gov/bids.aspx` with a bare `GET` (no query params, no
cookies) and exactly these request headers:

* `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
* `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`

| File | What it is | Bytes | md5 |
|---|---|---|---|
| `bids-open-2026-09-23-fetch1.html` | verbatim raw response, fetch 1 | 114567 | `31eb69f08128a7a0ee82a81a88e7e5f4` |
| `bids-open-2026-09-23-fetch2.html` | verbatim raw response, fetch 2 | 114567 | `0e86370d607c284a2f883b980dd01ac2` |
| `bids-open-2026-09-23-fetch3.html` | verbatim raw response, fetch 3 | 114567 | `c027a45872694fd396bbab0aad1a743e` |
| `bids-open-2026-09-23-fetch4.html` | verbatim raw response, fetch 4 | 114567 | `a8bdc87e7e11a5296d7dd55bf12bd1ef` |
| `extracted-rows-fetch{1..4}.json` | the 5 parsed rows + content fingerprint, one per fetch (unchanged copy of the probe extractor's output) | 3289 | — |
| `dayton-open-bids-2026-09-23.csv` | the same 5 rows, flat (probe artifact) | 1761 | — |

**Byte-exactness caveat (read this before "these should be identical"):** all four
responses are **exactly 114,567 bytes** and their *content* fingerprints (group,
bidID, Bid No., title, Status, Closes, in document order) are identical — but the
four files are **not byte-identical to each other** (different md5s). The
difference is confined to volatile ASP.NET scaffolding that is not part of the bid
list: the `ASP.NET_SessionId` cookie echo, the `__VIEWSTATE` /
`__EVENTVALIDATION` hidden-input values, and a per-request
`BidStatus<bidID><CatID>` element id. The connector therefore never hash-compares
raw HTML; `oh-dayton.test.ts` compares the **parsed row fingerprint** across all
four fetches (the no-churn property).

Files are committed **verbatim** (CRLF preserved, no trimming, no normalization):
the parser never reads outside the `div.bidItems listItems` region, but keeping
the full pages removes the "what did the trimmer hide?" question entirely, and the
4-fetch set is the stability evidence the spec's §1.1 method depends on. They are
read only by tests (`readFileSync` via `import.meta.url`), never by app code.

**Do not edit these files.** Re-capture instead (see below). A parse failure
against these bytes is the intended signal that the live board changed.

## Re-capturing (the connector's live gate)

```
curl -s -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \
     -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' \
     https://www.daytonohio.gov/bids.aspx -o bids-open-<date>.html
```

Then run the opt-IN live validation
(`bun run validate:live-bids-sources`, requires `BIDS_RUN_LIVE_SOURCE_TESTS=1`),
which asserts HTTP 200, the item-region anchor present, every parsed bidID present
in the fetched bytes, `www.daytonohio.gov` hosts, null-or-parseable due dates and
parse determinism — and refresh the 4-fetch set if the board's content changed.

Full-page archive + the probe's own artifacts live at
`shared/ohio-phase3-prep-2026-09-23/` (including the two negative probes —
`probe-rss.aspx.html`, `probe-showallbids-statusall.html` — and the two detail
pages that fix the "Bid No. absent" + "Open Until Contracted" sentinel shapes,
kept out of the repo because v1 does not fetch details).
