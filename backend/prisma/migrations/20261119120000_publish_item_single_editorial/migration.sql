-- NovrPulse: publish_item becomes the SINGLE editorial table (owner decision
-- 2026-11-19, Option C). This migration is hand-written and additive where it
-- can be, and makes the following changes:
--
--   1. ADD `contentType` with a MINIMAL closed set ('briefing','urgent_alert').
--      Added nullable, backfilled to 'briefing', then made NOT NULL + CHECKed.
--   2. DROP NOT NULL on `eventId` and `functionId` so a non-event-bound
--      editorial item (e.g. a briefing) can exist without an event/function.
--   3. TIERS become `public` | `paid` only. Drop the retired `analyst`/`client`
--      tiers (defensive data fix to 'paid'), then CHECK the closed set.
--   4. DROP COLUMN `confidence` — the confidence feature is removed entirely.
--   5. CREATE publish_item_event: the ordered join of a publish item to the
--      events it covers (PK (publishItemId, eventId), position, both FKs CASCADE).
--
-- No existing data is deleted; the tier data-fix is a forward remap, not a drop.

-- 1. contentType: nullable -> backfill -> NOT NULL -> CHECK.
ALTER TABLE "publish_item" ADD COLUMN "contentType" TEXT;
UPDATE "publish_item" SET "contentType" = 'briefing' WHERE "contentType" IS NULL;
ALTER TABLE "publish_item" ALTER COLUMN "contentType" SET NOT NULL;
ALTER TABLE "publish_item" ADD CONSTRAINT "publish_item_contentType_check"
  CHECK ("contentType" IN ('briefing', 'urgent_alert'));

-- 2. eventId / functionId become nullable (a briefing is not event-bound).
ALTER TABLE "publish_item" ALTER COLUMN "eventId" DROP NOT NULL;
ALTER TABLE "publish_item" ALTER COLUMN "functionId" DROP NOT NULL;

-- 3. Tiers: public | paid only. Remap the retired tiers, then CHECK.
UPDATE "publish_item" SET "tier" = 'paid' WHERE "tier" IN ('analyst', 'client');
ALTER TABLE "publish_item" ADD CONSTRAINT "publish_item_tier_check"
  CHECK ("tier" IN ('public', 'paid'));

-- 4. Drop the removed confidence column.
ALTER TABLE "publish_item" DROP COLUMN "confidence";

-- 5. CreateTable publish_item_event (ordered event linkage).
CREATE TABLE "publish_item_event" (
    "publishItemId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "publish_item_event_pkey" PRIMARY KEY ("publishItemId", "eventId")
);

-- CreateIndex
CREATE INDEX "publish_item_event_eventId_idx" ON "publish_item_event"("eventId");

-- AddForeignKey
ALTER TABLE "publish_item_event" ADD CONSTRAINT "publish_item_event_publishItemId_fkey" FOREIGN KEY ("publishItemId") REFERENCES "publish_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_item_event" ADD CONSTRAINT "publish_item_event_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "np_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
