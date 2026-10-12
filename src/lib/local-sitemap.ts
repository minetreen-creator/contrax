/** XML for /sitemap-local.xml from site-relative paths. */
export function buildLocalSitemapXml(paths: string[], origin = "https://www.contrax.company"): string {
  const urls = paths
    .map((p) => `  <url>\n    <loc>${origin}${p}</loc>\n    <changefreq>daily</changefreq>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
