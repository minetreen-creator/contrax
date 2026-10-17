import { createFileRoute } from "@tanstack/react-router";
import { Launchpad } from "~/components/Launchpad";
import { SiteHeader } from "~/components/SiteHeader";

export const Route = createFileRoute("/launchpad")({
  head: () => ({
    meta: [
      {
        title:
          "Contrax Launchpad | Learn. Get ready. Pursue your first contract.",
      },
      {
        name: "description",
        content:
          "A free guided workspace connecting government contracting classes to your business profile, capability statement, registration checklist and first-opportunity plan.",
      },
    ],
    links: [
      { rel: "canonical", href: "https://www.contrax.company/launchpad" },
    ],
  }),
  component: () => (
    <>
      <SiteHeader />
      <Launchpad />
    </>
  ),
});
