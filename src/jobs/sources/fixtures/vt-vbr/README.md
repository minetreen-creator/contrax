# Vermont Business Registry and Bid System fixtures (`vt_vbr`)

Pages from https://www.vermontbusinessregistry.com captured 2026-10-02 at
about 03:41 UTC with the same requests `fetchVtVbrBids` makes (see
vt-vbr.ts). No login, no CAPTCHA.

| File | Contents |
|---|---|
| `lists-2026-10-02.json.gz` | `{ "5": <BidSearch.aspx?type=5 page>, "7": <BidSearch.aspx?type=7 page> }`: open state (44) and municipal (35) bids, verbatim, gzipped |
| `bid-details-2026-10-02.json.gz` | `{ "<BidID>": "<BidPreview.aspx?BidID=… page>" }` for all 79 bids, verbatim, gzipped |

Some listed bids had already passed their close date (18 at capture); the
site keeps them on its "open" lists, and the connector skips them as
`closed`. Author addresses and contact details appear on the pages as the
site publishes them; the connector ingests none of them.

md5 (uncompressed):

```
6bf5ba4ed9496fca3992f09b88db35ef  lists-2026-10-02.json
e2de8b4e69666ec29c505b90a1b1acd1  bid-details-2026-10-02.json
```
