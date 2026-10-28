# Puerto Rico ASG captures

Public pages of the Administración de Servicios Generales procurement portal,
retrieved 2026-10-28 by a GitHub Actions job and written byte-for-byte:

- `list-2026-10-28-fetch{1,2}.html`: https://asg.pr.gov/subastas, twice 5 s
  apart (27 cards; the two differ only in a per-request token).
- `detail-27J-03663.html`, `detail-27J-04466.html`: the first two cards'
  detail pages.

No login, documents or offers were accessed. Read by src/jobs/sources/pr-asg.ts.
