# Gastonia, NC fixtures (`nc_gastonia`, `nc_gaston_county`)

Captured 2026-10-12. No login.

| File | Source | Notes |
|---|---|---|
| `bids-rfps-2026-10-12.html.gz` | GET https://gastonianc.gov/doing-business/bids-rfps.html | verbatim; 8 solicitation PDF links (plus addenda) |
| `pdf-texts-2026-10-12.json.gz` | each solicitation PDF linked from that page | `{ pdfUrl: text }` — the text unpdf extracted (`mergePages: true`), not the PDFs themselves |
| `../nc-gaston-county/bids-2026-10-12.html.gz` | GET https://www.gastongov.com/Bids.aspx | verbatim; "There are no open bid postings at this time." |
