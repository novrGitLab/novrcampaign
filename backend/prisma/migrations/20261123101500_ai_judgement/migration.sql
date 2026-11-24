-- NovrPulse: the AI judgement ledger (owner decision 2026-11-23).
--
-- One row per AI decision over a subject: a 'dedup' pairing, a 'rewrite', or a
-- 'recommend'. The row is the frozen INPUT SNAPSHOT (`scenario`/`detail`) plus
-- the model's OUTPUT (`decision`/`confidence`/`rationale`/`model`/
-- `promptVersion`) and the human REVIEW outcome (`outcome`/`reason`/
-- `reviewerId`/`reviewedAt`).
--
-- APPEND-ONLY (this migration is the enforcement, not just a convention):
--   * BEFORE UPDATE trigger `ai_judgement_append_only`: raises if ANY column
--     other than the four review columns (`outcome`, `reason`, `reviewerId`,
--     `reviewedAt`) changes. A row is an immutable record of what the AI decided
--     over what input; only the human adjudication may be written.
--   * BEFORE DELETE trigger `ai_judgement_no_delete`: raises unconditionally.
--     The ledger is training data and is never deleted. Deleting an `np_event` /
--     `publish_item` does NOT delete a judgement either — the FK is ON DELETE SET
--     NULL so the snapshot survives its subject.
--
-- CHECK constraints enforce the closed sets and the review-loop rules:
--   * outcome ∈ {pending, accepted, rejected}
--   * a rejected row MUST carry a reason
--   * kind ∈ {dedup, rewrite, recommend}
--   * exactly one subject is present: at least one of eventId / counterpartEventId
--     / publishItemId must be non-null.
--
-- Hand-written and additive: it does not alter or drop any existing object.
-- Deployed to the Docker localtest DB only (postgresql://novr:novr@localhost:5440/np_localtest).

-- CreateTable
CREATE TABLE "ai_judgement" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventId" TEXT,
    "counterpartEventId" TEXT,
    "publishItemId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "scenario" JSONB NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "detail" JSONB,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_judgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_judgement_kind_outcome_createdAt_idx" ON "ai_judgement"("kind", "outcome", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_judgement_eventId_idx" ON "ai_judgement"("eventId");

-- CreateIndex
CREATE INDEX "ai_judgement_subjectKey_idx" ON "ai_judgement"("subjectKey");

-- CreateIndex
CREATE INDEX "ai_judgement_publishItemId_idx" ON "ai_judgement"("publishItemId");

-- AddForeignKey
ALTER TABLE "ai_judgement" ADD CONSTRAINT "ai_judgement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "np_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_judgement" ADD CONSTRAINT "ai_judgement_publishItemId_fkey" FOREIGN KEY ("publishItemId") REFERENCES "publish_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Closed sets and review-loop invariants.
ALTER TABLE "ai_judgement" ADD CONSTRAINT "ai_judgement_outcome_check"
  CHECK ("outcome" IN ('pending', 'accepted', 'rejected'));

ALTER TABLE "ai_judgement" ADD CONSTRAINT "ai_judgement_rejected_reason_check"
  CHECK ("outcome" <> 'rejected' OR "reason" IS NOT NULL);

ALTER TABLE "ai_judgement" ADD CONSTRAINT "ai_judgement_kind_check"
  CHECK ("kind" IN ('dedup', 'rewrite', 'recommend'));

ALTER TABLE "ai_judgement" ADD CONSTRAINT "ai_judgement_subject_check"
  CHECK ("eventId" IS NOT NULL OR "counterpartEventId" IS NOT NULL OR "publishItemId" IS NOT NULL);

-- Append-only enforcement.
-- BEFORE UPDATE: allow ONLY the review columns to change. Every record column
-- (the AI's inputs and outputs) is immutable once written. IS DISTINCT FROM
-- treats NULL correctly, so writing the same value is a no-op and not a change.
CREATE OR REPLACE FUNCTION ai_judgement_append_only()
RETURNS trigger AS $$
BEGIN
    IF NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
       OR NEW."counterpartEventId" IS DISTINCT FROM OLD."counterpartEventId"
       OR NEW."publishItemId" IS DISTINCT FROM OLD."publishItemId"
       OR NEW."subjectKey" IS DISTINCT FROM OLD."subjectKey"
       OR NEW."scenario" IS DISTINCT FROM OLD."scenario"
       OR NEW."decision" IS DISTINCT FROM OLD."decision"
       OR NEW."confidence" IS DISTINCT FROM OLD."confidence"
       OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
       OR NEW."model" IS DISTINCT FROM OLD."model"
       OR NEW."promptVersion" IS DISTINCT FROM OLD."promptVersion"
       OR NEW."detail" IS DISTINCT FROM OLD."detail"
       OR NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
        RAISE EXCEPTION 'ai_judgement is append-only: only outcome, reason, reviewerId, reviewedAt may be updated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_judgement_append_only
    BEFORE UPDATE ON "ai_judgement"
    FOR EACH ROW EXECUTE FUNCTION ai_judgement_append_only();

-- BEFORE DELETE: the ledger is training data; a row is never removed.
CREATE OR REPLACE FUNCTION ai_judgement_no_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ai_judgement is append-only: rows are training data and may not be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_judgement_no_delete
    BEFORE DELETE ON "ai_judgement"
    FOR EACH ROW EXECUTE FUNCTION ai_judgement_no_delete();
