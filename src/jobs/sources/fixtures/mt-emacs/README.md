# Montana eMACS (JAGGAER) fixtures (`mt_emacs`)

The "Open for Bid" page of Montana's JAGGAER public site, captured 2026-10-02
at about 03:36 UTC with the request `fetchJaggaerBids` makes (see
jaggaer-public.ts):

`GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfMontana&tab=PHX_NAV_SourcingOpenForBid&PageSize=200`

| File | Events |
|---|---|
| `open-for-bid-2026-10-02.html.gz` | 30 ("1-30 of 30 Results"), gzipped |

The page is verbatim except that the short-lived signed tokens in its links
(`AuthToken=` on the bidder-site links, `X-Amz-*=` on the S3 PDF links,
which expire within the hour) are replaced with `REDACTED`. The event ids in
the PDF paths are untouched. Buyer contact names and emails appear as the
portal publishes them; the connector ingests none of them.

md5 (uncompressed, after redaction):

```
bf8f87d02d2cba329afb1033e96c88a1  open-for-bid-2026-10-02.html
```
