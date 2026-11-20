-- AlterTable
-- A projected publish item is a DRAFT awaiting human sign-off (01-policies.md §2.7).
-- The audit trail must reflect that: ONLY the human approve/withdraw endpoints may
-- set `approvedAt` and `editorId`. Automation (the F7 projection) may not. Making
-- both columns nullable lets a draft row carry neither, so `deriveStatus` reports
-- `draft` rather than a false `approved`. This migration is additive and does not
-- drop or rewrite any existing data.
ALTER TABLE "publish_item" ALTER COLUMN "editorId" DROP NOT NULL;
ALTER TABLE "publish_item" ALTER COLUMN "approvedAt" DROP NOT NULL;
