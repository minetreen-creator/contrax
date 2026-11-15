import { createFileRoute, redirect } from "@tanstack/react-router";

// Owner 2026-11-15 ("Remove the four guides"): the certification guides are retired. The address
// stays so no link breaks.
export const Route = createFileRoute("/learn/8a-certification-guide")({
  beforeLoad: () => {
    throw redirect({ href: "/blog/8a-certification-guide", statusCode: 301 });
  },
});
