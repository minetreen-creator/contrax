# sd-dot fixtures

Verbatim captures of SDDOT's public Bid Letting application
(`https://apps.sd.gov/HC65BidLetting/`), fetched 2026-10-12T02:52Z with a plain
`curl` GET and a desktop User-Agent — **no login, no CAPTCHA, no JavaScript, no
cookies carried between requests**. Only the three pages the connector reads are
kept; the site's stylesheets, scripts and left-hand navigation are inside them
because they are server-rendered into every page.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
|---|---|---|---|
| `index-2026-10-12.html.gz` | `GET /HC65BidLetting/ebslettings1.aspx` | 15406 | `83102a4a5bda2f96c7e25d081eaec8b29765f7fac2d338d8bff3d57e3b8e6894` |
| `letting-2026-10-21.html.gz` | `GET /HC65BidLetting/ebslettingsdetail1.aspx?args=0F03BFE651C4DAE885242AC43DE312D3488B5567B3414B16` | 32192 | `cf634d3a79ad8342636c916febe17632269e61b8e166ad83dc82892e0be8ae59` |
| `letting-2026-11-04.html.gz` | `GET /HC65BidLetting/ebslettingsdetail1.aspx?args=0F03BFE651C4DAE8C4465DC9F838222EF3D88CD454AA8B03` | 27117 | `3d6e14c873612e62a339a14502e164085b1754ba15801f415a944985850e4384` |

What the capture contained at that moment:

- the index page listed **two** letting pages under "Lettings Currently Advertised
  for Bids" (10/21/2026 and 11/04/2026), five under "Status of Lettings Post Bid
  Opening" (historical, not read) and four "Completed" region search links;
- the 10/21/2026 letting page carried **9** contracts; the 11/04/2026 page
  carried **7** — 16 advertised contracts in total;
- every page prints a letting **date with no time**, so the connector stores
  date-only deadlines at 11:59 PM Central and says so in the row description.

A re-fetch of the index seconds later returned byte-identical *semantic* content
(same letting tokens, same dates) but different ASP.NET `__VIEWSTATE` /
session-token bytes, so the fixtures are not byte-stable across fetches and the
tests never compare raw page bytes. The `args` tokens on the detail links, by
contrast, were identical across two fetches of the same letting page, which is
why `source_url` can cite them.

Used by `../../sd-dot.test.ts` (deterministic, zero network) and
`../../sd-dot.source-validation.test.ts` (opt-in live re-verification against the
real source).
