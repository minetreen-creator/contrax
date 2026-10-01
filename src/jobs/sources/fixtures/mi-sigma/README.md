# Michigan SIGMA VSS fixtures (`mi_sigma`)

Verbatim JSON response from Michigan SIGMA Vendor Self Service
(https://sigma.michigan.gov/PRDVSS1X1/Advantage4), captured 2026-10-01 with the
same three requests `fetchVssBids` makes (see advantage-vss.ts and
../co-vss/README.md): GET the home page's `session_info`, POST the
Published Solicitations pageOpen action, POST the grid's `show_lines`
action with 500 rows.

| File | Response to | Grid rows |
|---|---|---|
| `open-solicitations-2026-10-01.json` | show_lines (500) | 119 (`rows_total` 119, no "+") |

Buyer names, emails and phone numbers in the file are as SIGMA publishes them
on its public page; the connector ingests only the department name. The session
ids in the file expired with the capture session.

md5:

```
5f828d1e4f83b2bdf9fd8c9282f23056  open-solicitations-2026-10-01.json
```
