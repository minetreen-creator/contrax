import { expect, test } from "bun:test";
import { FL_WPB_SOURCE, mapWpbCards, readWpbCards, wpbClosing } from "./fl-west-palm-beach";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";

// Owner 2026-11-14 ("Florida coverage is very thin"): West Palm Beach's own solicitation list.
// Cards hand-built from the live page structure captured as ContraxBot that day.
const card = (slug: string, title: string, ref: string, closing: string, status: string, summary = "Summary text.") =>
  `<div class="list-item-container"> <article> <a href="https://www.wpb.org/Bids/${slug}" > <h2 class="list-item-title"> ${title} </h2> <p class="reference-number small-text"> <span class="label">Reference number:&nbsp;</span>${ref}</p> <p class="applications-closing field-label small-text">Closing date ${closing}</p> <p >${summary}</p> <p class="status-list tagged-as-list"> <span class="label">Status:&nbsp;</span>${status}</p> </a> </article> </div>`;
const HTML = `<div class="listing-results"> 190 Result(s) Found </div>` +
  card("ITB-26-26-130SS", "Pilot Seawall Elevation Project", "ITB 26-26-130SS", "December 15, 2026, 03:00 PM", "Open", "Replacement pilot seawall &amp; living shoreline.") +
  card("ITB-26-27-133MB", "Gaines Parks Aquatic Center Renovations", "ITB 26-27-133MB", "December 10, 2026, 03:00 PM", "Open") +
  card("CANCELED-ITB-25.26.133-MB-Gaines-Parks-Aquatic-Ctr-Reno", "CANCELED Gaines Parks Aquatic Ctr Reno", "ITB 25.26.133-MB", "October 1, 2026, 03:00 PM", "Closed") +
  card("ITB-25-26-129-ES", "Old Bid", "ITB 25-26-129-ES", "September 2, 2026, 02:00 PM", "Open") +
  card("ITB-24-25-110-ES", "Master Contract for Painting Services", "ITB 24-25-110-ES", "", "Open");
const NOW = Date.parse("2026-11-14T12:00:00Z");

test("reads every card on the list page", () => {
  const cards = readWpbCards(HTML);
  expect(cards.length).toBe(5);
  expect(cards[0]).toEqual({ slug: "ITB-26-26-130SS", url: "https://www.wpb.org/Bids/ITB-26-26-130SS", title: "Pilot Seawall Elevation Project", reference: "ITB 26-26-130SS", closing: "December 15, 2026, 03:00 PM", summary: "Replacement pilot seawall & living shoreline.", status: "Open" });
});

test("closing dates are Eastern time", () => {
  expect(wpbClosing("December 15, 2026, 03:00 PM")).toBe("2026-12-15T20:00:00.000Z");
  expect(wpbClosing("garbage")).toBeNull();
});

test("only open, future bids become rows; canceled and past-due are skipped with a reason", () => {
  const r = mapWpbCards(readWpbCards(HTML), NOW);
  expect(r.rows.map((x) => x.external_id)).toEqual(["flwpb-ITB-26-26-130SS", "flwpb-ITB-26-27-133MB"]);
  expect(r.skipped).toEqual({ not_open: 1, closed: 1, no_closing_date: 1 });
  const row = r.rows[0];
  expect(row.agency).toBe("City of West Palm Beach");
  expect(row.location).toBe("West Palm Beach, FL");
  expect(row.solicitation_number).toBe("ITB 26-26-130SS");
  expect(row.notice_type).toBe("ITB");
  expect(row.source_url).toBe("https://www.wpb.org/Bids/ITB-26-26-130SS");
  expect(row.description).toContain("Documents are on DemandStar");
});

test("is in the sync and scoped to Florida", () => {
  expect(TAIL_SOURCES.some((s) => s.name === FL_WPB_SOURCE)).toBe(true);
  expect(SOURCE_CLASSES[FL_WPB_SOURCE]?.scopeState).toBe("FL");
});
