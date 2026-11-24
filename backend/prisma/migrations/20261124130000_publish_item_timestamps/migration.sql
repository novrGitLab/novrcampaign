-- NovrPulse: row lifecycle timestamps on publish items (owner spec 2026-11-24).
--
-- Two new non-null timestamp columns on `publish_item`:
--   * "createdAt" — when the piece was created. Drives the minimal Today desk's
--     day filter: a piece belongs to "today's email" when its Lagos day equals
--     today. Before this column the client's createdAt/approvedAt "today" filter
--     could never work, so the desk listed all drafts forever.
--   * "updatedAt" — maintained by Prisma on every write (@updatedAt).
--
-- Both are additive and backfilled: existing rows receive the migration's
-- CURRENT_TIMESTAMP. A DEFAULT is declared on both columns so the ALTER is safe
-- on a populated table; the runtime default for new rows is Prisma's `now()`.
--
-- Hand-written and additive: it does not alter or drop any existing object.
-- Deployed to the Docker localtest DB only (postgresql://novr:novr@localhost:5440/np_localtest).

-- AlterTable
ALTER TABLE "publish_item" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "publish_item" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
