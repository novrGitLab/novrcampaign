-- NovrPulse: remove the confidence feature from the event store (owner decision
-- 2026-11-19). `np_event.confidence` is dropped; nothing reads it after the
-- confidence floor gate was removed from the projection. This migration is a
-- pure DROP and does not rewrite any other data.
ALTER TABLE "np_event" DROP COLUMN "confidence";
