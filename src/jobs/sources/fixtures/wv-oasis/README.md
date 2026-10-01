# West Virginia wvOASIS VSS fixtures (`wv_oasis`)

Verbatim JSON response from wvOASIS Vendor Self Service
(https://prd311.wvoasis.gov/PRDVSS1X1ERP/Advantage4), captured 2026-10-01 with
the same three requests `fetchVssBids` makes (see advantage-vss.ts): GET the
home page's `session_info`, POST the Published Solicitations pageOpen action,
POST the grid's `show_lines` action with 500 rows.

| File | Response to | Grid rows |
|---|---|---|
| `open-solicitations-2026-10-01.json` | show_lines (500) | 52 (`rows_total` 52, no "+") |

Buyer contact fields in the file are as wvOASIS publishes them on its public
page; the connector ingests only the department name. The session ids in the
file expired with the capture session.

md5:

```
6cce41521c58808afbaa6d3397458961  open-solicitations-2026-10-01.json
```
