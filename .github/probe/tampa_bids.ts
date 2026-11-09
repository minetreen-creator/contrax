// Read-only: open bids in Tampa Bay in our database (counts and public agency names only).
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";

const PLACES = ["tampa", "st. petersburg", "st petersburg", "saint petersburg", "clearwater", "largo", "brandon", "plant city", "temple terrace",
  "pinellas", "hillsborough", "pasco", "hernando", "macdill", "new port richey", "dade city", "brooksville", "tarpon springs", "dunedin",
  "oldsmar", "wesley chapel", "zephyrhills", "pinellas park", "seminole, fl", "riverview", "ruskin", "apollo beach", "port richey", "spring hill, fl"];
const CONSTRUCTION = /construct|renovat|hvac|mechanical|electric|plumb|roof|paving|resurfac|building|repair|maintenance|chiller|boiler|demolition|concrete|drainage|utility|water main|sewer|facility/i;

const s = sql();
const rows = (await s`
  SELECT title, agency, location FROM bids
  WHERE due_date > NOW()
    AND ${s.unsafe(LOW_CONTENT_SQL)}
    AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
    AND (LOWER(COALESCE(location,'')) LIKE ANY(${PLACES.map((p) => `%${p}%`)}) OR LOWER(COALESCE(agency,'')) LIKE ANY(${PLACES.map((p) => `%${p}%`)}))
`) as { title: string; agency: string | null; location: string | null }[];
const fl = rows.filter((r) => /\bFL\b|florida/i.test(`${r.location} ${r.agency}`) || /tampa|pinellas|hillsborough|pasco|hernando|macdill|clearwater|petersburg/i.test(`${r.location} ${r.agency}`));
const cons = fl.filter((r) => CONSTRUCTION.test(r.title));
const byAgency = new Map<string, number>();
for (const r of cons) byAgency.set(r.agency ?? "?", (byAgency.get(r.agency ?? "?") ?? 0) + 1);
console.log(`open Tampa Bay bids: ${fl.length}; construction/facility: ${cons.length}`);
console.log("top buyers (construction):", [...byAgency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, n]) => `${a} ${n}`).join("; "));
const kw: Record<string, RegExp> = { hvac: /hvac|mechanical|chiller|boiler|air condition/i, electrical: /electric/i, plumbing: /plumb|water main|sewer/i, roofing: /roof/i, paving: /paving|resurfac|asphalt/i };
for (const [k, re] of Object.entries(kw)) console.log(`  ${k}: ${cons.filter((r) => re.test(r.title)).length}`);
