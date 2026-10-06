#!/usr/bin/env node
/**
 * VendorNet Bids (Wisconsin DOA) — PHASE 1 SPIKE PROBE (dry, read-only).
 * =====================================================================
 * Companion to `.github/workflows/vendornet-bids-spike.yml` (workflow_dispatch ONLY).
 * Owner green-lit the spike 2026-10-06; spec = shared/vendornet-bids-build-plan-2026-10-06.md §7 Phase 1.
 *
 * WHAT THIS PROVES (each becomes an evidence line, printed at the end as KEY=VALUE
 * plus one SPIKE_EVIDENCE_JSON_BEGIN/END blob, and written to OUT_DIR):
 *   1. a browser launches headless in the REAL GitHub-Actions runner image (+ its version)
 *   2. https://vendornet.wi.gov/Bids renders enough to scrape (footer "N items" / grid rows)
 *      + load-to-render wall-clock time
 *   3. DEEP-LINK TEST — can the Telerik grid's filter state be set by URL query params?
 *   4. the OPEN-ONLY filter driven through the UI (Due Date Start = today, America/Chicago;
 *      Include Awarded OFF; Include Canceled OFF; nothing else touched) + the source's OWN
 *      footer count  ⇒ the number the whole build depends on
 *   5. pagination: items-per-page options, per-page render wall-clock, page 2 via the pager
 *      (1.5–3 s polite delay) + first-row Solicitation Ref # on pages 1 and 2 (ordering identity)
 *   6. WebSocket / `_blazor/negotiate` connectivity in the runner's egress
 *   7. verbatim row shape (2–3 sample rows) + rows published with no Solicitation Ref #
 *   8. FAIL-CLOSED: a grid that never renders, an absent count text, or a filter that cannot
 *      be set exits NON-ZERO with the exact failing step — an empty result is never reported
 *      as success.
 *
 * WHAT THIS MUST NEVER DO (hard constraints from the task brief):
 *   · NO database access of any kind. This file imports no app module, no `~/db`, no
 *     `@neondatabase/serverless`; it reads only OUT_DIR / SPIKE_DEADLINE_MS / CHROME_BIN / TZ.
 *   · NO writes anywhere except OUT_DIR (artifacts: rendered DOM snapshots, JSON evidence,
 *     screenshots). Nothing is POSTed to VendorNet beyond what the site's own public search
 *     UI does (the Search button + one pager click).
 *   · it NEVER crawls the grid: the open-only set only, and it stops after page 2.
 *   · it never changes Bid Type (stays "All") and never fills the Available date range —
 *     either would hide rows and imply a completeness we cannot prove (plan §1.3).
 *
 * RUNNING IT: puppeteer-core is installed EPHEMERALLY by the workflow into a temp dir
 * ($RUNNER_TEMP/vendornet-spike) and this file is COPIED there so Node resolves
 * `puppeteer-core` from that temp dir's node_modules. The repo manifest (package.json /
 * bun.lock) is NEVER touched — the driver dependency is an owner decision (plan §7 #1).
 *
 * Exit codes: 0 = probe complete and honest; 1 = fail-closed (step named in the log).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.TZ = 'America/Chicago'; // "today" must be Central, whatever the runner's clock is

const BASE_URL = process.env.SPIKE_BASE_URL || 'https://vendornet.wi.gov/Bids';
const OUT_DIR = process.env.OUT_DIR || path.resolve('spike-evidence');
const DEADLINE_MS = Number(process.env.SPIKE_DEADLINE_MS || 9 * 60 * 1000); // inside the 15 min job cap
const HARD_STOP_AT = Date.now() + DEADLINE_MS;

const POLITE_MS = 2000; // 1.5–3 s between actions (plan §1.4)
const RENDER_TIMEOUT_MS = 60_000;

const E = {}; // THE evidence record
const artifacts = [];
let failedStep = null;
let page = null;
let browser = null;

const t0 = Date.now();
const now = () => new Date().toISOString();
const elapsed = () => Date.now() - t0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (k, v) => {
  E[k] = v;
  return v;
};
const say = (msg) => console.log(`[spike ${String(elapsed()).padStart(6)}ms] ${msg}`);

function stillWorthDoing(label) {
  if (Date.now() > HARD_STOP_AT) throw new Error(`deadline (${DEADLINE_MS}ms) exceeded before ${label}`);
}

/** puppeteer-core does not export its own version; read it from its package.json */
function readPuppeteerVersion() {
  try {
    const req = createRequire(import.meta.url);
    return req('puppeteer-core/package.json').version;
  } catch (err) {
    return 'unknown: ' + err.message.split('\n')[0];
  }
}

/**
 * run fn, retrying at most twice with exponential backoff (2 s → 8 s) — plan §1.4
 */
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
  throw new Error(`${label}: ${last && last.message}`);
}

/** real mouse click, falling back to a synthetic click() when the node is not clickable */
async function clickTagged(id) {
  const sel = `[data-spike-id="${id}"]`;
  const h = await page.$(sel);
  if (!h) throw new Error(`no tagged element for ${id}`);
  try {
    await h.click();
    return 'mouse';
  } catch (err) {
    say(`mouse click on ${id} failed (${err.message.split('\n')[0]}) — falling back to element.click()`);
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.click();
    }, sel);
    return 'js';
  }
}

/** Central-Time "today" as YYYY-MM-DD */
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

