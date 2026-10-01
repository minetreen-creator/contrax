# South Carolina Business Opportunities fixtures (`sc_scbo`)

Pages from https://scbo.sc.gov captured 2026-10-01 at about 22:30 UTC with
the same requests `fetchScScboBids` makes (see sc-scbo.ts). No login, no
CAPTCHA.

| File | Contents |
|---|---|
| `online-edition-2026-10-01.html.gz` | GET /online-edition (overview with per-category ad counts), verbatim, gzipped |
| `categories-2026-10-01.json.gz` | `{ "<category id>": "<verbatim page>" }` for GET /online-edition?c=<id>-2026-10-01, the 11 kept categories with ads (Printing had 0), gzipped |

451 ads in the kept categories. The pages show buyers' names, emails and
phone numbers as SCBO publishes them; the connector ingests none of them.

md5 (uncompressed):

```
beb7b92d786d4a0a48863637f5af23e4  online-edition-2026-10-01.html
476782502cc6cf5211c209420468b198  categories-2026-10-01.json
```
