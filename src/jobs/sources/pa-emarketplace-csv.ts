/** Official eMarketplace CSV export. No private endpoints or invented detail URLs. */
export function parseCsv(text: string): Record<string, string>[] {
  const table: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += c;
    } else if (c === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); if (row.some(Boolean)) table.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unterminated CSV quotation");
  if (cell || row.length) { row.push(cell); table.push(row); }
  const headers = table.shift() ?? [];
  for (const h of ["Bid No", "Bid Type", "Title", "Description", "Agency", "Bid Start Date", "Bid End Date", "Status"])
    if (!headers.includes(h)) throw new Error(`Missing CSV column: ${h}`);
  return table.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${i + 2}: column count mismatch`);
    return Object.fromEntries(headers.map((h, j) => [h, values[j]]));
  });
}

/** Pennsylvania wall time converted explicitly to America/New_York; date-only deadlines require review. */
export function paDate(value: string): { iso: string | null; reason?: string } {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM))?$/);
  if (!m) return { iso: null, reason: "invalid_date" };
  const [, month, day, year, hour, minute, second, ap] = m;
  if (+year >= 2099) return { iso: null, reason: "placeholder_date" };
  if (!hour) return { iso: null, reason: "date_only_deadline" };
  if (+hour < 1 || +hour > 12 || +minute > 59 || +(second ?? 0) > 59) return { iso: null, reason: "invalid_date" };
  const h = +hour % 12 + (ap === "PM" ? 12 : 0);
  const wall = Date.UTC(+year, +month - 1, +day, h, +minute, +(second ?? 0));
  const check = new Date(wall);
  if (check.getUTCMonth() !== +month - 1 || check.getUTCDate() !== +day) return { iso: null, reason: "invalid_date" };
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    instant += wall - shown;
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  if (+p.hour !== h || +p.day !== +day || +p.minute !== +minute) return { iso: null, reason: "nonexistent_local_time" };
  return { iso: new Date(instant).toISOString() };
}

export function reviewExport(text: string, now = new Date()) {
  const records = parseCsv(text), accepted: Record<string, string>[] = [];
  const skipped: Record<string, number> = {}, skippedRows: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    let reason = "";
    const due = paDate(r["Bid End Date"]);
    const key = `${r.Agency.trim().toLowerCase()}|${r["Bid No"].trim().toLowerCase()}`;
    if (!r["Bid No"].trim() || !r.Title.trim() || !r.Agency.trim()) reason = "missing_identity";
    else if (!["Open", "Extended"].includes(r.Status.trim())) reason = "not_open";
    else if (!["IFB", "RFP", "RFQ", "R3-RFQ"].includes(r["Bid Type"].trim())) reason = "non_bid_or_qualification";
    else if (!due.iso) reason = due.reason!;
    else if (new Date(due.iso) <= now) reason = "expired";
    else if (seen.has(key)) reason = "duplicate_export_identity";
    if (reason) { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({ id: r["Bid No"], reason }); }
    else { seen.add(key); accepted.push({ ...r, due_iso: due.iso! }); }
  }
  return { fetched: records.length, accepted, skipped, skippedRows };
}