/** "11 - 20 of 58 items" -> 11 (the grid's own row-range start, used as a page signal) */
function rangeStart(text) {
  const m = (text || '').match(/^\s*(\d+)\s*-\s*(\d+)\s+of\s+([\d,]+)\s+items/i);
  return m ? Number(m[1]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Browser-side helpers. Installed with evaluateOnNewDocument so they survive
// every navigation. Everything is LABEL-driven, with class-based fallbacks,
// because the grid is a rendered Telerik component and its class names are not
// a contract. (No outer-scope references — puppeteer serialises this function.)
// ─────────────────────────────────────────────────────────────────────────
function installHelpers() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** smallest element whose own visible text is exactly `text` */
  const labelEl = (text, root = document) => {
    const re = new RegExp('^\\s*' + esc(text) + '\\s*:?\\s*$', 'i');
    const all = Array.from(root.querySelectorAll('label, span, div, p, th, td, legend, strong, b, button'));
    const leaf = all.filter((el) => re.test(norm(el.textContent)));
    if (!leaf.length) return null;
    return leaf.find((el) => el.tagName === 'LABEL') || leaf[leaf.length - 1];
  };

  /** a clickable whose own text is exactly `text` (button > link > submit input) */
  const buttonByText = (text) => {
    const re = new RegExp('^\\s*' + esc(text) + '\\s*$', 'i');
    const cands = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], span'));
    const matches = cands.filter((el) => re.test(norm(el.textContent || el.value)));
    return (
      matches.find((el) => el.tagName === 'BUTTON') ||
      matches.find((el) => el.tagName === 'A') ||
      matches.find((el) => el.tagName === 'INPUT') ||
      matches[0] ||
      null
    );
  };

  /** find the form control that belongs to a visible label */
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
    el.setAttribute('data-spike-id', id);
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  };

  const footerEl = () => {
    const byClass = document.querySelector('.k-pager-info, .k-grid-pager .k-pager-info');
    if (byClass) return byClass;
    const cands = Array.from(document.querySelectorAll('span, div, td, li, p'));
    const whole = cands.find((e) => /^\d+\s*-\s*\d+\s+of\s+[\d,]+\s+items$/i.test(norm(e.textContent)));
    if (whole) return whole;
    const loose = cands
      .filter((e) => /\bof\s+[\d,]+\s+items\b/i.test(norm(e.textContent)) && e.children.length === 0)
      .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
    if (loose.length) return loose[0];
    return (
      cands.find(
        (e) => /^(no items to display|no records? (to display|available))/i.test(norm(e.textContent)) && e.children.length === 0
      ) || null
    );
  };

  const gridTable = () => {
    const tables = Array.from(document.querySelectorAll('table'));
    return (
      tables.find((t) => /solicitation\s*ref/i.test(t.textContent || '') && t.querySelectorAll('tbody tr').length > 0) ||
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
    const table = gridTable();
    const headerText = (t) => Array.from(t.querySelectorAll('thead th, thead td')).map((th) => norm(th.textContent)).filter(Boolean);
    let headers = table ? headerText(table) : [];
    let headerSource = headers.length ? 'own-thead' : 'none';
    if (!headers.length) {
      // Telerik renders the grid header as its own table/container separate from the
      // body table; find it by its own label text (it has no tbody rows).
      const headerTable = Array.from(document.querySelectorAll('table')).find(
        (t) => /solicitation\s*ref/i.test(t.textContent || '') && !t.querySelector('tbody tr')
      );
      if (headerTable) {
        headers = headerText(headerTable).length ? headerText(headerTable) : Array.from(headerTable.querySelectorAll('th')).map((th) => norm(th.textContent)).filter(Boolean);
        headerSource = 'document-header-table';
      }
    }
    if (!headers.length) {
      const headerEl = document.querySelector('.k-grid-header, .k-grid-header-wrap');
      if (headerEl) {
        headers = Array.from(headerEl.querySelectorAll('th')).map((th) => norm(th.textContent)).filter(Boolean);
        headerSource = 'k-grid-header';
      }
    }

    const rawRows = table
      ? Array.from(table.querySelectorAll('tbody tr'))
          .filter((tr) => !tr.classList.contains('k-grid-norecords') && !tr.classList.contains('k-no-data'))
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
        // documented display order: Solicitation Ref #, Title, Organization, Available Date, Due Date, Bid Type
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
      return c.el ? { checked: !!c.el.checked, disabled: !!c.el.disabled, via: c.via } : { checked: null, via: c.via };
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
      keyword: text('Keyword', 'input'),
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

  const pagerPageLink = (n) => {
    const root = pagerRoot();
    if (!root) return { el: null, kind: 'pager-not-found' };
    const numbered = Array.from(root.querySelectorAll('a, button, li, span')).find(
      (e) => norm(e.textContent) === String(n) && !e.querySelector('a,button')
    );
    if (numbered) return { el: numbered, kind: 'numbered' };
    const next = root.querySelector(
      '[aria-label*="next" i], [title*="next" i], .k-pager-nav:last-child, .k-i-arrow-60-right'
    );
    if (n === 2 && next) return { el: next, kind: 'next-button' };
    return { el: null, kind: 'page-link-not-found' };
  };

  const pageSizeInfo = () => {
    const root = pagerRoot() || document;
    const sel = root.querySelector('select.k-pager-sizes, .k-pager-sizes select');
    if (sel) {
      return { kind: 'native-select', options: Array.from(sel.options).map((o) => norm(o.textContent)), current: sel.value };
    }
    const dd = root.querySelector('.k-pager-sizes .k-dropdownlist, .k-pager-sizes .k-input, .k-pager-sizes .k-dropdown');
    if (dd) return { kind: 'telerik-dropdown', options: null, current: norm(dd.textContent), needsClick: true };
    return { kind: 'not-found', options: null, current: null };
  };

  const openListOptions = () =>
    Array.from(
      document.querySelectorAll('.k-popup .k-list-item, .k-list-container .k-list-item, .k-animation-container .k-list-item')
    )
      .map((i) => norm(i.textContent))
      .filter(Boolean);

  window.__spike = {
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

// ─────────────────────────────────────────────────────────────────────────
// Chrome discovery: the runner image ships Chrome/Chromium 154; try puppeteer's
// own `channel: 'chrome'` first, then explicit paths.
// ─────────────────────────────────────────────────────────────────────────
const CHROME_PATHS = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
].filter(Boolean);

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1440,2400',
];

async function launchBrowser(puppeteer) {
  const attempts = [{ how: "channel:'chrome'", opts: { channel: 'chrome' } }];
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) attempts.push({ how: 'executablePath:' + p, opts: { executablePath: p } });
  }
  const errors = [];
  for (const a of attempts) {
    try {
      const b = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS, ...a.opts });
      return { browser: b, how: a.how, errors };
    } catch (err) {
      errors.push(a.how + ' -> ' + err.message.split('\n')[0]);
    }
  }
  throw new Error('no Chrome could be launched (' + errors.join(' | ') + ')');
}

