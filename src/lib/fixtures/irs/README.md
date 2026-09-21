# IRS fixtures — provenance

These five files are the ONLY IRS bytes the Nonprofit Free test suite is allowed to read.
They are small, committed WINDOWS of the real, official IRS bulk downloads — not
hand-written data and not generated — so the parser, the mirror diff and the verification
engine are all tested against the live formats (CRLF, pipe-delimited, 28 columns, the
zero-padded EIN) with **zero network** in the default run
(`bun test src/lib/nonprofit-free.test.ts`, the owner's test-determinism guardrail).

**Fetched:** 2026-09-21 (the same day the sources were verified in
`/home/team/shared/nonprofit-free-teos-research-2026-09-21.md`).
**IRS posting date of the extract window:** 2026-09-08 (the files themselves are the
2026-09-07 build the IRS posted on 9/8/2026; the landing-page fixture states it verbatim).
**Hashes:** `sha256sum src/lib/fixtures/irs/*`, of the bytes as committed (no `.gitattributes`
filter is applied anywhere in this repo).

| fixture | source URL | bytes | sha256 |
|---|---|---|---|
| `eo-bmf.csv` | `https://www.irs.gov/pub/irs-soi/eo1.csv` (region 1 of 4; rows kept: the Maine/MA window this PR needs, header + 8 data rows, CRLF preserved) | 1706 | `07c337352dd70d45dbcfa52c6690bd00541fc1131d6b0c792532c5f3f7d26184` |
| `eo-bmf-landing-window.html` | `https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf` (window containing the published posting date and record count) | 1500 | `c44f6216b67d4b160110a57f88f613e8ccb0df461b5fc32b47afcea83b6267d4` |
| `pub78.txt` | `https://apps.irs.gov/pub/epostcard/data-download-pub78.zip` → member `data-download-pub78.txt` (4 records, 6 pipe fields, blank leading lines kept) | 309 | `58abc004059a1b6c9669733d2edbe56db2c75eb28174b6d13199e5d0a4473d2f` |
| `pub78-zip-head.bin` | the first 512 bytes of the same `data-download-pub78.zip` (the local file header + member name + start of the deflate stream) | 512 | `9dc5fca0fae3e7818064a33f6579c50cbb0f963309da357eae3fe4e8fa0ab954` |
| `revocations.txt` | `https://apps.irs.gov/pub/epostcard/data-download-revocation.zip` → member `data-download-revocation.txt` (7 rows, 12 pipe fields, `DD-MON-YYYY` dates, one EIN repeat) | 865 | `5e01a436d262b11efbab4ce2823759c6546c30cb9688c6c474946ce8c2b2891c` |

## What each fixture is used to prove

- **`eo-bmf.csv`** — the 28-column header is asserted verbatim (`parseBmfHeader`), the
  leading zero survives (`010488538`), the section-3 rows exercise the decision table:
  `010488538` 501(c)(3)/STATUS 01 (auto-approve) · `010021545` Maine State Chamber of
  Commerce, SUBSECTION `06` (501(c)(6) business league → **manual review**, owner's
  501(c)(3)-only decision) · `010214019` SUBSECTION `92` + STATUS `12` · `010261396`
  STATUS `25` · `010163098` GROUP `2347` (group-exemption subordinate).
- **`eo-bmf-landing-window.html`** — the completeness proof's ONLY external anchor:
  `parseBmfPublication` must read `9/8/2026` and `1,964,958` off the real markup. The IRS
  sends no `Content-Length` and ignores byte ranges, so this published count is what makes
  an incomplete mirror impossible to mistake for a small one.
- **`pub78.txt` / `pub78-zip-head.bin`** — pipe splitting with commas inside the
  deductibility code (`EO,LODGE`), and the zip reader (`readZipLocalHeader` /
  `readZipMember`) against a real deflate stream rather than a synthesised one.
- **`revocations.txt`** — the required NEGATIVE signal: an EIN can repeat (identity is the
  row content, not the EIN), and `010116380` / `010011694` are the two EINs that also
  appear in the BMF window, which is what the post-refresh reverify test relies on.

## Rules for changing these files

1. **Never hand-edit a fixture.** Re-fetch from the URL above; keep the window small and
   the format exact (line endings included).
2. If a byte changes, update its byte count and hash in this table **in the same commit** —
   a fixture whose hash no longer matches this file is an untraceable input.
3. A live check is a separate, explicit command (`bun run validate:live-sources`-style
   pattern, or the mirror's `--verify` mode); it is never part of `bun test`.
