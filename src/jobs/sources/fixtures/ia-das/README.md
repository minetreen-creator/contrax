# Iowa Bid Opportunities fixtures (`ia_das`)

Verbatim JSON response from Iowa Bid Opportunities
(https://bidopportunities.iowa.gov), captured 2026-10-01 at about 22:40 UTC
with the request `fetchIaDasBids` makes (see ia-das.ts):

`GET /Home/DT_HostedBidsSearch?agencyId=&enteredSearchText=&draw=1&start=0&length=-1`

| File | Rows |
|---|---|
| `open-bids-2026-10-01.json` | 51 (`iTotalRecords` 51), all Open |

Agency contact names, titles, emails and phone numbers appear in the file
as the site publishes them; the connector ingests none of them.

md5:

```
1dbfbb20c4fe25432c7554758a69a03d  open-bids-2026-10-01.json
```
