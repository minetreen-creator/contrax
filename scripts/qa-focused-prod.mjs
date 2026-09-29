/** One-time production browser QA. Test identities are removed in finally and a workflow cleanup step. */
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const runId = process.env.GITHUB_RUN_ID;
const url = process.env.DATABASE_URL;
if (!runId || !/^\d+$/.test(runId) || !url) throw new Error("CI run ID and DATABASE_URL required");
const db = neon(url);
const customerEmail = `qa-nonprofit-${runId}@example.invalid`;
const adminEmail = `qa-admin-${runId}@test.contrax`;
const base = "https://www.contrax.company";

async function cleanup() {
  const users = await db`SELECT id FROM users WHERE email IN (${customerEmail}, ${adminEmail})`;
  const ids = users.map((row) => Number(row.id));
  for (const id of ids) {
    await db`DELETE FROM saved_matches WHERE user_id = ${id}`;
    await db`DELETE FROM sessions WHERE user_id = ${id}`;
    await db`DELETE FROM users WHERE id = ${id}`;
  }
  const remain = await db`SELECT count(*)::int AS n FROM users WHERE email IN (${customerEmail}, ${adminEmail})`;
  if (Number(remain[0]?.n) !== 0) throw new Error("QA users remain after teardown");
  console.log("QA teardown verified: users, sessions and saved matches removed");
}

if (process.argv.includes("--cleanup")) {
  await cleanup();
} else {
  const { chromium } = await import("playwright");
  let browser;
  try {
    const bid = await db`SELECT id, title FROM bids WHERE due_date > CURRENT_DATE ORDER BY id DESC LIMIT 1`;
    if (!bid.length) throw new Error("No future bid for QA");
    const customer = await db`
      INSERT INTO users (email, password_hash, plan_tier, signup_source, is_admin)
      VALUES (${customerEmail}, 'qa-no-password-login', 'basic', 'nonprofit_apply', FALSE)
      RETURNING id`;
    const admin = await db`
      INSERT INTO users (email, password_hash, plan_tier, is_admin)
      VALUES (${adminEmail}, 'qa-no-password-login', 'basic', TRUE)
      RETURNING id`;
    const customerId = Number(customer[0].id);
    const adminId = Number(admin[0].id);
    const customerToken = randomBytes(32).toString("hex");
    const adminToken = randomBytes(32).toString("hex");
    await db`INSERT INTO sessions (user_id, token, expires_at) VALUES
      (${customerId}, ${customerToken}, NOW() + INTERVAL '15 minutes'),
      (${adminId}, ${adminToken}, NOW() + INTERVAL '15 minutes')`;
    await db`INSERT INTO saved_matches (user_id, bid_id, status)
      VALUES (${customerId}, ${Number(bid[0].id)}, 'saved')`;

    browser = await chromium.launch({ headless: true });
    const customerContext = await browser.newContext();
    await customerContext.addCookies([{ name: "contrax_session", value: customerToken,
      domain: "www.contrax.company", path: "/", httpOnly: true, secure: true }]);
    const page = await customerContext.newPage();
    await page.goto(`${base}/pipeline`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Manage bid" }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Manage bid" }).first().click();
    await page.getByLabel("Follow-up date").fill("2026-10-15");
    await page.getByLabel("Next action").fill("QA verify follow-up");
    await page.getByLabel("Contact name").fill("QA Contact");
    await page.getByLabel("Organization").fill("QA Organization");
    await page.getByLabel("Contact role").fill("Procurement");
    await page.getByLabel("Contact email").fill("qa-contact@example.invalid");
    await page.getByLabel("Notes").fill("QA round-trip only");
    await page.getByRole("button", { name: "Save bid details" }).click();
    await page.locator("p").filter({ hasText: "QA verify follow-up" }).first().waitFor({ timeout: 15000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("p").filter({ hasText: "QA verify follow-up" }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Manage bid" }).first().click();
    if (await page.getByLabel("Follow-up date").inputValue() !== "2026-10-15") {
      throw new Error("Follow-up date did not survive reload");
    }
    await page.getByRole("button", { name: "Save bid details" }).click();
    await page.locator("p").filter({ hasText: "QA verify follow-up" }).first().waitFor({ timeout: 15000 });
    console.log("PASS signed-in Pipeline save → reload → re-save, including date");

    const adminContext = await browser.newContext();
    await adminContext.addCookies([{ name: "contrax_session", value: adminToken,
      domain: "www.contrax.company", path: "/", httpOnly: true, secure: true }]);
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${base}/admin/signups`, { waitUntil: "domcontentloaded" });
    const row = adminPage.locator("tr").filter({ hasText: customerEmail });
    await row.waitFor({ timeout: 20000 });
    await row.getByText("Nonprofit apply", { exact: true }).waitFor({ timeout: 10000 });
    console.log("PASS Admin → Signups displays nonprofit source badge for a new account");
  } finally {
    if (browser) await browser.close();
    await cleanup();
  }
}
