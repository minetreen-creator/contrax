# Alabama DOT lettings fixtures (`al_aldot`)

Verbatim copies (gzipped) of ALDOT's Project Letting Information pages,
captured 2026-10-01. No login, no CAPTCHA.

| File | Page | Proposals |
|---|---|---|
| `index-2026-10-01.html.gz` | https://alletting.aldot.gov/ | lists the Sept 25 and Aug 28, 2026 lettings |
| `letting-list-2026-09-25.html.gz` | /DW_Pages/NTC/2026/NTC_September_25_2026.html | 17 |
| `letting-list-2026-08-28.html.gz` | /DW_Pages/NTC/2026/NTC_August_28_2026.html | 15 (2 withdrawn) |

Both lettings had already opened at capture time; the tests inject an
earlier `now` to read them as upcoming.

md5 of the uncompressed files:

```
9c80ef7ba2923e7b48997ad27aa2d9b7  index-2026-10-01.html
734a155cc8b876d7edb00938f8f76aa2  letting-list-2026-09-25.html
9c3930b03cea987ec9d476a55b9019c6  letting-list-2026-08-28.html
```
