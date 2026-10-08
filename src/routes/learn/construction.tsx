import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/learn/construction")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/learn/government-contracting${location.searchStr}`, statusCode: 301 });
  },
});
