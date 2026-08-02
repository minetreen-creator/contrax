import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/knowledge")({
  loader: () => {
    throw redirect({ to: "/learn", statusCode: 301 });
  },
});
