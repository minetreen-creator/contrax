# Nebraska State Purchasing Bureau fixtures (`ne_das`)

Verbatim copy (gzipped) of
https://das.nebraska.gov/materiel/bid-opportunities.html captured 2026-10-02
at about 03:54 UTC with the request `fetchNeDasBids` makes (see ne-das.ts).
No login, no CAPTCHA.

| File | Current Bid Opportunities rows |
|---|---|
| `bid-opportunities-2026-10-02.html.gz` | 9 (4 still ahead of their opening date, 3 past it, 2 continuous qualification lists) |

The page's other tables (bids being awarded, awarded bids) are not read.
Buyer names appear on the page; the connector ingests none of them.

md5 (uncompressed):

```
7c7461b1757128df68e49a58f7b4a63b  bid-opportunities-2026-10-02.html
```
