# Pennsylvania eMarketplace fixtures (`pa_dgs_emarketplace`)

Verbatim HTML from the public PA eMarketplace solicitation search,
https://www.emarketplace.state.pa.us/Search.aspx, captured 2026-10-01. No login.
The page was fetched with GET, then posted back with its own hidden form
fields and `ctl00$MainBody$ddlRows=32767` (the Rows dropdown's "ALL" option,
current records) — the request `fetchPaEmarketplaceBids` makes.

| File | Request | Grid rows |
|---|---|---|
| `search-all-2026-10-01.html.gz` | POST Search.aspx, Rows = ALL | 181 |

md5 of the uncompressed HTML:

```
6abbf4387ab2efb43b071b76ee65ac1a  search-all-2026-10-01.html
```
