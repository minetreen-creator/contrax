import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import { getUserPatterns, generateInsights, getImplicitPreferences, type UserPatterns, type ImplicitPreference } from "~/lib/learning";

// ── Server Functions ─────────────────────────────────────────────────────────

const fetchLearnings = createServerFn({ method: "GET" }).handler(async (): Promise<{
  patterns: UserPatterns;
  insights: string[];
  preferences: ImplicitPreference[];
}> => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  const patterns = await getUserPatterns(user.email);
  const insights = patterns.total >= 2 ? await generateInsights(user.email) : [];
  const preferences = await getImplicitPreferences(user.email);
  return { patterns, insights, preferences };
});

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/learnings")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return fetchLearnings();
  },

  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" },
      { title: "Learning Engine | Contrax" },
      { name: "description", content: "Track win/loss patterns and get AI-powered recommendations to improve your government contract bid strategy." },
    ],
  }),
});
