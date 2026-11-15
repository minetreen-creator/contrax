import { createFileRoute, redirect } from "@tanstack/react-router";

// Owner 2026-11-03: "get rid of payments tracker on website". The page is off the site; the
// address sends everyone to the homepage. Its unreachable screen code was removed on 2026-11-15
// to keep the server bundle under its size ceiling; it is in git history before that date.
export const Route = createFileRoute("/contract-payments")({
  loader: async () => { throw redirect({ to: "/" }); },
  head: () => ({ meta: [{ title: "Contrax Payments — Payment Follow-up" }, { name: "robots", content: "noindex, nofollow" }] }),
});
