# nc-bidnet fixtures

Verbatim capture of BidNet Direct's **public, no-login** "open bids" list for the
North Carolina Purchasing Group, fetched 2026-10-22 with a plain GET and the
engine's own headers (desktop User-Agent, `Accept: text/html`, `Referer` = the
list URL). No login, no CAPTCHA solved, no JavaScript, no cookies, no POST.

| File                           | Captured from                                                                | Bytes (pre-gzip) | sha256 (pre-gzip)                                                  |
| ------------------------------ | ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `open-bids-2026-10-22.html.gz` | `GET https://www.bidnetdirect.com/north-carolina/solicitations/open-bids`    | 110185           | `dcd1134b0cdb303aaa664a503e5097e57701b9f10bc86a760eac3bea8e657a07` |

What the capture contained: the heading read **"14 Open Solicitations"** on a
single page (no page selector); every row's region read "North Carolina" and every
closing cell carried the `open` state; closing dates 10/26/2026 … 11/24/2026; rows
link with the `/<group>/solicitations/open-bids/<title-slug>/<id>` shape. The first
GET that day got the AWS WAF 202 challenge; the next returned this page.

Used by `../../nc-bidnet.test.ts`.
