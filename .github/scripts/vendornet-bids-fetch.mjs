/**
 * Wisconsin DOA VendorNet Bids — HEADLESS COLLECTOR DRIVER (Phase 2).
 *
 * WHAT THIS IS. `vendornet.wi.gov/Bids` is a Blazor Server + Telerik grid: the HTML
 * shell carries ZERO rows and the rows arrive over `/_blazor/negotiate` (HTTP 200)
 * + a WebSocket (`wss://…/_blazor?id=…`, handshake 101). There is no REST/JSON
 * endpoint (`/api/bids` → 404) and no ETag/Last-Modified on any payload that
 * contains data, so there is nothing to conditional-GET. A browser is therefore the
 * only way to read this source, and this file IS that browser — the driver half of
 * the `wi_vendornet` collector.
 *
 * SPLIT OF RESPONSIBILITY (deliberate, and the reason this file holds no parsing):
 *   · THIS FILE renders the page, drives the grid's own controls to the honest
 *     open-only filter, pages to the end of that set, and writes ONE JSON envelope
 *     of what the page actually showed (cell text as rendered, plus the grid's own
 *     footer count). It never decides what a row MEANS.
 *   · `src/jobs/sources/wi-vendornet.ts` parses that envelope into `bids` rows
 *     (identity, due-date parsing, slug fallback, skip accounting). Every rule
 *     about meaning is in the tested TypeScript module; this file only observes.
 *
 * THE OPEN-ONLY FILTER (owner-locked, plan §1.3 — the definition the product copy
 * describes): Due Date Start = today in America/Chicago; Include Awarded Bids OFF;
 * Include Canceled Bids OFF; Bid Type left at All; both Available-range fields left
 * blank. Anything else is refused, because a narrower filter would hide rows and
 * imply a completeness we cannot prove, and a wider one would mix awarded/canceled
 * rows into an "open" set. Deep-linking is NOT used: the spike PROVED the grid
 * ignores `?dueDateStart=…&includeAwarded=false` and renders its pristine state
 * (7,841 items), so every filter is driven through the UI and read back.
 *
 * FAIL-CLOSED (never "zero rows" for a page we could not read): a grid that never
 * renders, a missing footer count, a filter that did not take, a count > 0 with 0
 * rendered rows, a pager that does not move, a page cap hit, or a deadline exceeded
 * all exit NON-ZERO with the exact stage named. A payload is written ONLY on
 * success, and the parser independently re-checks the envelope's arithmetic.
 *
 * WHAT THIS MUST NEVER DO:
 *   · no database access (imports no app module, no `~/db`, no @neondatabase);
 *   · no writes anywhere except the file named by WI_VENDORNET_OUT;
 *   · no unfiltered crawl — the grid's unfiltered set was 7,841 items at page
 *     size 10, which is ~785 pages; only the open-only set is read, and the crawl
 *     is capped (WI_VENDORNET_MAX_PAGES, default 20);
 *   · never change Bid Type, never fill the Available date range, never infer a
 *     status from a row's absence.
 *
 * ENVIRONMENT (all optional except the output path):
 *   WI_VENDORNET_OUT            output JSON path (default ./wi-vendornet-payload.json)
 *   WI_VENDORNET_BASE_URL       default https://vendornet.wi.gov/Bids
 *   WI_VENDORNET_DEADLINE_MS    hard wall clock, default 8 min
 *   WI_VENDORNET_MAX_PAGES      default 20
 *   WI_VENDORNET_PAGE_SIZE      requested items-per-page, default 50 (max offered)
 *   WI_VENDORNET_POLITE_MS      delay between pager actions, default 2000
 *   CHROME_BIN                  explicit browser path (else channel:'chrome' first)
 *
 * RUNNING IT. puppeteer-core is installed EPHEMERALLY by the workflow into a temp
 * dir and this file is COPIED there, so Node resolves `puppeteer-core` from that
 * temp dir's node_modules and the repo manifest (package.json / bun.lock) is never
 * touched — the dependency is a workflow-time install, exactly as the Phase-1
 * spike proved (`/vendornet-bids-spike.yml`).
 *
 * Exit codes: 0 = payload written; 1 = fail-closed (stage + message in the log).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.TZ = 'America/Chicago'; // "today" must be Central, whatever the host clock is

const BASE_URL = process.env.WI_VENDORNET_BASE_URL || 'https://vendornet.wi.gov/Bids';
const OUT_PATH = process.env.WI_VENDORNET_OUT || path.resolve('wi-vendornet-payload.json');
const DEADLINE_MS = Number(process.env.WI_VENDORNET_DEADLINE_MS || 8 * 60 * 1000);
const MAX_PAGES = Number(process.env.WI_VENDORNET_MAX_PAGES || 20);
const REQUESTED_PAGE_SIZE = Number(process.env.WI_VENDORNET_PAGE_SIZE || 50);
const POLITE_MS = Number(process.env.WI_VENDORNET_POLITE_MS || 2000);
const RENDER_TIMEOUT_MS = 60_000;
const HARD_STOP_AT = Date.now() + DEADLINE_MS;
const EXPECTED_HOST = 'vendornet.wi.gov';
const HEADERS = [
  'Solicitation Reference #',
  'Title',
  'Organization',
  'Available Date',
  'Due Date',
  'Bid Type',
];

const t0 = Date.now();
const say = (m) => console.log(`[wi-vendornet ${String(Date.now() - t0).padStart(6)}ms] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stage = 'init';
let browser = null;
let page = null;
function fail(msg) {
  const e = new Error(msg);
  e.stage = stage;
  throw e;
}
function checkDeadline(label) {
  if (Date.now() > HARD_STOP_AT) fail(`deadline (${DEADLINE_MS}ms) exceeded before ${label}`);
}

/** puppeteer-core does not export its own version; read it from its package.json. */
function readPuppeteerVersion() {
  try {
    return createRequire(import.meta.url)('puppeteer-core/package.json').version;
  } catch (err) {
    return `unknown: ${String(err.message).split('\n')[0]}`;
  }
}

