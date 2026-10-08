// Public Oracle ADF abstracts only. No sign-in, submissions, or database access.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const endpoint = 'https://ejbs.fa.us6.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000003501148';
let browser;
const timer = setTimeout(() => { console.error('Virginia Beach collector timed out'); process.exit(1); }, 150_000);
try {
  browser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(endpoint, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('table[summary="Search Results"]', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const table = document.querySelector('table[summary="Search Results"]');
    return table?.querySelector('tbody > tr') || document.body.innerText.includes('No data to display');
  }, { timeout: 30_000 });
  const payload = await page.evaluate(() => {
    const table = document.querySelector('table[summary="Search Results"]');
    return {
      capturedAt: new Date().toISOString(),
      timeZone: document.body.innerText.includes('US Eastern Time') ? 'US Eastern Time' : null,
      rowCount: Number(table.getAttribute('_rowcount')),
      startRow: Number(table.getAttribute('_startrow')),
      rows: [...table.querySelectorAll('tbody > tr')].map(row => [...row.children].map(cell => cell.innerText.trim())),
    };
  });
  // Refuse virtualized/partial grids. Never ingest a silently truncated list.
  if (payload.timeZone !== 'US Eastern Time' || payload.startRow !== 0 ||
      !Number.isInteger(payload.rowCount) || payload.rowCount !== payload.rows.length ||
      payload.rows.some(row => row.length !== 6)) throw new Error('Unrecognized or incomplete Oracle abstracts table');
  writeFileSync(process.env.VA_VIRGINIA_BEACH_OUT || 'virginia-beach-payload.json', JSON.stringify(payload, null, 2));
  console.log(`Virginia Beach: ${payload.rowCount} public abstracts captured`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await browser?.close();
}
