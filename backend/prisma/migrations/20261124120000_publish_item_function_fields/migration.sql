-- NovrPulse: per-item pillar fields for publish items (owner spec 2026-11-24).
--
-- Two new nullable columns on `publish_item`:
--   * "regulatoryImpact" — pillar 01 (Regulatory Impact): which laws/regulations
--     the item affects and what that means for the reader's business.
--   * "eventDate" — pillar 05 (Events): the event's date/time, used by the
--     7-day notice gate at approval time.
--
-- Both are nullable and additive: existing rows keep working, a 01/05 item
-- without the field can still be authored and saved — only APPROVAL is gated
-- (enforced in the controller, not the database, so old drafts are not broken).
--
-- Hand-written and additive: it does not alter or drop any existing object.
-- Deployed to the Docker localtest DB only (postgresql://novr:novr@localhost:5440/np_localtest).

-- AlterTable
ALTER TABLE "publish_item" ADD COLUMN "regulatoryImpact" TEXT;
ALTER TABLE "publish_item" ADD COLUMN "eventDate" TIMESTAMP(3);
