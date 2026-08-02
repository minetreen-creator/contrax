/**
 * Seed script: inserts 10 realistic government bid entries across target industries.
 * Exports a runSeed() function for programmatic use, and also runs directly via `bun run`.
 */

import { sql } from "../db";

export async function runSeed(): Promise<void> {
  const db = sql();

  // Check if bids already exist to avoid duplicates
  const existing = await db`SELECT COUNT(*) as count FROM bids WHERE source = 'seed'`;
  if (existing[0] && Number(existing[0].count) > 0) {
    console.log(`Seed bids already exist (${existing[0].count} rows) — skipping seed.`);
    return;
  }

  const bids = [
    {
      title: "Grounds Maintenance Services for Richmond City Parks",
      agency: "City of Richmond",
      description:
        "The City of Richmond is seeking qualified contractors to provide comprehensive grounds maintenance services for 12 municipal parks. Work includes mowing, edging, leaf removal, mulching, and seasonal clean-up. Contract term is 3 years with two optional 1-year extensions.",
      location: "Richmond, VA",
      category: "Landscaping",
      due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$350,000 – $500,000",
      source_url: "https://www.rva.gov/procurement",
      source: "seed",
      external_id: "seed-rva-parks-001",
    },
    {
      title: "Landscape Architecture and Design Services — Fairfax County Schools",
      agency: "Fairfax County Public Schools",
      description:
        "Fairfax County Public Schools is soliciting proposals from qualified landscape architecture firms to provide design services for campus beautification projects at 8 elementary schools. Scope includes site assessment, planting plans, irrigation design, and construction oversight.",
      location: "Fairfax, VA",
      category: "Landscaping",
      due_date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$200,000 – $350,000",
      source_url: "https://www.fcps.edu/fasttrack",
      source: "seed",
      external_id: "seed-fcps-landscape-002",
    },
    {
      title: "Highway Median and Right-of-Way Vegetation Management",
      agency: "Virginia Department of Transportation",
      description:
        "VDOT is seeking contractors for vegetation management along I-95, I-64, and Route 288 corridors. Services include mowing, herbicide application, tree trimming, and litter removal across approximately 450 linear miles of roadway right-of-way.",
      location: "Central Virginia Region",
      category: "Landscaping",
      due_date: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$1.2M – $1.8M",
      source_url: "https://www.virginiadot.org/business",
      source: "seed",
      external_id: "seed-vdot-vegetation-003",
    },
    {
      title: "Parking Structure Rehabilitation — Downtown Municipal Garage",
      agency: "City of Norfolk",
      description:
        "Structural repairs and waterproofing for the 6-story Main Street parking garage. Work includes concrete spall repair, expansion joint replacement, traffic coating application, and stairwell improvements. Must comply with Virginia Uniform Statewide Building Code.",
      location: "Norfolk, VA",
      category: "Construction",
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$2.5M – $3.2M",
      source_url: "https://www.norfolk.gov/bids",
      source: "seed",
      external_id: "seed-norfolk-garage-004",
    },
    {
      title: "Fire Station #7 New Construction",
      agency: "Henrico County",
      description:
        "Design-build services for a new 14,000 sq ft fire station facility including apparatus bay, living quarters, fitness room, and decontamination area. Project must achieve LEED Silver certification. Davis-Bacon wages apply.",
      location: "Henrico, VA",
      category: "Construction",
      due_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$6M – $8M",
      source_url: "https://henrico.us/finance/procurement",
      source: "seed",
      external_id: "seed-henrico-fire-005",
    },
    {
      title: "Managed IT Services and Cybersecurity Support",
      agency: "City of Alexandria",
      description:
        "The City of Alexandria seeks a managed service provider for enterprise IT support across 40+ municipal departments. Requirements include 24/7 help desk, network monitoring, vulnerability management, incident response, and NIST CSF compliance. CJIS security awareness training required for personnel.",
      location: "Alexandria, VA",
      category: "IT Services",
      due_date: new Date(Date.now() + 18 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$900,000 – $1.4M per year",
      source_url: "https://www.alexandriava.gov/purchasing",
      source: "seed",
      external_id: "seed-alexandria-it-006",
    },
    {
      title: "Cloud Migration and Data Center Consolidation",
      agency: "Virginia Information Technologies Agency (VITA)",
      description:
        "VITA is seeking qualified vendors to migrate 120+ state agency applications from legacy on-premise infrastructure to a FedRAMP-authorized cloud platform. Scope includes assessment, migration planning, execution, and 12 months of managed operations.",
      location: "Commonwealth of Virginia",
      category: "IT Services",
      due_date: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$4M – $7M",
      source_url: "https://www.vita.virginia.gov/supply-chain",
      source: "seed",
      external_id: "seed-vita-cloud-007",
    },
    {
      title: "HVAC Preventive Maintenance and Repair Services",
      agency: "Prince William County Public Schools",
      description:
        "County-wide HVAC maintenance contract covering 97 school facilities. Services include quarterly preventive maintenance, emergency repair, filter replacement, chiller/boiler service, and building automation system monitoring. Contractors must hold Virginia Class A license and EPA Section 608 certification.",
      location: "Prince William County, VA",
      category: "HVAC",
      due_date: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$800,000 – $1.1M per year",
      source_url: "https://www.pwcs.edu/departments/purchasing",
      source: "seed",
      external_id: "seed-pwcs-hvac-008",
    },
    {
      title: "Armed and Unarmed Security Guard Services",
      agency: "City of Portsmouth",
      description:
        "The City of Portsmouth requires security guard services for municipal buildings, including City Hall, courthouse, libraries, and community centers. Guards must be DCJS-certified. Contract includes both armed and unarmed positions across 18 locations. Background check and drug screening required.",
      location: "Portsmouth, VA",
      category: "Security",
      due_date: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$600,000 – $850,000 per year",
      source_url: "https://www.portsmouthva.gov/finance/purchasing",
      source: "seed",
      external_id: "seed-portsmouth-security-009",
    },
    {
      title: "Janitorial and Custodial Services for Municipal Complex",
      agency: "City of Chesapeake",
      description:
        "Comprehensive janitorial services for 12 city-owned buildings totaling 450,000 sq ft. Scope includes daily cleaning, floor maintenance, restroom sanitation, waste removal, and periodic deep cleaning. Green Seal certified products required. Evening and weekend shifts.",
      location: "Chesapeake, VA",
      category: "Janitorial",
      due_date: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
      estimated_value: "$450,000 – $650,000 per year",
      source_url: "https://www.cityofchesapeake.net/government/city-departments/departments/Finance/procurement.htm",
      source: "seed",
      external_id: "seed-chesapeake-janitorial-010",
    },
  ];

  for (const bid of bids) {
    await db`
      INSERT INTO bids (title, agency, description, location, category, due_date, estimated_value, source_url, source, external_id)
      VALUES (${bid.title}, ${bid.agency}, ${bid.description}, ${bid.location}, ${bid.category}, ${bid.due_date}, ${bid.estimated_value}, ${bid.source_url}, ${bid.source}, ${bid.external_id})
      ON CONFLICT (source, external_id) DO NOTHING
    `;
  }

  console.log(`✅ Seed complete: ${bids.length} bids inserted`);
}

// Allow running directly: bun run src/db/seed.ts
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
