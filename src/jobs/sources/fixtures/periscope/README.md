# Periscope S2G (BuySpeed) fixtures

Verbatim responses from the public open-bid search of six Periscope state
marketplaces, captured 2026-10-01 (gzipped). No login.

| File | Request | Rows on page / `rowCount` |
|---|---|---|
| `open-www.commbuys.com-…html.gz` | GET `/bso/view/search/external/advancedSearchBid.xhtml?openBids=true` | 25 / 935 |
| `open-www.njstart.gov-…html.gz` | same, NJSTART | 24 / 24 |
| `open-www.bidbuy.illinois.gov-…html.gz` | same, BidBuy Illinois | 25 / 191 |
| `open-oregonbuys.gov-…html.gz` | same, OregonBuys | 25 / 178 |
| `open-nevadaepro.com-…html.gz` | same, NevadaEPro | 25 / 31 |
| `open-arbuy.arkansas.gov-…html.gz` | same, ARBuy | 0 / 0 |
| `page-www.commbuys.com-first0-…xml.gz` | the table's partial/ajax paging POST (`_first=0&_rows=25`, with `_csrf`, `openBids=true` and the ViewState) | 25 |

md5 of the uncompressed files:

```
299313e9e224413faced87fb4b35cc06  open-www.commbuys.com
7eb593919b4c6ecae0614b603c795092  open-www.njstart.gov
10a6273f75e2d55b1ca696e92e58562f  open-www.bidbuy.illinois.gov
f35d1915f934089947acd20b0aa85bb5  open-oregonbuys.gov
e3ff012a12e3c1fb18539624e0951030  open-nevadaepro.com
f92513a9997a0fc26e59748c26f80bb6  open-arbuy.arkansas.gov
69ec2e56df8ea533f40e425079b9f14f  page-www.commbuys.com-first0
```
