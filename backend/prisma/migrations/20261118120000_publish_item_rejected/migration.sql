-- AlterTable
-- A rejected publish item is a DRAFT that a human has explicitly turned down
-- (owner decision 2026-11-18). Recording `rejectedAt` alongside `approvedAt`
-- keeps the review outcome in the audit trail and lets `deriveStatus` report
-- `rejected` distinctly. This migration is additive: the column is nullable, so
-- existing rows are unaffected and no data is dropped or rewritten.
ALTER TABLE "publish_item" ADD COLUMN "rejectedAt" TIMESTAMP(3);
