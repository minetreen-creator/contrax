# Wisconsin DOA VendorNet Bids fixtures (`wi_vendornet`)

Read only by tests (`readFileSync` via `import.meta.url`), never by app code.

| File | What it is | Bytes | md5 |
|---|---|---|---|
| `vendornet-openonly-2026-10-06.json` | ONE driver envelope captured verbatim from a real headless read of `https://vendornet.wi.gov/Bids` — the Open-Only filter applied through the grid's own UI, both pages of that set | 37,682 | `c40079ae52821692f6662a1425b2548f` |

## Provenance of `vendornet-openonly-2026-10-06.json`

* **Captured** 2026-10-06 at `05:29:16.423Z` (`2026-10-06 00:29 CT`) by
  `.github/scripts/vendornet-bids-fetch.mjs` — the connector's own driver, run
  unmodified (`WI_VENDORNET_OUT=…`, `CHROME_BIN=/usr/local/bin/chromium`).
* **Where:** a Linux sandbox host with a real headless **Chrome for Testing
  153.0.8010.12** (`browser.launchMode = executablePath:/usr/local/bin/chromium`).
  This is a LOCAL capture, not a runner capture: the same driver was proved to work
  on `ubuntu-latest` during the Phase-1 spike (`BROWSER_LAUNCH_MODE =
  channel:'chrome'`, Chrome 154.0.8037.57, PR #582 run 37415116476). The render path
  (Blazor circuit → WebSocket → Telerik grid) and the DOM anchors are the same on
  both; the runner's Chrome is a patch-level import. Re-capture here if a variant
  ever disagrees, and re-capture on the runner in the live gate.
* **Filter actually applied** (read back from the form after the re-render):
  `Due Date Start = 2026-10-06` (Central), `Include Awarded Bids = false`,
  `Include Canceled Bids = false`, `Bid Type = All`, `Available Start`/`Available
  End`/`Due Date End` blank. Header pagination was moved to the grid's largest
  offered page size (**50**, options observed `10 / 25 / 50`) before filtering.
* **What the page showed:** unfiltered baseline `1 - 10 of 7,841 items`; after the
  open-only filter the grid's OWN footer read `1 - 50 of 56 items`, and page 2
  `51 - 56 of 56 items` ⇒ **56 open items**, 56 rows read over 2 pages.
* **Transport proof inside the envelope:** `blazor.negotiations = 1`,
  `negotiateStatus = 200`, `webSocketCreated = 1`, `webSocketFramesReceived = 113`,
  `webSocketHandshakeFailures = 0` — i.e. the rows really arrived over the SignalR
  WebSocket, not from the 3.8 KB shell.
* **Wall clock:** `elapsedMs = 18,393` (18.4 s) for launch + baseline + page-size +
  filter + 2 pages. The Phase-1 spike measured 73 s for 6 navigations at page size
  10; the collector is faster because it reads the open set in 2 renders.
* **Checksum:** the file is committed **byte-for-byte** as written by the driver
  (`c40079ae52821692f6662a1425b2548f`, 37,682 bytes). It is NOT hand-edited, NOT
  trimmed and NOT reformatted. Evidence copy (payload + driver log):
  `shared/vendornet-phase2-2026-10-06/`.

## What the tests derive from it (and why that is honest)

The committed file is the real capture. Cases the tests need but which the live board
happened to not contain at capture time (an empty ref cell, an unparseable due date,
a duplicate id, an honest-empty board, a broken envelope) are **derived in-test by
copying the parsed envelope and editing the one field under test** — never by editing
the fixture on disk. Each such edit is commented with the field it changes, so a
reader can always tell a real capture from a constructed case.

Do NOT edit the fixture. Re-capture instead:
`bun run validate:live-bids-sources` (or the opt-in command in
`wi-vendornet.source-validation.test.ts`) runs the real driver against the live board.
