# Delaware Bid Solicitation Directory fixtures (`de_mmp`)

Responses from https://mmp.delaware.gov captured 2026-10-01 with the same
requests `fetchDeMmpBids` makes (see de-mmp.ts). No login, no CAPTCHA.

| File | Response to | Contents |
|---|---|---|
| `open-bids-2026-10-01.json` | POST /Bids/GetBids?status=Open (rows=1000) | verbatim; 52 open bids (`records` 52) |
| `agencies-2026-10-01.html.gz` | GET /Agency/Index | verbatim page, gzipped; 76 agencies |
| `bid-details-2026-10-01.json.gz` | GET /Bids/GetBidDetail?id=<Id>, one per bid | `{ "<Id>": "<verbatim response body>" }`, gzipped |

Contract officer emails appear in the files as the directory publishes them
on its public pages; the connector ingests none of them.

md5 (uncompressed):

```
a0650a6ad6a40b56af92f1493a19b500  open-bids-2026-10-01.json
b57f60380c73735a29225c9827a45561  agencies-2026-10-01.html
b13a8de93a419e780c3ee5470ca8f5ce  bid-details-2026-10-01.json
```