// ─────────────────────────────────────────────────────────────────────────
// Main probe
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const todayISO = centralToday();
  record('RUN_DATE_CT', todayISO);
  record('RUN_IMMEDIATE_UTC', now());
  record('TZ_SET', process.env.TZ);
  record('NODE_VERSION', process.version);
  record('RUNNER_OS', (process.env.RUNNER_OS || 'unknown') + '/' + (process.env.RUNNER_ARCH || 'unknown'));
  record('RUNNER_NAME', process.env.RUNNER_NAME || 'unknown');
  record('OUT_DIR', OUT_DIR);
  record('SPIKE_BASE_URL', BASE_URL);
  record('DEADLINE_MS', DEADLINE_MS);
  record('REPO_MANIFEST_UNTOUCHED', true); // enforced by the workflow: no bun install, no package.json edit

  // ── 1. the driver + browser ───────────────────────────────────────────
  failedStep = 'load-driver';
  const puppeteerMod = await import('puppeteer-core');
  const puppeteer = puppeteerMod.default || puppeteerMod;
  record('PUPPETEER_CORE_VERSION', readPuppeteerVersion());

  failedStep = 'launch-browser';
  const launched = await withRetry('launch-browser', () => launchBrowser(puppeteer), 3);
  browser = launched.browser;
  record('BROWSER_LAUNCHED', true);
  record('BROWSER_LAUNCH_MODE', launched.how);
  record('BROWSER_LAUNCH_ERRORS', launched.errors);
  record('BROWSER_VERSION', await browser.version());
  record(
    'BROWSER_EXECUTABLE',
    browser.process() && browser.process().spawnfile ? browser.process().spawnfile : 'unknown'
  );
  record('BROWSER_ARGS', LAUNCH_ARGS.join(' '));
  say('browser up: ' + E.BROWSER_VERSION + ' (' + launched.how + ')');

  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2400 });
  page.setDefaultTimeout(20_000); // clicks/waits only — navigation has its own longer timeout
  page.setDefaultNavigationTimeout(45_000);
  await page.evaluateOnNewDocument(installHelpers);

  // ── 6. WS / negotiate observation (CDP) ───────────────────────────────
  const wsObs = { created: [], handshakes: [], framesReceived: 0, framesSent: 0, errors: [] };
  const negotiate = { responses: [] };
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', (e) => {
      if (wsObs.created.length < 20) wsObs.created.push(e.url);
    });
    cdp.on('Network.webSocketHandshakeResponseReceived', (e) => {
      if (wsObs.handshakes.length < 20)
        wsObs.handshakes.push({
          url: e.response && e.response.url,
          status: e.response && e.response.status,
        });
    });
    cdp.on('Network.webSocketFrameReceived', () => {
      wsObs.framesReceived += 1;
    });
    cdp.on('Network.webSocketFrameSent', () => {
      wsObs.framesSent += 1;
    });
  } catch (err) {
    wsObs.errors.push('cdp: ' + err.message);
  }
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/_blazor/negotiate')) negotiate.responses.push({ url: u, status: r.status() });
  });

  const waitForGrid = async (label) => {
    stillWorthDoing(label);
    const started = Date.now();
    await page.waitForFunction(
      () => {
        const s = window.__spike;
        if (!s) return false;
        const g = s.readGrid();
        return g && (g.footerKind === 'count' || g.footerKind === 'no-items' || g.rowCount > 0);
      },
      { timeout: RENDER_TIMEOUT_MS, polling: 400 }
    );
    return Date.now() - started;
  };
  const readState = async () =>
    page.evaluate(() => ({ grid: window.__spike.readGrid(), form: window.__spike.readForm() }));
  const snapshot = async (file) => {
    const html = await page.content();
    fs.writeFileSync(path.join(OUT_DIR, file), html, 'utf8');
    artifacts.push(file + ' (' + html.length + 'B)');
    return html.length;
  };
  const shot = async (file) => {
    try {
      await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
      artifacts.push(file);
      return true;
    } catch (err) {
      artifacts.push(file + ' FAILED: ' + err.message.split('\n')[0]);
      return false;
    }
  };

  // ── 2. baseline render of the UNFILTERED grid (also proves WS works) ──
  failedStep = 'baseline-navigate';
  say('navigating to ' + BASE_URL);
  const navStart = Date.now();
  const resp = await withRetry('baseline-navigate', () => page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }), 3);
  const navMs = Date.now() - navStart;
  record('BASELINE_HTTP_STATUS', resp ? resp.status() : null);
  record('BASELINE_NAV_MS', navMs);

  failedStep = 'baseline-wait-for-grid';
  const baselineGridMs = await waitForGrid('baseline-wait-for-grid');
  record('BASELINE_GRID_APPEAR_MS', baselineGridMs);
  record('BASELINE_LOAD_TO_RENDER_MS', navMs + baselineGridMs);
  await sleep(POLITE_MS);

  const baseline = await readState();
  record('BASELINE_FOOTER_TEXT', baseline.grid.footerText);
  record('BASELINE_FOOTER_KIND', baseline.grid.footerKind);
  record('BASELINE_TOTAL_ITEMS', baseline.grid.totalItems);
  record('BASELINE_ROW_COUNT', baseline.grid.rowCount);
  record('BASELINE_HEADERS', baseline.grid.headers);
  record('BASELINE_HEADER_SOURCE', baseline.grid.headerSource);
  record('BASELINE_COLUMN_MAPPING', baseline.grid.columnMapping);
  record('BASELINE_COLUMN_INDEXES', baseline.grid.columnIndexes);
  record('BASELINE_FIRST_REF', baseline.grid.firstRef);
  record('BASELINE_FORM', baseline.form);
  record('BASELINE_ROWS', baseline.grid.rows.slice(0, 3));
  await snapshot('vendornet-bids-page1-unfiltered.html');
  await shot('vendornet-bids-page1-unfiltered.png');

  if (baseline.grid.footerKind === 'absent') {
    throw new Error('grid rendered but the source\'s own count text is ABSENT (footerKind=absent) — parse failure, not an empty corpus');
  }
  if (baseline.grid.footerKind === 'no-items') {
    throw new Error('the UNFILTERED grid reports no items — that is not the real board (the source lists thousands); refusing to continue');
  }
  if (baseline.grid.footerKind !== 'count') {
    throw new Error('could not parse a count out of the footer text: "' + baseline.grid.footerText + '"');
  }
  if (baseline.grid.rowCount === 0) {
    throw new Error('the footer shows ' + baseline.grid.totalItems + ' items but 0 rows rendered — the grid body did not paint');
  }
  say('baseline footer: "' + baseline.grid.footerText + '" (' + baseline.grid.rowCount + ' rendered rows)');

  // ── 6 (cont.) WS / negotiate findings from the render that just happened ──
  record('BLZOR_NEGOTIATE_CALLS', negotiate.responses);
  record(
    'BLZOR_NEGOTIATE_STATUS',
    negotiate.responses.length ? negotiate.responses[negotiate.responses.length - 1].status : null
  );
  record('WS_CREATED', wsObs.created);
  record(
    'WS_HANDSHAKE_STATUS',
    wsObs.handshakes.length ? wsObs.handshakes[wsObs.handshakes.length - 1].status : null
  );
  record('WS_FRAMES_RECEIVED', wsObs.framesReceived);
  record('WS_FRAMES_SENT', wsObs.framesSent);
  record('WS_CDP_ERRORS', wsObs.errors);
  record('WS_CONNECTED', wsObs.created.length > 0 || wsObs.framesReceived > 0);
  record(
    'WS_NOTE',
    'the grid rows are delivered by the Blazor SignalR circuit; rows rendering at all IS the WebSocket proof'
  );
  say('negotiate=' + E.BLZOR_NEGOTIATE_STATUS + ' wsHandshake=' + E.WS_HANDSHAKE_STATUS + ' framesReceived=' + wsObs.framesReceived);

  // ── 3. DEEP-LINK TEST ─────────────────────────────────────────────────
  failedStep = 'deeplink-probe';
  const probes = [
    '?dueDateStart=' + todayISO + '&includeAwarded=false&includeCanceled=false',
    '?DueDateStart=' + encodeURIComponent(mmddyyyy(todayISO)) + '&IncludeAwarded=false&IncludeCanceled=false',
    '?dueDateStart=' + encodeURIComponent(mmddyyyy(todayISO)) + '&includeAwarded=off&includeCanceled=off',
    '?DueDateStart=' + encodeURIComponent(mmddyyyy(todayISO)),
  ];
  const deeplink = [];
  for (const q of probes) {
    stillWorthDoing('deeplink-probe');
    const url = BASE_URL + q;
    const row = { probe: q, url, ok: false };
    try {
      const r = await page.goto(url, { waitUntil: 'domcontentloaded' });
      row.http = r ? r.status() : null;
      await waitForGrid('deeplink-wait');
      await sleep(POLITE_MS);
      const st = await readState();
      row.footerText = st.grid.footerText;
      row.totalItems = st.grid.totalItems;
      row.dueDateStartValue = st.form.dueDateStart.value;
      row.includeAwardedChecked = st.form.includeAwarded.checked;
      row.includeCanceledChecked = st.form.includeCanceled.checked;
      row.firstRef = st.grid.firstRef;
      // "reflected" = the rendered state differs from the pristine baseline in the direction we asked for
      row.dueDateReflected = !!st.form.dueDateStart.value && st.form.dueDateStart.value !== baseline.form.dueDateStart.value;
      row.awardedReflected = st.form.includeAwarded.checked !== baseline.form.includeAwarded.checked;
      row.canceledReflected = st.form.includeCanceled.checked !== baseline.form.includeCanceled.checked;
      row.countChanged = st.grid.totalItems !== baseline.grid.totalItems;
      row.ok = true;
    } catch (err) {
      row.error = err.message.split('\n')[0];
    }
    deeplink.push(row);
    say(
      'deeplink ' + q + ' -> items=' + row.totalItems + ' dueStart="' + row.dueDateStartValue + '" awarded=' +
        row.includeAwardedChecked + ' canceled=' + row.includeCanceledChecked + (row.error ? ' ERROR=' + row.error : '')
    );
    await sleep(POLITE_MS);
  }
  const deeplinkSupported = deeplink.some((r) => r.ok && (r.dueDateReflected || r.awardedReflected || r.canceledReflected || r.countChanged));
  record('DEEPLINK_PROBES', deeplink);
  record('DEEPLINK_SUPPORTED', deeplinkSupported ? 'YES' : 'NO');
  record('DEEPLINK_ALL_PROBES_ERRORED', deeplink.every((r) => !r.ok));
  record('BASELINE_STATE_FOR_DEEPLINK_COMPARISON', {
    dueDateStart: baseline.form.dueDateStart.value,
    includeAwarded: baseline.form.includeAwarded.checked,
    includeCanceled: baseline.form.includeCanceled.checked,
    totalItems: baseline.grid.totalItems,
  });
  record(
    'DEEPLINK_EVIDENCE',
    deeplinkSupported
      ? 'at least one probe changed the rendered due-date value, a checkbox state, or the footer count'
      : 'no probe changed the rendered due-date value, the checkbox states, or the footer count - filters must be driven through the UI'
  );
  say('deep-link supported: ' + E.DEEPLINK_SUPPORTED);

  // ── 4. DRIVE THE OPEN-ONLY FILTERS THROUGH THE UI ─────────────────────
  failedStep = 'openonly-navigate';
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForGrid('openonly-wait');
  await sleep(POLITE_MS);

  const pre = await page.evaluate(() => window.__spike.readForm());
  record('OPENONLY_BIDTYPE_BEFORE', pre.bidType);
  record('OPENONLY_AVAILABLE_START_BEFORE', pre.availableStart.value);
  record('OPENONLY_AVAILABLE_END_BEFORE', pre.availableEnd.value);
  if (pre.bidType.value && !/^all$/i.test(pre.bidType.value)) {
    say('NOTE bid type is "' + pre.bidType.value + '" before any action - recorded verbatim, never changed by this probe');
  }
  if ((pre.availableStart.value || '').trim() !== '' || (pre.availableEnd.value || '').trim() !== '') {
    say('NOTE available window is non-empty before any action - recorded verbatim, never changed by this probe');
  }

  // 4a. Due Date Start = today (Central)
  failedStep = 'openonly-set-due-date';
  const dueCell = await page.evaluate(() => {
    const s = window.__spike;
    const c = s.controlFor('Due Date Start', 'input');
    if (!c.el) return { found: false, via: c.via };
    s.tag(c.el, 'due-start');
    return { found: true, via: c.via, before: c.el.value, readOnly: !!c.el.readOnly, disabled: !!c.el.disabled };
  });
  record('OPENONLY_DUEDATE_FIELD', dueCell);
  if (!dueCell.found) throw new Error('could not find the "Due Date Start" control (' + dueCell.via + ') - filter cannot be set');

  const dueText = mmddyyyy(todayISO);
  // re-discover + re-tag on every read: Blazor can swap the node out from under a tag
  const readDue = () =>
    page.evaluate(() => {
      const s = window.__spike;
      const c = s.controlFor('Due Date Start', 'input');
      if (!c.el) return { found: false, value: null, via: c.via };
      s.tag(c.el, 'due-start');
      return { found: true, value: c.el.value, via: c.via, type: c.el.getAttribute('type') };
    });
  await withRetry(
    'openonly-set-due-date',
    async () => {
      const h = await page.$('[data-spike-id="due-start"]');
      if (!h) throw new Error('the Due Date Start control could not be tagged');
      await h.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await sleep(300);
      await h.type(dueText, { delay: 60 });
      await sleep(300);
      await page.keyboard.press('Tab'); // Telerik DatePicker commits on blur
      await sleep(600);
      const cur = await readDue();
      if (!cur.found || !cur.value || !String(cur.value).trim()) {
        throw new Error('Due Date Start stayed empty after typing "' + dueText + '"');
      }
      return cur.value;
    },
    3
  );
  await sleep(POLITE_MS);
  const dueAfter = await readDue();
  const afterDue = dueAfter.value;
  record('OPENONLY_DUEDATE_TYPED', dueText);
  record('OPENONLY_DUEDATE_VALUE_AFTER', afterDue);
  record('OPENONLY_DUEDATE_SET', !!afterDue && afterDue.trim().length > 0);
  if (!E.OPENONLY_DUEDATE_SET) {
    throw new Error('Due Date Start could not be set (value="' + afterDue + '") - filter cannot be set; refusing to report a count');
  }
  say('due date start = "' + afterDue + '"');

  // 4b. Include Awarded Bids = OFF, Include Canceled Bids = OFF
  // Blazor may replace a node during a re-render, so every attempt RE-DISCOVERS and
  // re-tags the checkbox + its label rather than trusting a tag applied earlier.
  const setToggleOff = async (labelText, key, id) => {
    const find = () =>
      page.evaluate(
        (a) => {
          const s = window.__spike;
          const c = s.controlFor(a.labelText, 'input[type="checkbox"]');
          if (!c.el) return { found: false, via: c.via };
          s.tag(c.el, a.id);
          let labelTagged = false;
          const lab = c.el.id ? document.querySelector('label[for="' + c.el.id + '"]') : null;
          const box = (lab && lab.closest) || (c.el.closest ? c.el.closest('.form-check, .form-switch, .k-form-field, .mb-3') : null);
          const labEl = lab || (box ? box.querySelector('label') : null);
          if (labEl) labelTagged = s.tag(labEl, a.id + '-label');
          return { found: true, via: c.via, checked: !!c.el.checked, disabled: !!c.el.disabled, labelTagged };
        },
        { labelText, id }
      );

    const found = await find();
    record('OPENONLY_' + key + '_FOUND', found);
    if (!found.found) throw new Error('could not find the "' + labelText + '" checkbox (' + found.via + ') - filter cannot be set');
    if (found.disabled) throw new Error('the "' + labelText + '" checkbox is disabled - filter cannot be set');
    if (found.checked === false) {
      record('OPENONLY_' + key + '_ACTION', 'already-off-no-click');
      return false;
    }

    const how = await withRetry(
      'openonly-' + key + '-off',
      async () => {
        const cur = await find();
        if (cur.checked === false) return 'already-off';
        let clicked = null;
        if (cur.labelTagged) {
          try {
            await clickTagged(id + '-label');
            clicked = 'label';
          } catch (err) {
            clicked = null;
          }
        }
        if (!clicked) clicked = await clickTagged(id);
        await sleep(500);
        const after = await find();
        if (after.checked !== false) throw new Error('toggle did not go OFF via ' + clicked + ' (checked=' + after.checked + ')');
        return clicked;
      },
      3
    );
    record('OPENONLY_' + key + '_ACTION', 'clicked-off via ' + how);
    return true;
  };
  failedStep = 'openonly-toggle-awarded';
  await setToggleOff('Include Awarded Bids', 'AWARDED', 'awarded-toggle');
  await sleep(2500); // Blazor round-trip before the next action
  failedStep = 'openonly-toggle-canceled';
  await setToggleOff('Include Canceled Bids', 'CANCELED', 'canceled-toggle');
  await sleep(2500);

  const preSearch = await page.evaluate(() => ({ grid: window.__spike.readGrid(), form: window.__spike.readForm() }));
  record('OPENONLY_FORM_BEFORE_SEARCH', preSearch.form);
  record('OPENONLY_FOOTER_BEFORE_SEARCH', preSearch.grid.footerText);
  record('OPENONLY_BIDTYPE_BEFORE_SEARCH', preSearch.form.bidType.value);
  record('OPENONLY_INCLUDE_AWARDED_BEFORE_SEARCH', preSearch.form.includeAwarded.checked);
  record('OPENONLY_INCLUDE_CANCELED_BEFORE_SEARCH', preSearch.form.includeCanceled.checked);

  // 4c. Search
  failedStep = 'openonly-search';
  const searchBtn = await page.evaluate(() => {
    const s = window.__spike;
    const el = s.buttonByText('Search');
    if (!el) return { found: false };
    s.tag(el, 'search');
    return { found: true, tag: el.tagName, text: s.norm(el.textContent || el.value) };
  });
  record('OPENONLY_SEARCH_CONTROL', searchBtn);
  if (!searchBtn.found) throw new Error('could not find the Search button - open-only filters cannot be applied');
  const beforeSearchRef = preSearch.grid.firstRef;
  const beforeSearchFooter = preSearch.grid.footerText;
  await sleep(1500);
  record('OPENONLY_SEARCH_CLICK_HOW', await clickTagged('search'));
  record('OPENONLY_SEARCH_CLICKED', true);

  // wait for the grid to re-render (footer count text and/or first row change)
  failedStep = 'openonly-wait-rerender';
  // The grid may already have re-filtered on its own when the toggles/date were
  // committed (observed), in which case Search produces no further change. So a
  // "no change" outcome is recorded, not treated as a failure: the count that
  // follows is still the source's OWN footer text, and the pre-search state is
  // recorded too (OPENONLY_FOOTER_BEFORE_SEARCH).
  const rerenderStart = Date.now();
  let openGrid = null;
  let sawChange = false;
  for (let i = 0; i < 30; i++) {
    stillWorthDoing('openonly-wait-rerender');
    openGrid = await page.evaluate(() => window.__spike.readGrid());
    const changed =
      (openGrid.footerText && beforeSearchFooter && openGrid.footerText !== beforeSearchFooter) ||
      (openGrid.firstRef && beforeSearchRef && openGrid.firstRef !== beforeSearchRef);
    if (changed && openGrid.footerKind === 'count') {
      sawChange = true;
      break;
    }
    await sleep(500);
  }
  record('OPENONLY_RERENDER_MS', Date.now() - rerenderStart);
  record('OPENONLY_RERENDER_CHANGED', sawChange);
  if (!sawChange) {
    say('the grid did not change on Search - it had already applied the committed filters (pre-search footer recorded)');
  }
  await sleep(POLITE_MS);

  const openState = await readState();
  const openRows = openState.grid.rows;
  record('OPENONLY_FOOTER_TEXT', openState.grid.footerText);
  record('OPENONLY_FOOTER_KIND', openState.grid.footerKind);
  record('OPENONLY_TOTAL_ITEMS', openState.grid.totalItems);
  record('OPENONLY_ROW_COUNT', openState.grid.rowCount);
  record('OPENONLY_HEADERS', openState.grid.headers);
  record('OPENONLY_HEADER_SOURCE', openState.grid.headerSource);
  record('OPENONLY_COLUMN_MAPPING', openState.grid.columnMapping);
  record('OPENONLY_FIRST_REF', openState.grid.firstRef);
  record('OPENONLY_REFS', openState.grid.refs);
  record('OPENONLY_FORM_AFTER', openState.form);
  await snapshot('vendornet-bids-page1-openonly.html');
  await shot('vendornet-bids-page1-openonly.png');

  if (openState.grid.footerKind !== 'count') {
    throw new Error(
      'after Search the source\'s own count text is ABSENT (footerKind=' + openState.grid.footerKind + ', footer="' + openState.grid.footerText + '")'
    );
  }
  if (typeof openState.grid.totalItems !== 'number') {
    throw new Error('after Search the footer count could not be parsed from "' + openState.grid.footerText + '"');
  }
  if (openState.grid.totalItems === 0) {
    throw new Error(
      'the filtered grid reports 0 items while the unfiltered grid reported ' + baseline.grid.totalItems +
        ' - refusing to report "0 rows" as success (a filter is probably mis-set; due start="' + E.OPENONLY_DUEDATE_VALUE_AFTER + '")'
    );
  }
  say('open-only footer: "' + openState.grid.footerText + '" -> ' + openState.grid.totalItems + ' items');

  // ── 7. verbatim row shape ─────────────────────────────────────────────
  record('SAMPLE_ROWS', openRows.slice(0, 3));
  record('SAMPLE_ROWS_SOURCE', 'open-only page 1 (after the filters above)');
  record('SAMPLE_ROWS_VERBATIM_CELLS', openRows.slice(0, 3).map((r) => r.cells));
  record('ROW_COLUMN_MAPPING', openState.grid.columnMapping);
  record('ROW_SHAPE_MAPPED', openState.grid.columnMapping !== 'unmapped');
  if (openState.grid.columnMapping === 'unmapped') {
    say('WARNING: the grid columns could not be mapped to a header row - the raw cell arrays are still recorded verbatim');
  }
  record('ROWS_WITHOUT_REF_PAGE1', openRows.filter((r) => !r.ref || !r.ref.trim()).length);
  record('ROWS_WITHOUT_REF_SAMPLES', openRows.filter((r) => !r.ref || !r.ref.trim()).slice(0, 3));
  record('ROWS_WITHOUT_REF_BASELINE_PAGE1', baseline.grid.rows.filter((r) => !r.ref || !r.ref.trim()).length);

  // ── 5. PAGINATION + ITEMS PER PAGE ────────────────────────────────────
  failedStep = 'pagesize-options';
  const pageSize = await page.evaluate(() => window.__spike.pageSizeInfo());
  let pageSizeOptions = pageSize.options;
  let pageSizeKind = pageSize.kind;
  record('PAGE_SIZE_CURRENT', pageSize.current);
  if (pageSize.needsClick) {
    try {
      const tagged = await page.evaluate(() => {
        const s = window.__spike;
        const root = s.pagerRoot() || document;
        const dd = root.querySelector('.k-pager-sizes .k-dropdownlist, .k-pager-sizes .k-input, .k-pager-sizes .k-dropdown');
        if (!dd) return false;
        s.tag(dd, 'pagesize-dd');
        return true;
      });
      if (tagged) {
        await clickTagged('pagesize-dd');
        await sleep(1200);
        pageSizeOptions = await page.evaluate(() => window.__spike.openListOptions());
        await page.keyboard.press('Escape'); // read-only: we never pick a different page size
        await sleep(1000);
      }
    } catch (err) {
      pageSizeKind += '+open-failed:' + err.message.split('\n')[0];
    }
  }
  record('PAGE_SIZE_KIND', pageSizeKind);
  record('PAGE_SIZE_OPTIONS', pageSizeOptions);
  record('PAGE_SIZE_CHANGED', false); // the probe reads the selector; it never changes it
  const numeric = (pageSizeOptions || [])
    .map((o) => Number(String(o).replace(/[^\d]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  record('PAGE_SIZE_MAX_OPTION', numeric.length ? Math.max(...numeric) : null);
  record('PAGE_SIZE_OFFERS_MORE_THAN_10', numeric.some((n) => n > 10));
  say('page-size selector: kind=' + pageSizeKind + ' current=' + pageSize.current + ' options=' + JSON.stringify(pageSizeOptions));

  failedStep = 'page2';
  const p2 = await page.evaluate(() => {
    const s = window.__spike;
    const c = s.pagerPageLink(2);
    if (c.el) s.tag(c.el, 'page2');
    return { found: !!c.el, kind: c.kind, text: c.el ? s.norm(c.el.textContent) : null };
  });
  record('PAGE2_LINK', p2);
  if (!p2.found) throw new Error('could not find a page-2 control in the grid\'s pager (' + p2.kind + ') - pagination cannot be driven');
  say('polite 3 s delay before the page-2 click');
  await sleep(3000);
  const page2Start = Date.now();
  record('PAGE2_CLICK_HOW', await clickTagged('page2'));
  let page2Grid = null;
  const p1RangeStart = rangeStart(openState.grid.footerText);
  const p2Distinct = (g) =>
    (!!g.firstRef && g.firstRef !== openState.grid.firstRef) ||
    (p1RangeStart !== null && rangeStart(g.footerText) !== null && rangeStart(g.footerText) !== p1RangeStart);
  for (let i = 0; i < 50; i++) {
    stillWorthDoing('page2-wait');
    page2Grid = await page.evaluate(() => window.__spike.readGrid());
    if (p2Distinct(page2Grid)) break;
    await sleep(400);
  }
  record('PAGE2_RENDER_MS', Date.now() - page2Start);
  record('PAGE2_FIRST_REF', page2Grid.firstRef);
  record('PAGE2_REFS', page2Grid.refs);
  record('PAGE2_FOOTER_TEXT', page2Grid.footerText);
  record('PAGE2_RANGE_START', rangeStart(page2Grid.footerText));
  record('PAGE2_ROW_COUNT', page2Grid.rowCount);
  record('PAGE1_FIRST_REF', openState.grid.firstRef);
  record('PAGE1_RANGE_START', p1RangeStart);
  const distinct = p2Distinct(page2Grid);
  record('PAGE2_IS_DISTINCT_FROM_PAGE1', distinct);
  record(
    'PAGE2_DISTINCT_SIGNALS',
    'firstRefChanged=' +
      (!!page2Grid.firstRef && page2Grid.firstRef !== openState.grid.firstRef) +
      ' footerRangeStartChanged=' +
      (p1RangeStart !== null && rangeStart(page2Grid.footerText) !== null && rangeStart(page2Grid.footerText) !== p1RangeStart)
  );
  const p1Set = new Set(openState.grid.refs.filter(Boolean));
  record('PAGE1_PAGE2_REF_OVERLAP', (page2Grid.refs || []).filter((r) => r && p1Set.has(r)).length);
  await snapshot('vendornet-bids-page2-openonly.html');
  await shot('vendornet-bids-page2-openonly.png');
  if (!distinct) {
    throw new Error(
      'page 2 did not repaint independently (firstRef "' + page2Grid.firstRef + '" vs "' + openState.grid.firstRef +
        '", footer "' + page2Grid.footerText + '" vs "' + openState.grid.footerText + '") - pager driven but render not proven'
    );
  }
  say('page 2 first ref: "' + page2Grid.firstRef + '" (page 1: "' + openState.grid.firstRef + '")');

  // ── request / politeness accounting ───────────────────────────────────
  record('POLITE_DELAY_MS', POLITE_MS);
  record('PAGE_1_NAVIGATIONS', 1); // baseline unfiltered
  record('DEEPLINK_NAVIGATIONS', probes.length);
  record('OPENONLY_NAVIGATIONS', 1); // reload before driving the UI
  record('GRID_PAGES_RENDERED_TOTAL', 2); // open-only page 1 + page 2 (the grid was never crawled)
  record('GRID_CRAWLED_FULLY', false);
  record('STOPPED_AFTER_PAGE', 2);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Evidence emission (ALWAYS, even on failure) + exit code
// ─────────────────────────────────────────────────────────────────────────
function emit(status, errorMessage) {
  E.SPIKE_STATUS = status;
  E.SPIKE_FINISHED_AT = now();
  E.SPIKE_WALL_CLOCK_MS = elapsed();
  E.SPIKE_FAILED_STEP = failedStep || 'none';
  E.SPIKE_FAILED_MESSAGE = errorMessage || 'none';
  E.SPIKE_FAIL_CLOSED_RULES =
    'grid-never-renders | count-text-absent | filter-cannot-be-set | page-2-not-distinct => exit 1, never an empty success';
  E.HONEST_NOTE =
    'Dry probe only: no database access, no writes outside OUT_DIR, open-only filter only, no full-grid crawl.';
  E.ARTIFACTS = artifacts;

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'vendornet-bids-spike-evidence.json'), JSON.stringify(E, null, 2), 'utf8');
  } catch (err) {
    console.error('could not write evidence JSON: ' + err.message);
  }

  console.log('\n===================== VENDORNET BIDS SPIKE - EVIDENCE =====================');
  for (const [k, v] of Object.entries(E)) {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(k + '=' + (val === undefined ? 'null' : val));
  }
  console.log('SPIKE_EVIDENCE_JSON_BEGIN');
  console.log(JSON.stringify(E));
  console.log('SPIKE_EVIDENCE_JSON_END');
  console.log('===================== END EVIDENCE (status=' + status + ') =====================\n');
  if (status !== 'OK') {
    console.error('FAIL-CLOSED: step=' + E.SPIKE_FAILED_STEP + ' - ' + E.SPIKE_FAILED_MESSAGE);
  }
}

