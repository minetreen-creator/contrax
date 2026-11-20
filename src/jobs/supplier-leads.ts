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
 *
 * Written to from the owner's own Gmail on 2026-11-18, so removed from this list and never to be
 * queued here: Metromont, Tindall, Cregger Company, Holder Electric Supply, Eastern Industrial
 * Supplies, Gateway Supply, Bennett Equipment & Supply, Outsource, CCS Construction Staffing,
 * Palmetto Surety, Russell-Massey & Company, Anderson Insurance Associates, C. T. Lowndes & Company.
 *
 * Written to from the owner's own Gmail on 2026-11-20 (two batches), never to be queued here:
 * NC: Kluttz Lumber, Johnson Concrete, Pine Hall Brick, Sentinel Risk Advisors, National Surety
 * Services, Central Carolina Insurance Agency.
 * GA: Magbee, Dixie Plywood, Norcross Supply, Ernst Concrete, Thomas Concrete, Reynolds-Warren,
 * Vermeer Southeast, Guignard, American Surety Bonds Agency, Snellings Walters, Oakbridge, Palomar
 * Insurance.
 * SC: Flint Equipment, Taylor Agency, Turner Agency Insurance, Kinghorn Insurance, Hutson
 * Etherredge Companies.
 * TX: Acme Brick, Kirby-Smith Machinery, HOLT CAT, Closner Equipment, The Sweeney Company, Bowen
 * Miclette & Britt, TexCap Insurance, Watkins Insurance Group.
 * FL: Tibbetts Lumber, Gulfeagle Supply, World Electric Supply, A-1 Block, Supermix Concrete, Ring
 * Power, Kelly Tractor, Acentria Insurance, Waldorff Insurance & Bonding.
 * OH: Ohio CAT, Columbus Equipment, Southeastern Equipment, Murphy Tractor, Company Wrench,
 * Schauer Group.
 * PA: Fizzano Brothers Concrete, Groff Tractor, Best Line Equipment, The Graham Company, Henderson
 * Brothers, McKee Risk Management.
 * VA: McClung-Logan Equipment, Hilb Group, Loudoun Insurance Group, Dominion Risk Advisors.
 * Third batch, 2026-11-20: NY: Milton CAT, Dykes Lumber, Cranesville Block, Curtis Lumber, Marshall &
 * Sterling. CA: Hawthorne CAT, Quinn Company, Robertson's Ready Mix, Angelus Block. IL: McCann
 * Industries. MI: Fendt Builder's Supply. Also OST Global Solutions (a consultant that finds bids
 * for clients). Best Line Equipment's address bounced (rejected by its mail server): do not retry.
 * Passed the site check but held, because we list few open jobs in their states: 4Rivers
 * Equipment, Flood and Peterson, Moody Insurance Agency, CCIG (CO); TIS Insurance, Smyrna Ready
 * Mix (TN); Miles Sand & Gravel (WA). Wrong inbox, left out: Golden State Lumber, Cavignac.
 * Checked and left out because the only published address was a help desk, HR or accounts inbox:
 * McCoy's Building Supply, Elliott Electric Supply, Summit Electric Supply, Equipment Depot, Luck
 * Stone.
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
  ["ProSource Supply", "https://prosourcesupply.com", "materials", "SC"],
  ["Atlantic Coast Electric Supply", "https://atlanticcoastelectricsupply.com", "materials", "SC"],
  ["Th' Lumber Yard", "https://thlumberyard.com", "materials", "SC"],
  ["Shealy Electrical Wholesalers", "https://shealyelectrical.com", "materials", "SC"],
  // Equipment rental and sales
  ["Blanchard Machinery", "https://blanchardmachinery.com", "equipment", "SC"],
  ["Thompson Rental Services", "https://thompsonrentalservices.com", "equipment", "SC"],
  ["Hills Machinery", "https://hillsmachinery.com", "equipment", "SC"],
  ["Linder Industrial Machinery", "https://linder.com", "equipment", "SC"],
  // Staffing and labor
  ["Labor Source of South Carolina", "https://laborsourcesc.com", "staffing", "SC"],
  // Bonding and insurance
  ["Correll Insurance Group", "https://correllinsurance.com", "bonding", "SC"],
  ["McCartha, Cobb & Associates", "https://mccarthacobb.com", "bonding", "SC"],
];
