-- NovrPulse: the briefing_publication snapshot table (Publish → Preview → Send
-- milestone, owner requirement 2026-11-25).
--
-- A `briefing_publication` records the exact rendered EMAIL HTML of a whole
-- `briefing` at the moment it was sent, plus the version, when it was sent, and
-- the segments it went to. This is deliberately a SEPARATE table from
-- `published_briefing` (which is per-ITEM — one row per `publish_item`, a
-- snapshot of that single item's rendered body). A briefing publication is
-- per-BRIEFING and semantically different, so overloading the per-item table
-- would make both concepts muddier. A briefing may be published more than once
-- (a corrected edition), so `(briefingId, version)` is unique rather than
-- `briefingId` alone.
--
-- `kind` is 'production' | 'test': a test send also records a row for audit, but
-- it does not snapshot the whole email (only production does) and does not
-- count as a publication of the briefing.
--
-- Hand-written and ADDITIVE: it creates one new table and does not alter or drop
-- any existing object. Deployed to the Docker localtest DB only
-- (postgresql://novr:novr@localhost:5440/np_localtest).
CREATE TABLE "briefing_publication" (
    "id" TEXT NOT NULL,
    "briefingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'production',
    "version" INTEGER NOT NULL DEFAULT 1,
    "html" TEXT,
    "segments" TEXT[],
    "recipientSummary" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_publication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "briefing_publication_briefingId_version_key" ON "briefing_publication"("briefingId", "version");

-- CreateIndex
CREATE INDEX "briefing_publication_briefingId_idx" ON "briefing_publication"("briefingId");

-- AddForeignKey
ALTER TABLE "briefing_publication" ADD CONSTRAINT "briefing_publication_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "briefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed set for the publication kind, mirroring the existing plain-String
-- enum-house style.
ALTER TABLE "briefing_publication" ADD CONSTRAINT "briefing_publication_kind_check"
  CHECK ("kind" IN ('production', 'test'));
