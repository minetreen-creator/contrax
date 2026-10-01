# Kentucky eProcurement VSS fixtures (`ky_vss`)

Verbatim JSON response from Kentucky eProcurement Vendor Self Service
(https://vss.ky.gov/vssprod-ext/Advantage4), captured 2026-10-01 with the same
three requests `fetchVssBids` makes (see advantage-vss.ts): GET the home
page's `session_info`, POST the Published Solicitations pageOpen action, POST
the grid's `show_lines` action with 500 rows.

| File | Response to | Grid rows |
|---|---|---|
| `open-solicitations-2026-10-01.json` | show_lines (500) | 57 (`rows_total` 57, no "+") |

Buyer contact fields in the file are as Kentucky VSS publishes them on its
public page; the connector ingests only the department name. The session ids
in the file expired with the capture session.

md5:

```
5713153392b9fc55a0729d897db92b33  open-solicitations-2026-10-01.json
```
