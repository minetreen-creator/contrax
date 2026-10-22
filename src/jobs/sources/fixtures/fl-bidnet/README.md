# fl-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Florida Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own
headers (desktop User-Agent, `Accept: text/html`, `Referer` = the list URL). No
login, no CAPTCHA solved, no JavaScript, no cookies, no POST.

| File                                 | Captured from                                   | Bytes (pre-gzip) | sha256 (pre-gzip)                                                  |
| ------------------------------------ | ----------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `open-bids-2026-10-22.html.gz`       | `GET /florida/solicitations/open-bids` (page 1) | 143879           | `917b69d5a747b754927040a62b43bdeb0ad226e062047e722835ab53baada84e` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /florida/solicitations/open-bids/page2`    | 144314           | `21e9d04ac7c9699d342a2b0d3f56b32c5ec68ab239dd497cbab262931d2a7b4c` |

Both from `https://www.bidnetdirect.com`.

What the captures contained:

- the heading read **"74 Open Solicitations"** and the page selector advertised
  **3** pages; pages 1 and 2 carry 25 rows each, ids disjoint;
- every row's region cell read "Florida" and every closing cell carried the `open`
  state; closing dates 10/23/2026 … 02/25/2030;
- rows link with the `/<group>/solicitations/open-bids/<title-slug>/<id>` shape
  (as in `../ny-bidnet/`), read by `bidNetDetailId`.

Used by `../../fl-bidnet.test.ts`.
