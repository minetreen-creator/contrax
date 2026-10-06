/**
 * Supplier directory — database side (owner 2026-10-06, idea #8). The table is
 * created lazily (additive). One listing per Contrax account.
 */
import { sql } from "~/db";
import type { SupplierListing, SupplierProfileInput, SupplierQuery } from "~/lib/suppliers";

export async function ensureSupplierTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS supplier_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    company_name TEXT NOT NULL,
    uei TEXT,
    certifications TEXT[] NOT NULL DEFAULT '{}',
    naics TEXT[] NOT NULL DEFAULT '{}',
    states TEXT[] NOT NULL DEFAULT '{}',
    city TEXT,
    capabilities TEXT NOT NULL,
    website TEXT,
    contact_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_phone TEXT,
    listed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

export async function upsertSupplierProfile(userId: number, p: SupplierProfileInput): Promise<void> {
  await ensureSupplierTable();
  await sql()`
    INSERT INTO supplier_profiles (user_id, company_name, uei, certifications, naics, states, city, capabilities, website,
                                   contact_name, contact_email, contact_phone, listed)
    VALUES (${userId}, ${p.company_name}, ${p.uei}, ${p.certifications}, ${p.naics}, ${p.states}, ${p.city}, ${p.capabilities},
            ${p.website}, ${p.contact_name}, ${p.contact_email}, ${p.contact_phone}, ${p.listed})
    ON CONFLICT (user_id) DO UPDATE SET
      company_name = EXCLUDED.company_name, uei = EXCLUDED.uei, certifications = EXCLUDED.certifications,
      naics = EXCLUDED.naics, states = EXCLUDED.states, city = EXCLUDED.city, capabilities = EXCLUDED.capabilities,
      website = EXCLUDED.website, contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone, listed = EXCLUDED.listed, updated_at = NOW()`;
}

export async function getOwnSupplierProfile(userId: number): Promise<Record<string, unknown> | null> {
  await ensureSupplierTable();
  const rows = (await sql()`SELECT * FROM supplier_profiles WHERE user_id = ${userId}`) as Record<string, unknown>[];
  return rows[0] ?? null;
}

export async function countListedSuppliers(): Promise<number> {
  await ensureSupplierTable();
  const r = (await sql()`SELECT COUNT(*)::int AS n FROM supplier_profiles WHERE listed = TRUE`) as { n: number }[];
  return r[0]?.n ?? 0;
}

/** Listed suppliers matching the filters; contacts only when `withContacts`. */
export async function listSuppliers(q: SupplierQuery, withContacts: boolean, limit = 50): Promise<SupplierListing[]> {
  await ensureSupplierTable();
  const s = sql();
  const naicsPred = q.naics ? s`AND EXISTS (SELECT 1 FROM unnest(naics) n WHERE n LIKE ${q.naics + "%"} OR ${q.naics} LIKE n || '%')` : s``;
  const statePred = q.state ? s`AND ${q.state} = ANY(states)` : s``;
  const certPred = q.cert ? s`AND ${q.cert} = ANY(certifications)` : s``;
  const like = q.q ? "%" + q.q.replace(/[%_\\]/g, (c) => "\\" + c) + "%" : null;
  const textPred = like ? s`AND (company_name ILIKE ${like} OR capabilities ILIKE ${like})` : s``;
  const rows = (await s`
    SELECT id, company_name, certifications, naics, states, city, capabilities, uei, website, contact_name, contact_email, contact_phone
    FROM supplier_profiles
    WHERE listed = TRUE ${naicsPred} ${statePred} ${certPred} ${textPred}
    ORDER BY updated_at DESC
    LIMIT ${limit}`) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    company_name: String(r.company_name),
    certifications: (r.certifications as string[]) ?? [],
    naics: (r.naics as string[]) ?? [],
    states: (r.states as string[]) ?? [],
    city: (r.city as string) ?? null,
    capabilities: String(r.capabilities),
    uei: withContacts ? ((r.uei as string) ?? null) : null,
    website: withContacts ? ((r.website as string) ?? null) : null,
    contact_name: withContacts ? ((r.contact_name as string) ?? null) : null,
    contact_email: withContacts ? ((r.contact_email as string) ?? null) : null,
    contact_phone: withContacts ? ((r.contact_phone as string) ?? null) : null,
  }));
}
