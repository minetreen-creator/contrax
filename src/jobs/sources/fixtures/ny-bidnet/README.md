# ny-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Empire State Purchasing Group (New York), fetched 2026-10-22 with a plain GET and
the engine's own headers (desktop User-Agent, `Accept: text/html`, `Referer` = the
list URL). No login, no CAPTCHA solved, no JavaScript, no cookies, no POST.

| File                                 | Captured from                                    | Bytes (pre-gzip) | sha256 (pre-gzip)                                                  |
| ------------------------------------ | ------------------------------------------------ | ---------------- | ------------------------------------------------------------------ |
| `open-bids-2026-10-22.html.gz`       | `GET /new-york/solicitations/open-bids` (page 1) | 146786           | `6e0d57b4748e9ba2b382ecca4e40cff1ac73dbce0b5484e551cd43852a829f79` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /new-york/solicitations/open-bids/page2`    | 147422           | `db115d7c5f452d0da175457bae1301632bc7078cb9c811e47f157e532f3a1047` |

Both from `https://www.bidnetdirect.com`.

What the captures contained:

- the heading read **"436 Open Solicitations"** and the page selector advertised
  **18** pages; pages 1 and 2 carry 25 rows each, ids disjoint;
- every row's region cell read "New York" and every closing cell carried the
  `open` state; published 10/21–10/22/2026, closing 10/23–11/25/2026;
- the rows link with BidNet's **second detail-URL shape**,
  `/new-york/solicitations/open-bids/<title-slug>/<id>` (e.g.
  `…/Fuel-Generator-and-Off-Road/0000441194`), not the
  `/public/supplier/solicitations/<scope>/<id>/abstract` shape of the SD/NH/VA/CA
  captures; `bidNetDetailId` reads both and keeps the id verbatim (leading zeros).

The first GET of page 1 that day returned **HTTP 202** with BidNet's AWS WAF
challenge page (2,264 bytes); an identical GET about 20 s later returned the list.
The engine treats any non-200 as a failed pass, never as an empty group.

Used by `../../ny-bidnet.test.ts`.
