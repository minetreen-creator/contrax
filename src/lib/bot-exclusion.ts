/**
 * Bot/crawler exclusion predicate against the analytics tables' shared columns
 * (ip / user_agent / referrer). Used by the admin metrics + acquisition slices so
 * the dashboard stops counting search-engine crawlers, social link-preview
 * scrapers (facebookexternalhit etc.), headless QA browsers, and our own test IPs
 * as real visitors.
 *
 * Originally defined inline in src/routes/api/admin/metrics.ts (PR #210). Hoisted
 * here so the admin "Acquisition by Source" slice (PR #214) can reuse the SAME
 * predicate without re-inventing it. Inlined via sql().unsafe() into a
 * `WHERE ... AND NOT ( ... )` clause. Tuned to be conservative: it only excludes
 * known crawler IP prefixes, bot user-agents, and explicit test IPs. Null-IP rows
 * are NOT excluded unless their user_agent is bot-like (some real views
 * legitimately lack an IP).
 *
 * NOTE: both page_views and funnel_events expose ip / user_agent / referrer
 * columns, so this snippet works verbatim against either table.
 */
export const BOT_EXCLUSION_SQL = `
  (
    -- Our own test / scraper IPs (exclude always).
    ip IN ('34.214.71.218','73.40.36.204')
    -- Search-engine crawler IP prefixes: Googlebot + common Bing ranges.
    OR ip LIKE '66.249.%'
    OR ip LIKE '40.77.%' OR ip LIKE '157.55.%' OR ip LIKE '207.46.%'
    -- Social link-preview / crawler IP prefixes (Facebook/Meta, etc.).
    OR ip LIKE '66.220.%' OR ip LIKE '31.13.%' OR ip LIKE '173.252.%'
    OR ip LIKE '104.189.%' OR ip LIKE '69.171.%' OR ip LIKE '157.240.%'
    -- Meta/AWS link-preview fetchers — BUT only when the referrer is a Facebook
    -- host, so we don't over-exclude real humans on AWS residential IPs.
    OR (
      ( ip LIKE '52.%' OR ip LIKE '54.%' OR ip LIKE '35.%' OR ip LIKE '44.%' OR ip LIKE '34.%' )
      AND LOWER(COALESCE(referrer,'')) LIKE '%facebook%'
    )
    -- Search-engine bot user-agents.
    OR LOWER(COALESCE(user_agent,'')) LIKE '%googlebot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%bingbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%slurp%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%duckduckbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%baiduspider%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%yandexbot%'
    -- Social link-preview / crawler user-agents.
    OR LOWER(COALESCE(user_agent,'')) LIKE '%facebookexternalhit%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%facebot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%twitterbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%linkedinbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%slackbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%discordbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%redditbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%pinterestbot%'
    -- Generic bot / headless-browser / CLI scrapers (case-insensitive).
    OR LOWER(COALESCE(user_agent,'')) LIKE '%bot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%crawler%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%spider%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%headlesschrome%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%puppeteer%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%playwright%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%python%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%curl%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%wget%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%go-http-client%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%semrushbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%ahrefsbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%mj12bot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%dotbot%'
  )
`;
