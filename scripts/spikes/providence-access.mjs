// Public-read feasibility probe. No database access, login, retries or browser.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const url = 'https://www.bidnetdirect.com/rhode-island/providenceri';
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
if (!(args.length === 1 && args[0] === '--live') &&
    !(args.length === 2 && fileIndex === 0 && args[1])) {
  console.error('Usage: node scripts/spikes/providence-access.mjs --file saved-response.html | --live');
  process.exit(2);
}

try {
  let html, status = null, contentType = null;
  const mode = fileIndex === 0 ? 'saved-response' : 'single-public-request';
  if (fileIndex === 0) html = await readFile(args[1], 'utf8');
  else {
    // Default TLS verification; stop at redirects rather than follow unknown paths.
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
    status = response.status;
    contentType = response.headers.get('content-type');
    html = await response.text();
  }
  const denied = status === 401 || status === 403 || status === 406 || status === 429 ||
    /403 Forbidden|Access Denied|request has been blocked|Verify you are human|Checking your browser|captcha/i.test(html);
  const login = /please register or login|sign in to view|login to see details/i.test(html);
  const links = [...html.matchAll(/href\s*=\s*["']([^"']*\/solicitations\/open-bids\/[^"']+)["']/gi)]
    .map(match => match[1].replace(/&amp;/g, '&'));
  const publicBidLinks = [...new Set(links)].filter(link => {
    try { return new URL(link, url).origin === new URL(url).origin; } catch { return false; }
  });
  const outcome = denied ? 'access-denied-stop' : status !== null && status !== 200 ? 'http-response-stop' :
    publicBidLinks.length ? 'public-links-found-details-unverified' : login ? 'registration-required-stop' : 'no-usable-public-bid-links';
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), url, mode, status, contentType, outcome,
    bodySha256: createHash('sha256').update(html).digest('hex'),
    publicBidLinkCount: denied ? 0 : publicBidLinks.length,
    // No response bodies, cookies, tokens or session query strings in logs.
    imported: 0,
  }, null, 2));
  if (outcome !== 'public-links-found-details-unverified') process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ outcome: 'request-or-file-failed-stop', error: error.name, imported: 0 }));
  process.exitCode = 1;
}
