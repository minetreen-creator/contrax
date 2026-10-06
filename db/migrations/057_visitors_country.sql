-- Owner 2026-10-06: keep the visitor's country (x-vercel-ip-country) so the
-- admin ad check can tell Lagos ("LA") from Louisiana. Additive and nullable;
-- older rows stay NULL. tracking-intake.ts adds the same column at runtime.
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS country TEXT;
