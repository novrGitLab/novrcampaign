-- NovrPulse: the daily briefing desk tables (owner decision 2026-11-19).
-- A `briefing` is one day's briefing (one row per `briefing_date`). It is
-- composed from ordered `briefing_section`s (one per function), each of which
-- references ordered `briefing_section_item`s (the publish items that make up
-- that section). `supporting_event` and `opportunity` are standalone desk
-- entries; `forum_topic` is a weekly discussion prompt, optionally linked to a
-- publish item (SET NULL so the topic survives the publish item).
CREATE TABLE "briefing" (
    "id" TEXT NOT NULL,
    "briefingDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "title" TEXT,
    "publishedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "briefing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "briefing_section" (
    "id" TEXT NOT NULL,
    "briefingId" TEXT NOT NULL,
    "functionId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'empty',
    "note" TEXT,

    CONSTRAINT "briefing_section_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "briefing_section_item" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "publishItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "briefing_section_item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supporting_event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "organiser" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "onlineUrl" TEXT,
    "registrationUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supporting_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT,
    "deadline" TIMESTAMP(3),
    "url" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_topic" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "publishItemId" TEXT,
    "forumUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_topic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "briefing_briefingDate_key" ON "briefing"("briefingDate");

-- CreateIndex
CREATE INDEX "briefing_briefingDate_idx" ON "briefing"("briefingDate");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_section_briefingId_functionId_key" ON "briefing_section"("briefingId", "functionId");

-- CreateIndex
CREATE INDEX "briefing_section_briefingId_position_idx" ON "briefing_section"("briefingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_section_item_sectionId_publishItemId_key" ON "briefing_section_item"("sectionId", "publishItemId");

-- CreateIndex
CREATE INDEX "briefing_section_item_sectionId_position_idx" ON "briefing_section_item"("sectionId", "position");

-- CreateIndex
CREATE INDEX "supporting_event_startsAt_idx" ON "supporting_event"("startsAt");

-- AddForeignKey
ALTER TABLE "briefing_section" ADD CONSTRAINT "briefing_section_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "briefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_section_item" ADD CONSTRAINT "briefing_section_item_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "briefing_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_section_item" ADD CONSTRAINT "briefing_section_item_publishItemId_fkey" FOREIGN KEY ("publishItemId") REFERENCES "publish_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topic" ADD CONSTRAINT "forum_topic_publishItemId_fkey" FOREIGN KEY ("publishItemId") REFERENCES "publish_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Closed sets for the briefing desk's status/state and opportunity kind,
-- mirroring the existing plain-String enum-house style.
ALTER TABLE "briefing" ADD CONSTRAINT "briefing_status_check"
  CHECK ("status" IN ('not_started', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'archived'));
ALTER TABLE "briefing_section" ADD CONSTRAINT "briefing_section_functionId_check"
  CHECK ("functionId" BETWEEN 1 AND 8);
ALTER TABLE "briefing_section" ADD CONSTRAINT "briefing_section_state_check"
  CHECK ("state" IN ('empty', 'no_updates', 'ready', 'awaiting'));
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_kind_check"
  CHECK ("kind" IN ('scholarship', 'course', 'programme', 'other'));
