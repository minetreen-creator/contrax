/**
 * Homepage before/after proof (owner 2026-11-08: "a dense government notice next to Max's
 * plain-English summary … with a real construction bid"). Everything here is real and verbatim:
 * - `notice` is the opening of the agency's own notice text as Contrax stores it (bid 1449965,
 *   City of Lexington, NC), cut at a sentence end.
 * - `max.en` / `max.es` are Max's answers word for word from /api/max/ask with that bid_id, asked
 *   on 2026-11-08 ("Give me a plain-English summary of this bid: what the work is, who can bid, key
 *   dates, and anything to watch out for." and the same question in Spanish). Each sentence is one
 *   bullet; nothing was edited, added or removed.
 * PURE, browser-safe.
 */
export const MAX_PROOF = {
  bidId: 1449965,
  title: "Request for Qualifications for Progressive Design-Build Services for I-85 Center Pump Station and Sewer Extension",
  agency: "City of Lexington, North Carolina",
  due: "2026-12-07",
  askedOn: "2026-11-08",
  noticeChars: 2357,
  notice:
    "The City of Lexington, North Carolina is soliciting Statements of Qualifications from qualified Design-Build teams to provide progressive design-build services for the NC I-85 Center Pump Station and Sewer Extension (Project). The selected DB team will provide integrated design, permitting, preconstruction, procurement, construction, startup, commissioning, and closeout services under a single design-build relationship, subject to CITY authorization of each phase. The Project is located in the NC I-85 Center / Seven Oaks Drive area near Lexington and Linwood, Davidson County, North Carolina. The work generally includes a new submersible sewer pump station with backup power generation; gravity sewer and associated manholes; an aerial sewer crossing; force main; jack-and-bore work; erosion and sedimentation control; grading and restoration; utility coordination; roadway and right-of-way work; testing; startup; and associated work necessary to provide a complete and operational wastewater collection system. Existing project documents include approximately 5,667 linear feet of 8-inch gravity sewer, a 264-gallon-per-minute duplex pump station with alarms, telemetry, and permanent standby power, and approximately 7,210 linear feet of 6-inch force main under NCDEQ sewer permit WQ0047265.",
  max: {
    en: "This bid is for design-build teams to handle a full sewer project in Lexington, North Carolina—building a new pump station, laying gravity and force main sewers, plus all the related site and utility work. They're looking for teams who can handle both the design and construction, not just one or the other. There's no special set-aside, so any qualified team can submit. It's due December 7, and you'll need to show experience with similar sewer and pump station work—watch out for the progressive design-build approach, which means close coordination with the city at every phase.",
    es: "Esta licitación es para un proyecto grande de diseño y construcción de una estación de bombeo de aguas residuales y una extensión de alcantarillado cerca de Lexington, Carolina del Norte. Buscan equipos de diseño-construcción (empresas que puedan hacer tanto el diseño como la obra) y no es solo para pequeños negocios, así que normalmente se presentan consorcios o empresas con experiencia en proyectos de infraestructura. La fecha límite para enviar tu propuesta es el 7 de diciembre. Es clave revisar bien los requisitos técnicos y la experiencia previa, porque buscan equipos completos y con capacidad para manejar todo el proceso, desde permisos hasta la construcción y puesta en marcha.",
  },
} as const;

/** One bullet per sentence, words unchanged. PURE. */
export function maxProofBullets(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/).map((s) => s.trim()).filter(Boolean);
}

/** The bid link only while the bid is open; afterwards the example stands on its own. PURE. */
export function maxProofBidOpen(now: number = Date.now()): boolean {
  return now < Date.parse(`${MAX_PROOF.due}T23:59:59-05:00`);
}

/** The notice's due date as people read it, e.g. "December 7, 2026" (or "Dec 7, 2026" when short). PURE. */
export function maxProofDueLabel(short = false): string {
  return new Date(`${MAX_PROOF.due}T12:00:00Z`).toLocaleDateString("en-US", { month: short ? "short" : "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Date accuracy (owner 2026-11-09: "date accuracy and source citations a top priority"): Max's
 * English answer must name the same due date as the notice. A test enforces it for every example. PURE.
 */
export function maxProofDateConsistent(): boolean {
  const d = new Date(`${MAX_PROOF.due}T12:00:00Z`);
  const monthDay = d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return MAX_PROOF.max.en.includes(monthDay);
}

/**
 * The live check: the bid's due date in the database (New York date) still matches the example.
 * If the agency amends the date, the example hides itself instead of showing a stale one. PURE.
 */
export function maxProofStillCurrent(dbDue: string | Date | null | undefined): boolean {
  if (!dbDue) return false;
  const ny = new Date(dbDue).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return ny === MAX_PROOF.due;
}

/** Words in the notice excerpt vs. in Max's answer, for the "time saved" line. PURE. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
