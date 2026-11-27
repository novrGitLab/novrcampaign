ALTER TABLE "np_event"
  ADD COLUMN "screeningDecision" TEXT,
  ADD COLUMN "screeningReason" TEXT,
  ADD COLUMN "screeningConfidence" DOUBLE PRECISION,
  ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "restoredBy" TEXT;

CREATE INDEX "np_event_rejected_order" ON "np_event" ("publishedAt" DESC NULLS LAST, "id" DESC)
  WHERE "isCybersecurity" = false OR "reviewStatus" = 'dismissed';
