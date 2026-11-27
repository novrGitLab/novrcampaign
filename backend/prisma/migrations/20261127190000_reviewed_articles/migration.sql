ALTER TABLE "np_event"
  ADD COLUMN "articleVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "articleDraft" JSONB,
  ADD COLUMN "articleEvidence" TEXT,
  ADD COLUMN "articlePublished" JSONB,
  ADD COLUMN "articleApprovedAt" TIMESTAMP(3),
  ADD COLUMN "articleApprovedBy" TEXT;
