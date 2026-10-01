# Florida MFMP fixtures (`fl_mfmp`)

Verbatim responses from the public MyFloridaMarketPlace Vendor Bid System search,
`POST https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids`, captured
2026-10-01 with the same JSON the https://vendor.myfloridamarketplace.com/search/bids
page sends. No auth. `POST …/pub/search/bids/count` with `{"status":["OPEN"]}`
returned 163 at capture time.

| File | Body | Ads |
|---|---|---|
| `open-page1-2026-10-01.json` | `{"status":["OPEN"],"page":1,"pageSize":100}` | 100 |
| `open-page2-2026-10-01.json` | `{"status":["OPEN"],"page":2,"pageSize":100}` | 63 |
| `closed-page1-2026-10-01.json` | `{"status":["CLOSED"],"page":1,"pageSize":25}` | 25 |

md5:

```
28df6f13319b405bf7186b049409732b  open-page1-2026-10-01.json
1c521748c0d5edbaa97f645ff9ffbf81  open-page2-2026-10-01.json
103584887f236b1d6ead9f587d32c671  closed-page1-2026-10-01.json
```
