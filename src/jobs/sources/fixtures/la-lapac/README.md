# Louisiana LaPAC fixtures (`la_lapac`)

Pages from LaPAC (https://wwwcfprd.doa.louisiana.gov/osp/lapac) captured
2026-10-01 at about 22:45 UTC with the same requests `fetchLaLapacBids`
makes (see la-lapac.ts). No login, no CAPTCHA.

| File | Contents |
|---|---|
| `departments-2026-10-01.html.gz` | GET deptbids.cfm, verbatim, gzipped (41 departments with bids) |
| `department-pages-2026-10-01.json.gz` | `{ "<term>": "<verbatim page>" }` for GET dspBid.cfm?search=department&term=<term>, all 41, gzipped |

282 bid rows in all (132 open at capture, 12 cancelled, 138 past their open
time). Buyer contact ids appear on the pages as LaPAC publishes them; the
connector ingests none of them.

md5 (uncompressed):

```
005a58d26c46066a34bdbd603224e68b  departments-2026-10-01.html
94535108705a1fd782779f6e74917f40  department-pages-2026-10-01.json
```