/** best-effort evidence capture when a step fails (so the failure is inspectable) */
async function captureFailure() {
  if (!page) return;
  failedStep = failedStep || 'failure-capture';
  try {
    const html = await page.content();
    fs.writeFileSync(path.join(OUT_DIR, 'vendornet-bids-failure.html'), html, 'utf8');
    artifacts.push('vendornet-bids-failure.html (' + html.length + 'B)');
  } catch (err) {
    artifacts.push('failure DOM capture FAILED: ' + err.message.split('\n')[0]);
  }
  try {
    await page.screenshot({ path: path.join(OUT_DIR, 'vendornet-bids-failure.png'), fullPage: true });
    artifacts.push('vendornet-bids-failure.png');
  } catch (err) {
    artifacts.push('failure screenshot FAILED: ' + err.message.split('\n')[0]);
  }
  try {
    const state = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      hasSpikeHelpers: !!window.__spike,
      grid: window.__spike ? window.__spike.readGrid() : null,
      form: window.__spike ? window.__spike.readForm() : null,
    }));
    E.FAILURE_PAGE_STATE = state;
  } catch (err) {
    E.FAILURE_PAGE_STATE = { error: err.message.split('\n')[0] };
  }
}

try {
  await main();
  E.BROWSER_CLOSED = true;
  await page.close();
  await browser.close();
  emit('OK');
  process.exit(0);
} catch (err) {
  const msg = (err && err.message ? err.message : String(err)).trim();
  try {
    await captureFailure();
  } catch (e2) {
    /* best effort */
  }
  try {
    if (browser) {
      E.BROWSER_CLOSED = true;
      await browser.close();
    }
  } catch (e3) {
    E.BROWSER_CLOSED = false;
  }
  emit('FAIL', msg);
  process.exit(1);
}
