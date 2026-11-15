import { createFileRoute, redirect } from "@tanstack/react-router";

// Owner 2026-11-15 ("Remove the four guides"): the certification guides are retired. The address
// stays so no link breaks.
export const Route = createFileRoute("/learn/sdvosb-guide")({
  beforeLoad: () => {
    throw redirect({ href: "/learn", statusCode: 301 });
  },
});
