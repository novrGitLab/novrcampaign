-- NovrPulse: persist reviewer Accept/Dismiss triage on the event store (owner
-- decision 2026-11-19). `reviewStatus` holds "new" | "accepted" | "dismissed".
--
-- Additive and nullable-safe: added NOT NULL with a constant default, so existing
-- rows are backfilled to "new" without a rewrite and no data is touched. Dismiss
-- is non-destructive (it only sets this value; raw evidence is never altered).
ALTER TABLE "np_event" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'new';
