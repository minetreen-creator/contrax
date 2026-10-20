import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { getCurrentUser } from "~/lib/auth";
import { AdminHeader, AdminTabs } from "~/components/AdminShared";

const queue = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user?.is_admin) throw new Error("Admin access required.");
  const { getFoundingBusinessAdminRows } =
    await import("~/lib/founding-business.server");
  return getFoundingBusinessAdminRows();
});
const action = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slot: z.number().int().min(1).max(10),
        action: z.enum(["publish", "hide", "spotlight"]),
        reviewed: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user?.is_admin) throw new Error("Admin access required.");
    const { updateFoundingBusiness } =
      await import("~/lib/founding-business.server");
    if (data.action === "publish" && !data.reviewed)
      throw new Error(
        "Review the logo, website and business claims before publishing.",
      );
    await updateFoundingBusiness(data.slot, data.action);
    return { ok: true };
  });
export const Route = createFileRoute("/admin/founding-businesses")({
  loader: async () => {
    const u = await getCurrentUser();
    if (!u) throw redirect({ to: "/login" });
    if (!u.is_admin) throw redirect({ to: "/dashboard" });
    return queue();
  },
  head: () => ({
    meta: [
      { title: "Founding Businesses | Contrax Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminFoundingBusinesses,
});
function AdminFoundingBusinesses() {
  const rows = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<Record<number, boolean>>({});
  async function update(slot: number, kind: "publish" | "hide" | "spotlight") {
    setBusy(true);
    setError("");
    try {
      await action({
        data: { slot, action: kind, reviewed: !!reviewed[slot] },
      });
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-console min-h-screen bg-slate-50 text-slate-900">
      <AdminHeader />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <AdminTabs active="founding-businesses" />
        <h1 className="mt-8 text-3xl font-bold">Founding Businesses</h1>
        <p className="mt-3 text-slate-600">
          Publish paid profiles within five business days of complete details.
          Prepare the Facebook spotlight for customer approval within 30 days of
          publication. Mark it complete only after posting.
        </p>
        <a
          href="/founding-businesses"
          className="mt-3 inline-block font-semibold text-blue-700"
        >
          View public page →
        </a>
        {error && (
          <p role="alert" className="mt-5 text-red-700">
            {error}
          </p>
        )}
        <div className="mt-8 space-y-5">
          {!rows.length && <p>No memberships purchased or reserved yet.</p>}
          {rows.map((r) => (
            <article
              className="rounded-2xl border border-slate-200 bg-white p-6"
              key={r.slot}
            >
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="text-xl font-bold">
                  #{r.slot} · {r.profile?.company}
                </h2>
                <span className="text-sm font-bold">
                  {r.paid_at ? "Paid · $99" : "Reserved · payment unconfirmed"}
                </span>
              </div>
              <p className="mt-3">{r.profile?.services}</p>
              <p className="mt-2 text-sm text-slate-600">
                {r.profile?.serviceArea} · {r.email}
              </p>
              <a
                className="mt-3 inline-block text-blue-700 underline"
                href={r.profile?.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                Company website
              </a>
              {r.profile?.logoUrl && (
                <p className="mt-2">
                  <a
                    href={r.profile.logoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline"
                  >
                    Review submitted logo
                  </a>
                </p>
              )}
              <p className="mt-3 text-sm text-slate-600">
                Publication:{" "}
                {r.published_at
                  ? `${new Date(r.published_at).toLocaleDateString()}${r.hidden ? " (hidden)" : ""}`
                  : "Pending review"}{" "}
                · Feature ends:{" "}
                {r.feature_expires_at
                  ? new Date(r.feature_expires_at).toLocaleDateString()
                  : "12 months from publication"}{" "}
                · Facebook: {r.spotlight_at ? "Completed" : "Pending"}
              </p>
              {r.paid_at && (
                <label className="mt-4 flex items-start gap-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={!!reviewed[r.slot]}
                    onChange={(e) =>
                      setReviewed({ ...reviewed, [r.slot]: e.target.checked })
                    }
                  />
                  I reviewed the logo, website and business claims.
                  Certifications remain self-reported unless verified; the
                  profile must not imply Contrax or government endorsement.
                </label>
              )}
              {r.paid_at && (
                <div className="mt-5 flex flex-wrap gap-3">
                  {(
                    [
                      ["publish", "Approve & publish"],
                      ["hide", "Hide profile"],
                      ["spotlight", "Mark Facebook spotlight posted"],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      disabled={
                        busy ||
                        (kind === "spotlight" && !!r.spotlight_at) ||
                        (kind === "publish" && !reviewed[r.slot])
                      }
                      onClick={() => update(Number(r.slot), kind)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
