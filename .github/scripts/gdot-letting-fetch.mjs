// Georgia DOT's public "Project Letting by Month" forecast (owner 2026-11-08: "Add as 'Upcoming'").
// Opens GDOT's own anonymous dashboard (anon=1, no sign-in) in headless Chrome, exactly as any visitor
// sees it, waits for the forecast tables the page draws, and writes the page HTML to GDOT_OUT for the
// parser (src/jobs/sources/gdot-letting.ts). No forms, no filters changed, no other pages.
// Why a browser: the dashboard is Oracle Analytics, which draws its tables only with its own script.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

export const GDOT_LETTING_URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=/shared/External/_portal/Project%20Letting%20by%20Month&Page=Project%20Letting%20By%20Month&Action=Navigate&Syndicate=true&anon=1';
const out = process.env.GDOT_OUT || 'gdot-letting.json';
let browser;
const timer = setTimeout(() => { console.error('GDOT letting collector timed out'); process.exit(1); }, 170_000);
try {
  browser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'], protocolTimeout: 120_000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  // The browser's own identity (headless Chrome, which Oracle Analytics checks it supports) with our
  // honest name added, never a pretend consumer browser.
  await page.setUserAgent(`${await browser.userAgent()} ContraxBot/1.0 (+https://www.contrax.company)`);
  await page.goto(GDOT_LETTING_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  try {
    await page.waitForFunction(
      () => /GDOT Project Letting Forecast/.test(document.body?.innerText ?? '') && (document.body?.innerText.match(/Month Total/g) ?? []).length >= 1,
      { timeout: 120_000, polling: 1000 },
    );
  } catch (error) {
    const seen = await page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400)).catch(() => '');
    throw new Error(`The forecast never drew (page changed?). Page shows: ${seen}`);
  }
  // Let the remaining month tables finish drawing.
  await new Promise((r) => setTimeout(r, 5000));
  const html = await page.content();
  writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), url: GDOT_LETTING_URL, html }));
  console.log(`GDOT letting forecast captured (${html.length} bytes, ${(html.match(/Month Total/g) ?? []).length} month tables)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await browser?.close();
}
