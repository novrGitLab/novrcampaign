-- NovrPulse: drop event severity (owner decision 2026-11-19). `np_event.severity`
-- and `np_event.severitySource` are never populated and nothing reads them after
-- the understanding layer stopped persisting the LLM severity suggestion.
--
-- The composite index `np_event_severity_publishedAt_idx` covers the dropped
-- `severity` column, so it must be dropped before the column. This migration is
-- a pure DROP of an index and two columns; no other data is rewritten.
DROP INDEX "np_event_severity_publishedAt_idx";
ALTER TABLE "np_event" DROP COLUMN "severity";
ALTER TABLE "np_event" DROP COLUMN "severitySource";
