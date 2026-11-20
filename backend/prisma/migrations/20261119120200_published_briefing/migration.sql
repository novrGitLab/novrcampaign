-- NovrPulse: the published_briefing snapshot table (owner decision 2026-11-19).
-- A `published_briefing` records the exact rendered body of a publish item at
-- the moment it was published, so a reader can be served a stable snapshot even
-- after the source event changes. One snapshot per publish item (UNIQUE).
CREATE TABLE "published_briefing" (
    "id" TEXT NOT NULL,
    "publishItemId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "published_briefing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "published_briefing_publishItemId_key" ON "published_briefing"("publishItemId");

-- AddForeignKey
ALTER TABLE "published_briefing" ADD CONSTRAINT "published_briefing_publishItemId_fkey" FOREIGN KEY ("publishItemId") REFERENCES "publish_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed sets for the snapshot's tier and contentType, mirroring publish_item.
ALTER TABLE "published_briefing" ADD CONSTRAINT "published_briefing_tier_check"
  CHECK ("tier" IN ('public', 'paid'));
ALTER TABLE "published_briefing" ADD CONSTRAINT "published_briefing_contentType_check"
  CHECK ("contentType" IN ('briefing', 'urgent_alert'));
