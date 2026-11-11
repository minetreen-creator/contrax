// Temp probe: is each company's contact address really shown on its own page? One polite request per
// page as ContraxBot, robots.txt honored, a refusal ends that host. Prints yes/no only, no addresses.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const checks: [string, string, string][] = [
  ["HR Sandy Bay", "http://www.sandybayapartments.com/contact-us.html", "webmaster@sandybayapartments.com"],
  ["HR Corporate Living Solutions", "https://www.corporatelivingsolutions.com/newport-news-va/", "sales@corporatelivingsolutions.com"],
  ["HR ShortTermHousing", "https://www.shorttermhousing.com/hampton-virginia/", "salesteam@travelershaven.com"],
  ["SD Foxwood", "https://www.foxwoodapartments.com/contact-us/", "info@foxwoodapartments.com"],
  ["SD Key Housing", "https://keyhousing.com/GMcontact.asp?location=San+Diego", "info@keyhousing.com"],
  ["SD The Sherman", "https://theshermansandiego.com/", "info@theshermansandiego.com"],
  ["SD/SA Trident", "https://tridentcorporatehousing.com/corporate-housing-san-antonio-texas", "info@tridentcorporatehousing.com"],
  ["SD/SA Team Housing", "https://www.teamhousing.com/contact", "info@teamhousing.com"],
  ["SA Texas Crew Housing", "https://texascrewhousing.com/", "texascrewhousing@gmail.com"],
  ["SA Izeal Stay", "https://izealstay.com/contact/", "hello@izealstay.com"],
];
const get = (url: string) => fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
function robotsAllows(txt: string, path: string): boolean {
  let applies = false, allowed = true;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^(user-agent|disallow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    if (m[1].toLowerCase() === "user-agent") applies = m[2] === "*" || /contraxbot/i.test(m[2]);
    else if (applies && m[2] && path.startsWith(m[2])) allowed = false;
  }
  return allowed;
}
for (const [name, url, email] of checks) {
  const u = new URL(url);
  try {
    let robots = "";
    try { const r = await get(`${u.origin}/robots.txt`); if (r.ok) robots = await r.text(); } catch {}
    if (!robotsAllows(robots, u.pathname)) { console.log(`CHK ${name} | robots.txt disallows this page | not read`); continue; }
    await new Promise((r) => setTimeout(r, 2000));
    const res = await get(url);
    if (!res.ok) { console.log(`CHK ${name} | HTTP ${res.status} | not read`); continue; }
    const html = (await res.text()).toLowerCase();
    if (/just a moment|cf-chl-|captcha/.test(html.slice(0, 6000))) { console.log(`CHK ${name} | bot check | not read`); continue; }
    const decoded = html.replace(/&#64;|&#x40;|%40/g, "@").replace(/&#46;/g, ".");
    const shown = decoded.includes(email);
    const mailto = decoded.includes(`mailto:${email}`);
    const visibleText = decoded.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    console.log(`CHK ${name} | HTTP 200 | address on page: ${shown ? "yes" : "no"} | as a mail link: ${mailto ? "yes" : "no"} | in visible text: ${visibleText.includes(email) ? "yes" : "no"} | any mail link on page: ${/mailto:/.test(decoded) ? "yes" : "no"}`);
  } catch (e) {
    console.log(`CHK ${name} | failed: ${(e as Error).message.slice(0, 80)}`);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
