export const PAYMENT_STATUSES = ["draft", "submitted", "approved", "paid"] as const;

export type PaymentInput = {
  id: number | null;
  customer_name: string;
  job_name: string;
  invoice_number: string;
  amount_cents: number;
  invoice_due_date: string | null;
  purchase_order_number: string;
  status: (typeof PAYMENT_STATUSES)[number];
  invoice_attached: boolean;
  po_confirmed: boolean;
  supporting_docs_ready: boolean;
  next_action: string;
  follow_up_date: string | null;
  notes: string;
  archived: boolean;
};

export function validDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parsePaymentInput(value: unknown): PaymentInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = v.id === null ? null : v.id;
  if (id !== null && (!Number.isSafeInteger(id) || (id as number) <= 0)) return null;
  for (const [key, max] of Object.entries({ customer_name: 200, job_name: 200, invoice_number: 100, purchase_order_number: 100, next_action: 300, notes: 3000 })) {
    if (typeof v[key] !== "string" || (v[key] as string).length > max) return null;
  }
  if (!["customer_name", "job_name", "invoice_number"].every((key) => (v[key] as string).trim())) return null;
  if (!Number.isSafeInteger(v.amount_cents) || (v.amount_cents as number) < 0 || (v.amount_cents as number) > 1_000_000_000_00) return null;
  if (!validDate(v.invoice_due_date) || !validDate(v.follow_up_date)) return null;
  if (!PAYMENT_STATUSES.includes(v.status as PaymentInput["status"])) return null;
  for (const key of ["invoice_attached", "po_confirmed", "supporting_docs_ready", "archived"]) {
    if (typeof v[key] !== "boolean") return null;
  }
  return v as PaymentInput;
}
