// Temp probe: names of five school-district Bonfire portals (page title only). Removed after.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
for (const t of ["rochesterschools", "laredoisd", "stlucieschools", "fultonschools", "wicomicoschools"]) {
  try {
    const r = await fetch(`https://${t}.bonfirehub.com/portal/?tab=openOpportunities`, { headers: { "User-Agent": UA } });
    const html = await r.text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
    const tz = html.match(/Bonfire\.timezone\s*=\s*['"]([^'"]+)/)?.[1];
    console.log("PORTAL", t, r.status, JSON.stringify(title), tz ?? "");
  } catch (e) { console.log("PORTAL", t, "ERR", String(e).slice(0, 100)); }
  await new Promise((r) => setTimeout(r, 1500));
}
process.exit(0);
