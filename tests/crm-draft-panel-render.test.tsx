/**
 * CRM PHASE 3b — the Contacts panel's DRAFT affordance, RENDERED (in-process).
 *
 * The unit rules live in src/lib/crm-drafts.test.ts (pure) and
 * src/lib/crm-drafts-run.test.ts (the server seam). THIS suite renders the REAL
 * component with `react-dom/server` and pins what a user actually sees:
 *
 *   A. PROFESSIONAL (`aiDrafts`) — the per-contact "Draft follow-up" control is
 *      there, the phase-2 controls are ALL still there (nothing was removed), and
 *      the locked card is absent.
 *   B. STARTER (`canEdit`, no `aiDrafts`) — the house locked card, and NOT the
 *      draft control. Its only action is the upgrade ATTEMPT (a button that calls
 *      `onUpgradeProfessional`): nothing opens on render.
 *   C. BASIC (no `canEdit`) — the phase-2 contacts lock is rendered unchanged and
 *      the drafts card is NOT bolted onto it (Basic is asked to start at Starter,
 *      not to buy drafts).
 *   D. NOTHING IS SENT, EVER — no "Send" control and no "sent" claim appears in any
 *      render, and rendering performs NO network call (a throwing global fetch
 *      proves the panel never fetches on view).
 *
 * Deterministic, network-free, database-free: literals + in-process renders. No
 * `mock.module` anywhere — bun's mock registry is process-global and leaks across
 * files in one run (skill contrax-bun-mock-module-leak).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PipelineContacts } from "~/components/PipelineContacts";
import { CRM_DRAFT_LOCK_BODY, CRM_DRAFT_LOCK_CTA, CRM_DRAFT_LOCK_TITLE } from "~/lib/crm-drafts";
import {
  CRM_CONTACTS_LOCK_BODY,
  CRM_CONTACTS_LOCK_TITLE,
  type CrmAccessView,
  type CrmContactView,
} from "~/lib/pipeline-contacts";

const PANEL_SOURCE = readFileSync(
  join(import.meta.dir, "..", "src", "components", "PipelineContacts.tsx"),
  "utf8",
);

const CONTACT: CrmContactView = {
  id: 41,
  name: "Dana Whitfield",
  organization: "Whitfield Facilities Group",
  role: "Contracting officer",
  email: "dana@example.com",
  phone: "555-0100",
  notes: "Prefers a call before any site visit.",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-10-02T00:00:00.000Z",
};

function accessOf(tier: "basic" | "starter" | "professional"): CrmAccessView {
  return {
    tier,
    canEdit: tier !== "basic",
    relationshipHistory: tier === "professional",
    reminders: tier === "professional",
    aiDrafts: tier === "professional",
    contactLimit: tier === "professional" ? 1000 : tier === "starter" ? 100 : 0,
  };
}

/** Decodes the entities React escapes, so copy can be compared to its literal. */
function unescapeHtml(source: string): string {
  return source
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** Renders the panel with a global fetch that THROWS — a render must never fetch. */
function render(access: CrmAccessView | null, contacts: CrmContactView[] = [CONTACT]): string {
  const originalFetch = globalThis.fetch;
  const blocked: typeof fetch = (() => {
    throw new Error("the contacts panel must not fetch on render");
  }) as unknown as typeof fetch;
  globalThis.fetch = blocked;
  try {
    return unescapeHtml(
      renderToStaticMarkup(
        <PipelineContacts
          access={access}
          contacts={contacts}
          loading={false}
          loadError=""
          onChange={() => {}}
          onUpgrade={() => {}}
          onUpgradeProfessional={() => {}}
        />,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("A — a Professional account gets the draft affordance", () => {
  const html = render(accessOf("professional"));

  test("the per-contact control is rendered", () => {
    expect(html).toContain("Draft follow-up");
    expect(html).toContain("Dana Whitfield");
  });

  test("the phase-2 controls are untouched by phase 3b", () => {
    for (const control of ["History", "Edit", "Archive", "+ Add contact"]) {
      expect({ control, present: html.includes(control) }).toEqual({ control, present: true });
    }
    expect(html).toContain("1 of 1000 contacts · relationship history included");
  });

  test("the locked card is NOT shown to an entitled account", () => {
    expect(html).not.toContain(CRM_DRAFT_LOCK_TITLE);
  });

  test("no send control and no sent claim anywhere in the render", () => {
    expect(html).not.toContain(">Send");
    expect(html).not.toContain("Send draft");
    expect(html.toLowerCase()).not.toContain("sent</");
  });
});

describe("B — a Starter account gets the house locked card, attempt-only", () => {
  const html = render(accessOf("starter"));

  test("the locked card states the Professional gate with no price", () => {
    expect(html).toContain(CRM_DRAFT_LOCK_TITLE);
    expect(html).toContain(CRM_DRAFT_LOCK_BODY);
    expect(html).toContain(CRM_DRAFT_LOCK_CTA);
    // No price is invented in the app: the attempt uses the modal's own defaults.
    expect(html).not.toContain("$79");
    expect(html).not.toContain("/mo");
  });

  test("the draft control is NOT offered to an unentitled account", () => {
    expect(html).not.toContain("Draft follow-up");
  });

  test("the ONLY action is a click target — nothing opens on render", () => {
    // The CTA is a button, and the click is what sets the attempt state (source).
    expect(html).toContain(`${CRM_DRAFT_LOCK_CTA}</button>`);
    expect(PANEL_SOURCE).toContain("onClick={onUpgradeProfessional}");
    // No modal markup is produced by this component at all.
    expect(html).not.toContain("Upgrade to Radar Pro");
    expect(html).not.toContain('role="dialog"');
  });

  test("the Starter contact controls are unchanged", () => {
    expect(html).toContain("Edit");
    expect(html).toContain("Archive");
    expect(html).not.toContain("History");
  });
});

describe("C — Basic keeps exactly the phase-2 locked state", () => {
  const html = render(accessOf("basic"));

  test("the phase-2 contacts lock is what a Basic account sees", () => {
    expect(html).toContain(CRM_CONTACTS_LOCK_TITLE);
    expect(html).toContain(CRM_CONTACTS_LOCK_BODY);
  });

  test("Basic is not upsold drafts before it has contacts at all", () => {
    expect(html).not.toContain(CRM_DRAFT_LOCK_TITLE);
    expect(html).not.toContain("Draft follow-up");
  });
});

describe("D — entitlements are never fabricated by the client", () => {
  test("an access object that has not loaded yet gives the read-only state", () => {
    const html = render(null);
    expect(html).toContain(CRM_CONTACTS_LOCK_TITLE);
    expect(html).not.toContain("Draft follow-up");
  });

  test("an access object with aiDrafts false but canEdit true never shows the control", () => {
    // The two gates are independent: relationship history can be on (Professional
    // history) while drafts are off — this pins that drafts follow `aiDrafts` ONLY.
    const html = render({ ...accessOf("starter"), relationshipHistory: true });
    expect(html).not.toContain("Draft follow-up");
    expect(html).toContain("History");
    expect(html).toContain(CRM_DRAFT_LOCK_TITLE);
  });

  test("rendering performs no network call (the throwing fetch never fired)", () => {
    // `render` installs a fetch that throws; reaching here proves it was unused.
    expect(render(accessOf("professional"))).toContain("Draft follow-up");
  });

  test("the panel's copy comes from the shared module, not a local re-write", () => {
    // The control and the locked card read the SAME constants the suites pin.
    expect(PANEL_SOURCE).toContain("CRM_DRAFT_LOCK_TITLE");
    expect(PANEL_SOURCE).toContain("CRM_DRAFT_ACTION_LABEL");
    expect(PANEL_SOURCE).toContain("CRM_DRAFT_EDITOR_NOTE");
  });
});