/** retry at most twice with backoff (2 s → 8 s) — plan §1.4 */
async function withRetry(label, fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < tries - 1) {
        const back = 2000 * Math.pow(3, i);
        say(`retry ${i + 1}/${tries - 1} for ${label} after ${back}ms — ${err.message}`);
        await sleep(back);
      }
    }
  }
  fail(`${label}: ${last && last.message}`);
}

/**
 * WAIT FOR A RENDERED GRID — the mistake this closes: the Blazor shell paints the
 * Telerik grid EMPTY ("0 - 0 of 0 items", header present, no body rows) before the
 * SignalR circuit delivers data, so reading too early looks exactly like an honest
 * empty set. This waits for the grid that actually carries data (or the source's own
 * "no items to display" marker), and times out LOUDLY instead of reading zeros.
 */
async function waitForRenderedGrid(label, { timeout = RENDER_TIMEOUT_MS, minRows = 1 } = {}) {
  try {
    await page.waitForFunction(
      (n) => {
        const w = window.__vn;
        if (!w || !w.readGrid) return false;
        const g = w.readGrid();
        if (g.footerKind === 'no-items') return true;
        return g.totalItems !== null && g.totalItems > 0 && g.rowCount >= n;
      },
      { timeout, polling: 500 },
      minRows,
    );
  } catch (err) {
    const g = await page.evaluate(() => (window.__vn ? window.__vn.readGrid() : null)).catch(() => null);
    fail(
      `the grid did not render rows for ${label} within ${timeout}ms (last read: ` +
        `${g ? `"${g.footerText}" rows=${g.rowCount}` : 'no grid helper'}); ` +
        `${String(err.message).split('\n')[0]}`,
    );
  }
}

