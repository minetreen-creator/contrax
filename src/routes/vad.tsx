import { createFileRoute, redirect } from "@tanstack/react-router";

// Owner 2026-11-22: "get rid of any VAD information and payments". The partner page and its prices
// are gone; an old link lands on the regular pricing page.
export const Route = createFileRoute("/vad")({
  beforeLoad: () => {
    throw redirect({ to: "/pricing", statusCode: 301 });
  },
});
