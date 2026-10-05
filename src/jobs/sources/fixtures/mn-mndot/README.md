# mn-mndot fixture

`advertised-2026-10-05.json.gz` maps each letting date (MM/DD/YYYY) to the
verbatim advertisement grid (`<table id="MainContent_gvAd">…</table>`) that

```
POST https://transport.dot.state.mn.us/PreLetting/advertisement.aspx
```

returned when the page's own form was submitted for that letting date with
district "Show All", captured 2026-10-05 (no login, no CAPTCHA): five lettings,
13 advertised projects. Only the grid is kept; the rest of each page is
navigation. Used by `../../mn-mndot.test.ts`.
