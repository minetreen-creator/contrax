import { createFileRoute, redirect } from "@tanstack/react-router";

const PROD_URL = "https://www.contrax.company";
const TITLE = "Government Contracting Knowledge Base — Contrax";
const DESC = "Practical government contracting guidance for set-aside businesses, covering 8(a), SDVOSB, WOSB, HUBZone certifications, proposals, and compliance.";

export const Route = createFileRoute("/knowledge")({
  loader: () => {
    throw redirect({ to: "/learn", statusCode: 301 });
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/knowledge` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
    ],
  }),
});
