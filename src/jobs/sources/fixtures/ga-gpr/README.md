# Georgia Procurement Registry fixtures (`ga_gpr`)

Verbatim JSON from the registry's own search endpoint,
`POST https://ssl.doas.state.ga.us/gpr/eventSearch` with the body
`gprSearchBody()` builds (`eventStatus=OPEN`, `length=1000`), captured
2026-10-01 (gzipped). No login. `recordsTotal` 503, all 503 rows returned.

md5 of the uncompressed file:

```
68f504178ce6c48aa15c130ff2dbcbb1  open-events-2026-10-01.json
```