/** Central-Time "today" as YYYY-MM-DD (the value semantics the grid commits) */
function centralToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function mmddyyyy(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// ── Browser-side helpers ────────────────────────────────────────────────────
// Installed via evaluateOnNewDocument so they survive every Blazor re-render.
// Everything is LABEL-driven with class-based fallbacks: the grid is a rendered
// Telerik component and its class names are not a contract. (No outer-scope
// references — puppeteer serialises this function.)
function installHelpers() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const labelEl = (text, root = document) => {
    const re = new RegExp('^\\s*' + esc(text) + '\\s*:?\\s*$', 'i');
    const all = Array.from(
      root.querySelectorAll('label, span, div, p, th, td, legend, strong, b, button'),
    );
    const leaf = all.filter((el) => re.test(norm(el.textContent)));
    if (!leaf.length) return null;
    return leaf.find((el) => el.tagName === 'LABEL') || leaf[leaf.length - 1];
  };

  const buttonByText = (text) => {
    const re = new RegExp('^\\s*' + esc(text) + '\\s*$', 'i');
    const cands = Array.from(
      document.querySelectorAll('button, a, input[type="submit"], input[type="button"], span'),
    );
    const matches = cands.filter((el) => re.test(norm(el.textContent || el.value)));
    return (
      matches.find((el) => el.tagName === 'BUTTON') ||
      matches.find((el) => el.tagName === 'A') ||
      matches.find((el) => el.tagName === 'INPUT') ||
      matches[0] ||
      null
    );
  };

  const controlFor = (labelText, selector) => {
    const lab = labelEl(labelText);
    if (!lab) return { el: null, via: 'label-not-found' };
    if (lab.tagName === 'BUTTON' || (lab.tagName === 'INPUT' && /submit|button/i.test(lab.type))) {
      return { el: lab, via: 'label-is-button' };
    }
    if (lab.htmlFor) {
      const byId = document.getElementById(lab.htmlFor);
      if (byId) return { el: byId, via: 'label[for]' };
    }
    let node = lab.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      const hit = node.querySelector ? node.querySelector(selector) : null;
      if (hit) return { el: hit, via: 'ancestor(' + (i + 1) + ')' };
      node = node.parentElement;
    }
    const form = lab.closest('form') || document;
    const hit = form.querySelector(selector);
    return hit ? { el: hit, via: 'form-query' } : { el: null, via: 'not-found' };
  };

  const tag = (el, id) => {
    if (!el) return false;
    el.setAttribute('data-vn-id', id);
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  };

  const footerEl = () => {
    const byClass = document.querySelector('.k-pager-info, .k-grid-pager .k-pager-info');
    if (byClass) return byClass;
    const cands = Array.from(document.querySelectorAll('span, div, td, li, p'));
    const whole = cands.find((e) =>
      /^\d+\s*-\s*\d+\s+of\s+[\d,]+\s+items$/i.test(norm(e.textContent)),
    );
    if (whole) return whole;
    const loose = cands
      .filter((e) => /\bof\s+[\d,]+\s+items\b/i.test(norm(e.textContent)) && e.children.length === 0)
      .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
    if (loose.length) return loose[0];
    return (
      cands.find(
        (e) =>
          /^(no items to display|no records? (to display|available))/i.test(norm(e.textContent)) &&
          e.children.length === 0,
      ) || null
    );
  };

  const gridTable = () => {
    const tables = Array.from(document.querySelectorAll('table'));
    return (
      tables.find(
        (t) =>
          /solicitation\s*ref/i.test(t.textContent || '') &&
          t.querySelectorAll('tbody tr').length > 0,
      ) ||
      tables.find((t) => t.querySelectorAll('tbody tr').length > 0) ||
      null
    );
  };

  const readGrid = () => {
    const f = footerEl();
    const footerText = f ? norm(f.textContent) : null;
    let totalItems = null;
    let footerKind = 'absent';
    if (footerText) {
      const m = footerText.match(/of\s+([\d,]+)\s+items/i);
      if (m) {
        totalItems = Number(m[1].replace(/,/g, ''));
        footerKind = 'count';
      } else if (/no items to display|no records?/i.test(footerText)) {
        totalItems = 0;
        footerKind = 'no-items';
      } else {
        footerKind = 'other';
      }
    }
    const range = footerText ? footerText.match(/^\s*(\d+)\s*-\s*(\d+)\s+of/i) : null;

    const table = gridTable();
    const headerText = (t) =>
      Array.from(t.querySelectorAll('thead th, thead td, th')).map((th) => norm(th.textContent)).filter(Boolean);
    let headers = [];
    let headerSource = 'none';
    const headerTable = Array.from(document.querySelectorAll('table')).find(
      (t) => /solicitation\s*ref/i.test(t.textContent || '') && !t.querySelector('tbody tr'),
    );
    if (table && table.querySelector('thead th')) {
      headers = headerText(table);
      headerSource = 'own-thead';
    } else if (headerTable) {
      headers = headerText(headerTable);
      headerSource = 'document-header-table';
    } else {
      const headerEl = document.querySelector('.k-grid-header, .k-grid-header-wrap');
      if (headerEl) {
        headers = Array.from(headerEl.querySelectorAll('th')).map((th) => norm(th.textContent)).filter(Boolean);
        headerSource = 'k-grid-header';
      }
    }

    const rawRows = table
      ? Array.from(table.querySelectorAll('tbody tr'))
          .filter(
            (tr) => !tr.classList.contains('k-grid-norecords') && !tr.classList.contains('k-no-data'),
          )
          .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => norm(td.textContent)))
          .filter((cells) => cells.length > 0)
      : [];

    const labelIdx = (re) => headers.findIndex((h) => re.test(h));
    let idx = {
      ref: labelIdx(/solicitation\s*ref/i),
      title: labelIdx(/^title$/i),
      organization: labelIdx(/organization|buyer|agency/i),
      available: labelIdx(/available/i),
      due: labelIdx(/due\s*date/i),
      bidType: labelIdx(/bid\s*type/i),
    };
    let mapping = 'header-labels';
    if (idx.ref < 0 || idx.title < 0) {
      const width = rawRows.length ? Math.max(...rawRows.map((r) => r.length)) : 0;
      if (width === 6) {
        // documented display order: Ref #, Title, Organization, Available Date, Due Date, Bid Type
        idx = { ref: 0, title: 1, organization: 2, available: 3, due: 4, bidType: 5 };
        mapping = 'positional-documented-order-6-cols';
      } else {
        mapping = 'unmapped';
      }
    }
    const at = (cells, i) => (i >= 0 && i < cells.length ? norm(cells[i]) : null);
    const rows = rawRows.map((cells) => ({
      ref: at(cells, idx.ref),
      title: at(cells, idx.title),
      organization: at(cells, idx.organization),
      available_date: at(cells, idx.available),
      due_date: at(cells, idx.due),
      bid_type: at(cells, idx.bidType),
      cells,
    }));

    return {
      footerText,
      totalItems,
      footerKind,
      rangeStart: range ? Number(range[1]) : null,
      rangeEnd: range ? Number(range[2]) : null,
      headers,
      headerSource,
      columnMapping: mapping,
      columnIndexes: idx,
      rowCount: rows.length,
      rows,
      firstRef: rows.length ? rows[0].ref : null,
      refs: rows.map((r) => r.ref),
    };
  };

  const readForm = () => {
    const text = (label, sel) => {
      const c = controlFor(label, sel);
      return c.el ? { value: c.el.value == null ? null : c.el.value, via: c.via } : { value: null, via: c.via };
    };
    const chk = (label) => {
      const c = controlFor(label, 'input[type="checkbox"]');
      return c.el ? { checked: !!c.el.checked, via: c.via } : { checked: null, via: c.via };
    };
    const selOne = (label) => {
      const c = controlFor(label, 'select');
      if (!c.el) {
        const c2 = controlFor(label, 'input, .k-dropdownlist, .k-input');
        return { value: c2.el ? norm(c2.el.textContent || c2.el.value) : null, via: c.via + '+nonselect' };
      }
      const opt = c.el.options && c.el.options[c.el.selectedIndex];
      return { value: opt ? norm(opt.textContent) : c.el.value, via: c.via };
    };
    return {
      dueDateStart: text('Due Date Start', 'input'),
      dueDateEnd: text('Due Date End', 'input'),
      availableStart: text('Available Start', 'input'),
      availableEnd: text('Available End', 'input'),
      bidType: selOne('Bid Type'),
      includeAwarded: chk('Include Awarded Bids'),
      includeCanceled: chk('Include Canceled Bids'),
    };
  };

  const pagerRoot = () => {
    const cls = document.querySelector('.k-pager-wrap, .k-grid-pager, .k-pager');
    if (cls) return cls;
    let n = footerEl();
    for (let i = 0; i < 6 && n; i++) {
      if (n.querySelector && n.querySelector('a, button')) return n;
      n = n.parentElement;
    }
    return null;
  };

  /** the pager control that moves to page `n` (numbered link, else next button) */
  const pagerPageLink = (n) => {
    const root = pagerRoot();
    if (!root) return { el: null, kind: 'pager-not-found' };
    const numbered = Array.from(root.querySelectorAll('a, button, li, span')).find(
      (e) => norm(e.textContent) === String(n) && !e.querySelector('a,button'),
    );
    if (numbered) return { el: numbered, kind: 'numbered' };
    const next = root.querySelector(
      '[aria-label*="next" i], [title*="next" i], .k-pager-nav:last-child, .k-i-arrow-60-right',
    );
    if (next) return { el: next, kind: 'next-button' };
    return { el: null, kind: 'page-link-not-found' };
  };

  const pageSizeInfo = () => {
    const root = pagerRoot() || document;
    const sel = root.querySelector('select.k-pager-sizes, .k-pager-sizes select');
    if (sel) {
      return {
        kind: 'native-select',
        options: Array.from(sel.options).map((o) => norm(o.textContent)),
        current: sel.value,
      };
    }
    const dd = root.querySelector('.k-pager-sizes .k-dropdownlist, .k-pager-sizes .k-input, .k-pager-sizes .k-dropdown');
    if (dd) return { kind: 'telerik-dropdown', options: null, current: norm(dd.textContent), needsClick: true };
    return { kind: 'not-found', options: null, current: null };
  };

  const openListOptions = () =>
    Array.from(
      document.querySelectorAll(
        '.k-popup .k-list-item, .k-list-container .k-list-item, .k-animation-container .k-list-item',
      ),
    )
      .map((i) => norm(i.textContent))
      .filter(Boolean);

  window.__vn = {
    norm,
    labelEl,
    buttonByText,
    controlFor,
    tag,
    footerEl,
    gridTable,
    readGrid,
    readForm,
    pagerRoot,
    pagerPageLink,
    pageSizeInfo,
    openListOptions,
  };
}

