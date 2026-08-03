import { createFileRoute } from "@tanstack/react-router";
import WordDemo from "~/components/WordDemo";

export const Route = createFileRoute("/word-demo/")({
  component: WordDemo,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" },
      { title: "Contrax in Word — Contract Intelligence" },
      {
        name: "description",
        content:
          "See how Contrax reviews government contract language directly inside Microsoft Word.",
      },
    ],
  }),
});
