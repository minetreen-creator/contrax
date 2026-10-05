# ms-dfa fixture

`open-bids-2026-10-05.json.gz` is the verbatim JSON response (gzipped) of

```
POST https://www.ms.gov/dfa/contract_bid_search/Bid/BidData?AppId=1
```

the DataTables call the public Mississippi procurement search page
(`/dfa/contract_bid_search/Bid`) makes to fill its table, sent with the page's
own request body (`msRequestBody()`, all rows) after a GET of the page for its
session cookie. Captured 2026-10-05 (no login, no CAPTCHA): 140 open records
from state agencies, universities and MPTAP local legal notices. Used by
`../../ms-dfa.test.ts`.
