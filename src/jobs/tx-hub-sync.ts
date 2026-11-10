/**
 * Weekly: load Texas HUB-certified firms (src/lib/tx-hub.ts) from the Comptroller's public downloads
 * the workflow fetched (.github/workflows/tx-hub-sync.yml).
 *   bun src/jobs/tx-hub-sync.ts /path/web_name.csv /path/vnr_clas.csv
 * Old rows are dropped only after a full, plausible load.
 */
import { readFileSync } from "node:fs";
import { parseHubRow, type TxHubFirm } from "~/lib/tx-hub";
import { ensureTxHubTable, pruneTxHubFirms, txHubCount, upsertTxHubFirms } from "~/lib/tx-hub.server";

/** Minimal CSV reader for the Comptroller files (quoted fields, commas inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function main() {
  const [namePath, classPath] = process.argv.slice(2);
  if (!namePath || !classPath) throw new Error("usage: bun src/jobs/tx-hub-sync.ts web_name.csv vnr_clas.csv");
  const syncedOn = new Date().toISOString().slice(0, 10);
  await ensureTxHubTable();
  const before = await txHubCount();

  const classesByVid = new Map<string, string[]>();
  const classRows = parseCsv(readFileSync(classPath, "latin1"));
  for (const r of classRows.slice(1)) {
    const vid = (r[0] ?? "").trim();
    const code = (r[1] ?? "").trim();
    if (!vid || !code) continue;
    const list = classesByVid.get(vid) ?? [];
    list.push(code);
    classesByVid.set(vid, list);
  }

  const rows = parseCsv(readFileSync(namePath, "latin1"));
  const header = rows[0].map((h) => h.trim());
  const firms: TxHubFirm[] = [];
  for (const cells of rows.slice(1)) {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = cells[i] ?? ""));
    const f = parseHubRow(rec, classesByVid.get((rec.WEB_VID ?? "").trim()) ?? []);
    if (f) firms.push(f);
  }
  for (let i = 0; i < firms.length; i += 500) await upsertTxHubFirms(firms.slice(i, i + 500), syncedOn);
  const byTrade = new Map<string, number>();
  for (const f of firms) for (const t of f.trades) byTrade.set(t, (byTrade.get(t) ?? 0) + 1);
  console.log(`Texas HUB: ${rows.length - 1} vendor rows read, ${firms.length} active Texas HUBs kept`);
  console.log("by trade:", [...byTrade.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", "));
  if (firms.length < 500 || (before > 0 && firms.length < before * 0.5)) {
    console.warn(`Not pruning: ${firms.length} kept vs ${before} before looks incomplete`);
    process.exitCode = 1;
    return;
  }
  console.log(`dropped ${await pruneTxHubFirms(syncedOn)} no longer active; ${await txHubCount()} stored`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
