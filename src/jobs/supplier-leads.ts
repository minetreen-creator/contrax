/**
 * Businesses that sell to contractors, for the supplier email (owner 2026-11-18). Kept beside the
 * job, not in src/lib, so the list adds nothing to the server bundle.
 *
 * These were collected from directories and search results and NOT each read by hand, and some
 * web addresses may be wrong. So a business is only written to when its own site loads, carries
 * its name (nameOnSite), and publishes an address at its own domain. Locally and regionally owned
 * firms only: a national chain's branch does not buy its own tools. Only businesses known to
 * work in the state are listed, because the email says so.
 *
 * [name, website, SUPPLIER_TYPES id, state]
 */
export const SUPPLIER_LEADS: readonly (readonly [string, string, string, string])[] = [
  // Building materials and supply
  ["Maner Builders Supply", "https://maner.com", "materials", "SC"],
  ["Concrete Supply Co", "https://concretesupplyco.com", "materials", "SC"],
  ["Carolina Supplies & Materials", "https://carolinasupplies.com", "materials", "SC"],
  ["Berlin G. Myers Lumber", "https://berlinmyers.com", "materials", "SC"],
  ["Southern Lumber & Millwork", "https://southernlumbermillwork.com", "materials", "SC"],
  ["Buck Lumber", "https://bucklumber.com", "materials", "SC"],
  ["GBS Building Supply", "https://gbsbuilding.com", "materials", "SC"],
  ["The Building Center", "https://thebuildingcenterinc.com", "materials", "SC"],
  ["Palmetto Brick", "https://palmettobrick.com", "materials", "SC"],
  ["Florence Concrete Products", "https://florenceconcreteproducts.com", "materials", "SC"],
  ["Metromont", "https://metromont.com", "materials", "SC"],
  ["Tindall", "https://tindallcorp.com", "materials", "SC"],
  ["Cregger Company", "https://creggercompany.com", "materials", "SC"],
  ["ProSource Supply", "https://prosourcesupply.com", "materials", "SC"],
  ["Holder Electric Supply", "https://holderelectric.com", "materials", "SC"],
  ["Atlantic Coast Electric Supply", "https://atlanticcoastelectricsupply.com", "materials", "SC"],
  ["Eastern Industrial Supplies", "https://easternfirst.com", "materials", "SC"],
  ["Gateway Supply", "https://gatewaysupply.net", "materials", "SC"],
  ["Th' Lumber Yard", "https://thlumberyard.com", "materials", "SC"],
  ["Shealy Electrical Wholesalers", "https://shealyelectrical.com", "materials", "SC"],
  // Equipment rental and sales
  ["Blanchard Machinery", "https://blanchardmachinery.com", "equipment", "SC"],
  ["Bennett Equipment & Supply", "https://bennettequipment.com", "equipment", "SC"],
  ["Thompson Rental Services", "https://thompsonrentalservices.com", "equipment", "SC"],
  ["Hills Machinery", "https://hillsmachinery.com", "equipment", "SC"],
  ["Flint Equipment", "https://flintequipco.com", "equipment", "SC"],
  ["Linder Industrial Machinery", "https://linder.com", "equipment", "SC"],
  // Staffing and labor
  ["Outsource", "https://outsource.net", "staffing", "SC"],
  ["CCS Construction Staffing", "https://staffccs.com", "staffing", "SC"],
  ["Labor Source of South Carolina", "https://laborsourcesc.com", "staffing", "SC"],
  // Bonding and insurance
  ["Palmetto Surety", "https://palmettosurety.com", "bonding", "SC"],
  ["Correll Insurance Group", "https://correllinsurance.com", "bonding", "SC"],
  ["Russell-Massey & Company", "https://russellmassey.com", "bonding", "SC"],
  ["Anderson Insurance Associates", "https://aiasc.com", "bonding", "SC"],
  ["McCartha, Cobb & Associates", "https://mccarthacobb.com", "bonding", "SC"],
  ["Taylor Agency", "https://tayloragency.com", "bonding", "SC"],
  ["C. T. Lowndes & Company", "https://ctlowndes.com", "bonding", "SC"],
];
