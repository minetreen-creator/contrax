/**
 * OpenAPI 3.0 description of the Contrax bid data feed (owner 2026-10-06), served at
 * /openapi.json so API marketplaces (RapidAPI, AWS Data Exchange) and developers can
 * import it. Kept in step with parseFeedQuery / toFeedRow in data-feed.ts (tests pin it).
 */
import { FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT } from "./data-feed";

const str = { type: "string" };
const nstr = { type: "string", nullable: true };

export const DATA_FEED_OPENAPI = {
  openapi: "3.0.3",
  info: {
    title: "Contrax Government Bid Data",
    version: "1.0.0",
    description:
      "Open U.S. federal, state and local government bids in one feed: real deadlines, official notice links, NAICS, set-asides and state. Updated every 4 hours on weekdays. Award notices and empty placeholder listings are excluded; a field the notice doesn't state is null.",
    contact: { name: "Contrax LLC", email: "contrax.companyllc@gmail.com", url: "https://www.contrax.company/data" },
  },
  servers: [{ url: "https://www.contrax.company" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "API key from your Contrax data feed plan" } },
    schemas: {
      Bid: {
        type: "object",
        required: ["id", "title", "agency", "source"],
        properties: {
          id: { type: "integer" },
          title: str,
          agency: str,
          description: nstr,
          state: { ...nstr, description: "USPS code of the place of performance, when the notice proves it" },
          location: nstr,
          category: nstr,
          naics_code: nstr,
          psc: nstr,
          set_aside: nstr,
          notice_type: nstr,
          solicitation_number: nstr,
          due_date: { type: "string", format: "date-time", nullable: true },
          estimated_value: nstr,
          source_url: { ...nstr, description: "Official notice" },
          source: str,
          first_seen_at: { type: "string", format: "date-time", nullable: true },
          updated_at: { type: "string", format: "date-time", nullable: true },
        },
      },
      FeedPage: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Bid" } },
          next_after: { type: "integer", nullable: true, description: "Pass as `after` for the next page; null on the last page" },
          count: { type: "integer" },
        },
      },
      Error: { type: "object", properties: { error: str } },
    },
  },
  paths: {
    "/api/v1/feed": {
      get: {
        summary: "Open government bids",
        operationId: "listOpenBids",
        parameters: [
          { name: "state", in: "query", schema: str, description: "Comma-separated USPS codes, e.g. VA,NC" },
          { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" }, description: "Only bids new or changed since this time" },
          { name: "naics", in: "query", schema: str, description: "Comma-separated NAICS prefixes (2–6 digits), e.g. 2382,561720" },
          { name: "set_aside", in: "query", schema: str, description: "Set-aside text to match, e.g. SDVOSB" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: FEED_MAX_LIMIT, default: FEED_DEFAULT_LIMIT } },
          { name: "after", in: "query", schema: { type: "integer", minimum: 0 }, description: "next_after from the previous page" },
        ],
        responses: {
          "200": { description: "A page of open bids", content: { "application/json": { schema: { $ref: "#/components/schemas/FeedPage" } } } },
          "400": { description: "Invalid parameter", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "Key has no feed access, or a state outside the plan", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
  },
} as const;