// ── Launch ─────────────────────────────────────────────────────────────────
async function launch() {
  const puppeteer = (await import('puppeteer-core')).default;
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote'];
  const attempts = [];
  const candidates = [];
  // channel:'chrome' is how the GitHub runner was proven to work (spike evidence:
  // BROWSER_LAUNCH_MODE=channel:'chrome', /opt/google/chrome/chrome).
  candidates.push({ label: "channel:'chrome'", opts: { channel: 'chrome', headless: true, args } });
  const explicit = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/chromium',
    '/opt/google/chrome/chrome',
  ].filter(Boolean);
  for (const p of explicit) {
    if (fs.existsSync(p)) candidates.push({ label: `executablePath:${p}`, opts: { executablePath: p, headless: true, args } });
  }
  if (process.env.CHROME_BIN) {
    candidates.push({ label: `env:${process.env.CHROME_BIN}`, opts: { executablePath: process.env.CHROME_BIN, headless: true, args } });
  }
  for (const c of candidates) {
    try {
      const b = await puppeteer.launch(c.opts);
      say(`browser launched via ${c.label}`);
      return { browser: b, mode: c.label };
    } catch (err) {
      attempts.push(`${c.label}: ${String(err.message).split('\n')[0]}`);
      say(`launch attempt failed (${c.label}): ${String(err.message).split('\n')[0]}`);
    }
  }
  fail(`could not launch a browser. Attempts: ${attempts.join(' | ')}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
const E = {
  v: 1,
  source: 'wi_vendornet',
  endpoint: BASE_URL,
  capturedAt: null,
  captureTimezone: 'America/Chicago',
  driver: {
    file: 'vendornet-bids-fetch.mjs',
    node: process.version,
    puppeteerCore: readPuppeteerVersion(),
  },
  expectedHeaders: HEADERS,
};

async function main() {
  stage = 'launch';
  const launched = await launch();
  browser = launched.browser;
  E.browser = { launchMode: launched.mode, version: await browser.version(), executablePath: browser.process()?.spawnfile ?? null };

  page = await browser.newPage();
  await page.evaluateOnNewDocument(installHelpers);
  await page.setViewport({ width: 1440, height: 1200 });

  // SignalR / WebSocket connectivity — a page that renders rows at all IS the
  // WebSocket proof; record it explicitly rather than assuming it.
  const ws = { created: 0, framesReceived: 0, handshakeFailures: 0 };
  let negotiations = 0;
  let negotiateStatus = null;
  page.on('response', (r) => {
    if (r.url().includes('/_blazor/negotiate')) {
      negotiations += 1;
      negotiateStatus = r.status();
    }
  });
  try {
    const client = await page.createCDPSession();
    await client.send('Network.enable');
    client.on('Network.webSocketCreated', () => {
      ws.created += 1;
    });
    client.on('Network.webSocketFrameReceived', () => {
      ws.framesReceived += 1;
    });
    client.on('Network.webSocketHandshakeResponseReceived', (p) => {
      if (p && p.response && p.response.status !== 101) ws.handshakeFailures += 1;
    });
  } catch (err) {
    say(`CDP websocket instrumentation unavailable (${String(err.message).split('\n')[0]})`);
  }

  stage = 'navigate';
  const navStart = Date.now();
  const resp = await withRetry('baseline navigation', () =>
    page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS }),
  );
  E.baselineHttpStatus = resp ? resp.status() : null;
  if (!resp || !resp.ok()) fail(`baseline navigation returned HTTP ${resp ? resp.status() : 'no response'}`);
  await waitForRenderedGrid('the unfiltered baseline');
  E.navigationMs = Date.now() - navStart;

  stage = 'baseline-read';
  const baseline = await page.evaluate(() => window.__vn.readGrid());
  E.baseline = {
    footerText: baseline.footerText,
    totalItems: baseline.totalItems,
    rowCount: baseline.rowCount,
    headers: baseline.headers,
    headerSource: baseline.headerSource,
    columnMapping: baseline.columnMapping,
    columnIndexes: baseline.columnIndexes,
    firstRef: baseline.firstRef,
  };
  const baselineForm = await page.evaluate(() => window.__vn.readForm());
  E.baselineForm = baselineForm;
  if (!baseline.footerText) fail('the grid rendered with no footer count text — cannot establish a baseline');
  if (!baseline.headers.length) fail('the grid header labels were not found — row/column meaning cannot be established');
  if (baseline.columnMapping === 'unmapped') fail('the rendered rows could not be mapped to the 6 documented columns');
  say(`baseline: "${baseline.footerText}", ${baseline.rowCount} rows, headers via ${baseline.headerSource}`);

  // ── items per page → the largest option the grid offers ──────────────────
  stage = 'page-size';
  const sizeInfo = await page.evaluate(() => window.__vn.pageSizeInfo());
  E.pageSize = { requested: REQUESTED_PAGE_SIZE, before: sizeInfo.current, kind: sizeInfo.kind, options: sizeInfo.options };
  if (sizeInfo.kind === 'telerik-dropdown') {
    // Telerik dropdown: options exist only once opened.
    let tagged = await page.evaluate(
      () => window.__vn.tag(window.__vn.pagerRoot().querySelector('.k-pager-sizes .k-dropdownlist, .k-pager-sizes .k-input'), 'page-size'),
    );
    if (!tagged) fail('the items-per-page control could not be tagged');
    await withRetry('open items-per-page list', async () => {
      const h = await page.$('[data-vn-id="page-size"]');
      if (!h) fail('items-per-page control disappeared');
      const box = await h.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) await h.click();
      else await page.evaluate(() => document.querySelector('[data-vn-id="page-size"]')?.click());
    });
    await sleep(400);
    const opts = await page.evaluate(() => window.__vn.openListOptions());
    E.pageSize.openedOptions = opts;
    const numeric = opts.map((o) => Number(o)).filter((n) => Number.isFinite(n) && n > 0);
    const target = Math.max(REQUESTED_PAGE_SIZE, ...(numeric.length ? numeric : [0]));
    const wanted = numeric.includes(target) ? target : Math.max(...(numeric.length ? numeric : [0]));
    if (!wanted) fail(`no numeric items-per-page option was offered (saw ${JSON.stringify(opts)})`);
    const clicked = await page.evaluate((label) => {
      const items = Array.from(document.querySelectorAll('.k-popup .k-list-item, .k-list-container .k-list-item, .k-animation-container .k-list-item'));
      const hit = items.find((i) => window.__vn.norm(i.textContent) === String(label));
      if (!hit) return false;
      hit.click();
      return true;
    }, wanted);
    if (!clicked) fail(`could not select the ${wanted}-per-page option`);
    E.appliedPageSize = wanted;
  } else if (sizeInfo.kind === 'native-select') {
    const numeric = (sizeInfo.options || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const wanted = Math.max(...(numeric.length ? numeric : [0]));
    if (!wanted) fail(`no numeric items-per-page option was offered (saw ${JSON.stringify(sizeInfo.options)})`);
    await page.evaluate((label) => {
      const sel = window.__vn.pagerRoot().querySelector('select.k-pager-sizes, .k-pager-sizes select');
      const opt = Array.from(sel.options).find((o) => window.__vn.norm(o.textContent) === String(label));
      if (!opt) return false;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, wanted);
    E.appliedPageSize = wanted;
  } else {
    E.appliedPageSize = null; // the grid offers no page-size control; page at its default
    say('no items-per-page control found — crawling at the grid default page size');
  }
  await sleep(1200);

  // The state the filter will be applied FROM (page size already at its maximum,
  // still unfiltered). The post-filter wait below compares against THIS, because
  // the page-size change alone already moves the footer text.
  const preFilter = await page.evaluate(() => window.__vn.readGrid());
  E.preFilter = { footerText: preFilter.footerText, totalItems: preFilter.totalItems };

  // ── the open-only filter, driven through the UI and read back ─────────────
  stage = 'filter';
  const todayIso = centralToday();
  E.filterRequested = {
    dueDateStart: todayIso,
    dueDateEnd: null,
    bidType: 'All',
    includeAwarded: false,
    includeCanceled: false,
    availableStart: null,
    availableEnd: null,
  };

  // Due Date Start: real keystrokes (the grid commits ISO YYYY-MM-DD on blur/Tab,
  // even when MM/DD/YYYY is typed), then Tab to commit, then read it back.
  const typed = await page.evaluate(() => {
    const c = window.__vn.controlFor('Due Date Start', 'input');
    if (!c.el) return false;
    return window.__vn.tag(c.el, 'due-start');
  });
  if (!typed) fail('the Due Date Start input was not found (the filter cannot be set)');
  const input = await page.$('[data-vn-id="due-start"]');
  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await input.type(mmddyyyy(todayIso), { delay: 40 });
  await page.keyboard.press('Tab');
  await sleep(1500);

  // Awarded / Canceled OFF. These are styled Bootstrap switches: the INPUT has no
  // clickable box, so the label is clicked (the spike's proven recipe: found via
  // label[for], clicked via the label, state READ BACK after the Blazor round trip,
  // ≤3 attempts). Blazor re-renders swap nodes, so every attempt RE-DISCOVERS and
  // re-tags rather than trusting a tag applied earlier.
  const setToggleOff = async (labelText, id) => {
    const find = () =>
      page.evaluate(
        (a) => {
          const v = window.__vn;
          const c = v.controlFor(a.labelText, 'input[type="checkbox"]');
          if (!c.el) return { found: false, via: c.via };
          v.tag(c.el, a.id);
          let labelTagged = false;
          const lab = c.el.id ? document.querySelector('label[for="' + c.el.id + '"]') : null;
          const box = (lab && lab.closest) || (c.el.closest ? c.el.closest('.form-check, .form-switch, .k-form-field, .mb-3') : null);
          const labEl = lab || (box ? box.querySelector('label') : null);
          if (labEl) labelTagged = v.tag(labEl, a.id + '-label');
          return { found: true, via: c.via, checked: !!c.el.checked, disabled: !!c.el.disabled, labelTagged };
        },
        { labelText, id },
      );
    const found = await find();
    if (!found.found) fail(`the "${labelText}" control was not found (${found.via}) — the open-only filter cannot be set`);
    if (found.disabled) fail(`the "${labelText}" control is disabled — the open-only filter cannot be set`);
    if (found.checked === false) return 'already-off';
    return await withRetry(
      `switch "${labelText}" off`,
      async () => {
        const cur = await find();
        if (cur.checked === false) return 'already-off';
        let clicked = null;
        const candidates = (cur.labelTagged ? [id + '-label', id] : [id]).filter(Boolean);
        for (const sel of candidates) {
          const h = await page.$('[data-vn-id="' + sel + '"]');
          if (!h) continue;
          const box = await h.boundingBox().catch(() => null);
          if (box && box.width > 0 && box.height > 0) {
            try {
              await h.click();
              clicked = sel;
            } catch (err) {
              say(`mouse click on ${sel} failed (${String(err.message).split('\n')[0]}) — falling back to element.click()`);
            }
          }
          if (!clicked) {
            await page.evaluate((s) => {
              const el = document.querySelector('[data-vn-id="' + s + '"]');
              if (el) el.click();
            }, sel);
            clicked = sel + '(js)';
          }
          break;
        }
        if (!clicked) fail(`could not click the "${labelText}" control`);
        await sleep(500);
        const after = await find();
        if (after.checked !== false) throw new Error(`the toggle did not go OFF via ${clicked} (still checked=${after.checked})`);
        return clicked;
      },
      3,
    );
  };
  const awardedAction = await setToggleOff('Include Awarded Bids', 'chk-awarded');
  await sleep(2500); // Blazor round-trip before the next action
  const canceledAction = await setToggleOff('Include Canceled Bids', 'chk-canceled');
  await sleep(2500);
  E.toggles = { includeAwarded: awardedAction, includeCanceled: canceledAction };


  // Search — the spike proved the grid already auto-applies when the controls
  // commit, so "no change on Search" is not a failure; clicking it is still done.
  stage = 'search';
  const searchTagged = await page.evaluate(() => {
    const b = window.__vn.buttonByText('Search');
    if (!b) return false;
    return window.__vn.tag(b, 'search');
  });
  if (!searchTagged) fail('the Search control was not found');
  await withRetry('click Search', async () => {
    const h = await page.$('[data-vn-id="search"]');
    if (!h) fail('Search control disappeared');
    const box = await h.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) await h.click();
    else await page.evaluate(() => document.querySelector('[data-vn-id="search"]')?.click());
  });
  await sleep(POLITE_MS);

  stage = 'filter-verify';
  // WAIT FOR THE FILTERED RE-RENDER (never trust a fixed sleep): the grid's own
  // count must move away from the pre-filter count, or the source must say "no
  // items". The Blazor round trip is variable and the read-back below is what
  // decides, but reading too early would report the unfiltered set as "open".
  try {
    await page.waitForFunction(
      (pre) => {
        const g = window.__vn.readGrid();
        if (g.footerKind === 'no-items') return true;
        return g.totalItems !== null && g.totalItems !== pre;
      },
      { timeout: RENDER_TIMEOUT_MS, polling: 500 },
      preFilter.totalItems,
    );
  } catch (err) {
    fail(
      `the grid never re-rendered away from the pre-filter count (${preFilter.totalItems}) after the filter was applied — ${String(err.message).split('\n')[0]}`,
    );
  }
  const formAfter = await page.evaluate(() => window.__vn.readForm());
  E.filterReadBack = formAfter;
  if (!formAfter.dueDateStart || String(formAfter.dueDateStart.value || '').trim() === '') {
    fail('Due Date Start did not take (it read back empty after typing)');
  }
  {
    // The grid commits ISO `YYYY-MM-DD` even though `MM/DD/YYYY` is typed, so accept
    // either shape — but a value that is a DIFFERENT calendar day means the filter is
    // not the open-only window and the run must stop.
    const raw = String(formAfter.dueDateStart.value || '').trim();
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : (() => {
          const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
        })();
    if (iso !== todayIso) fail(`Due Date Start read back "${raw}" (${iso ?? 'unparseable'}), expected Central today ${todayIso}`);
  }
  if (formAfter.includeAwarded.checked !== false) fail('Include Awarded Bids is still checked — refusing to read a mixed set');
  if (formAfter.includeCanceled.checked !== false) fail('Include Canceled Bids is still checked — refusing to read a mixed set');
  if (String(formAfter.bidType.value || '').trim().toLowerCase() !== 'all') {
    fail(`Bid Type is "${formAfter.bidType.value}" — only "All" is acceptable (never narrow the source set)`);
  }
  for (const f of ['availableStart', 'availableEnd', 'dueDateEnd']) {
    if (String(formAfter[f].value || '').trim() !== '') fail(`${f} was filled ("${formAfter[f].value}") — the open-only definition requires it blank`);
  }

  // ── page through the open-only set ────────────────────────────────────────
  stage = 'page';
  const first = await page.evaluate(() => window.__vn.readGrid());
  E.openOnly = {
    footerText: first.footerText,
    countFromSource: first.totalItems,
    footerKind: first.footerKind,
    rowCount: first.rowCount,
    headers: first.headers,
    headerSource: first.headerSource,
    columnMapping: first.columnMapping,
    columnIndexes: first.columnIndexes,
  };
  if (first.footerKind === 'absent') fail('no footer count text after filtering — cannot tell whether the set was read');
  if (first.footerKind === 'other') fail(`footer text "${first.footerText}" carries no count — refusing to guess`);
  if (first.columnMapping === 'unmapped') fail('filtered rows could not be mapped to the 6 documented columns');

  const pages = [];
  let expectedStart = 1;
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    checkDeadline(`page ${pageNo}`);
    const grid = pageNo === 1 ? first : await page.evaluate(() => window.__vn.readGrid());
    if (grid.columnMapping === 'unmapped') fail(`page ${pageNo}: rows could not be mapped to the 6 documented columns`);
    if (pageNo > 1) {
      if (grid.rangeStart !== expectedStart) {
        fail(`page ${pageNo}: footer range starts at ${grid.rangeStart}, expected ${expectedStart} — the grid reordered between pages, refusing to splice`);
      }
      if (grid.refs.length && pages[pages.length - 1].refs.includes(grid.refs[0])) {
        fail(`page ${pageNo}: first ref "${grid.refs[0]}" already appeared on the previous page — the pager did not move`);
      }
    }
    pages.push({
      page: pageNo,
      footerText: grid.footerText,
      rangeStart: grid.rangeStart,
      rangeEnd: grid.rangeEnd,
      countFromSource: grid.totalItems,
      rowCount: grid.rowCount,
      firstRef: grid.firstRef,
      refs: grid.refs,
      rows: grid.rows,
    });
    say(`page ${pageNo}: "${grid.footerText}" (${grid.rowCount} rows)`);
    const total = grid.totalItems ?? 0;
    const end = grid.rangeEnd ?? 0;
    if (total === 0) break;
    if (end >= total) break;
    if (pageNo === MAX_PAGES) {
      fail(`page cap (${MAX_PAGES}) reached with "${grid.footerText}" — the open-only set is larger than this collector is allowed to read in one run`);
    }
    stage = `page-${pageNo + 1}`;
    const nextTagged = await page.evaluate((n) => {
      const link = window.__vn.pagerPageLink(n);
      if (!link.el) return { ok: false, kind: link.kind };
      window.__vn.tag(link.el, 'pager-next');
      return { ok: true, kind: link.kind };
    }, pageNo + 1);
    if (!nextTagged.ok) fail(`page ${pageNo + 1}: pager control not found (${nextTagged.kind})`);
    await withRetry(`pager click to page ${pageNo + 1}`, async () => {
      const h = await page.$('[data-vn-id="pager-next"]');
      if (!h) fail('pager control disappeared');
      const box = await h.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) await h.click();
      else await page.evaluate(() => document.querySelector('[data-vn-id="pager-next"]')?.click());
    });
    await sleep(POLITE_MS);
    expectedStart = (grid.rangeEnd ?? 0) + 1;
    stage = 'page';
  }

  const rowsSeen = pages.reduce((s, p) => s + p.rowCount, 0);
  const countFromSource = first.totalItems ?? 0;
  if (countFromSource > 0 && rowsSeen < countFromSource) {
    fail(`read ${rowsSeen} rows but the source's own footer count says ${countFromSource} — refusing to emit a partial open set`);
  }
  if (countFromSource > 0 && rowsSeen === 0) fail('the source reports a non-zero count but rendered zero rows — parse failure, not an empty set');

  E.pages = pages;
  E.countFromSource = countFromSource;
  E.rowsSeen = rowsSeen;
  E.pagesRendered = pages.length;
  E.blazor = { negotiations, negotiateStatus, webSocketCreated: ws.created, webSocketFramesReceived: ws.framesReceived, webSocketHandshakeFailures: ws.handshakeFailures };
  E.capturedAt = new Date().toISOString();
  E.elapsedMs = Date.now() - t0;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(E, null, 2)}\n`);
  say(`payload written: ${OUT_PATH} (${rowsSeen} rows over ${pages.length} page(s), source count ${countFromSource})`);
}

main()
  .then(async () => {
    if (browser) await browser.close().catch(() => {});
    console.log(`WI_VENDORNET_DRIVER_OK stage=${stage} elapsedMs=${Date.now() - t0}`);
    process.exit(0);
  })
  .catch(async (err) => {
    if (browser) await browser.close().catch(() => {});
    console.error(`WI_VENDORNET_DRIVER_FAIL stage=${err && err.stage ? err.stage : stage} message=${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
