// Server entry (TanStack Start picks up src/server.ts in place of its default entry, which is the
// same createStartHandler(defaultStreamHandler) call). The only addition: HTML responses have the
// router's raw NUL characters escaped, so simple fetchers and AI assistants read the page as text
// (owner 2026-11-08; see src/lib/html-nul.ts).
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { withoutHtmlNulls } from "./lib/html-nul";

const startFetch = createStartHandler(defaultStreamHandler);

export default {
  async fetch(...args: Parameters<typeof startFetch>) {
    return withoutHtmlNulls(await startFetch(...args));
  },
};
