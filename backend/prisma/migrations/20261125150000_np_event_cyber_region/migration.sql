-- NovrPulse: regional cybersecurity classification (owner requirement 2026-11-25).
--
-- The owner's filter model is: is this CYBERSECURITY news, and if so which
-- REGION — Nigeria (priority), Africa, or Global. This adds ONE nullable TEXT
-- column to `np_event`:
--
--   * "cyberRegion" — 'NG' | 'AF' | 'GLOBAL', or NULL.
--
-- NULL is deliberate and overloaded by design: it means "unclassified OR not
-- cyber". The deterministic keyword pre-tag at store time sets 'NG'/'AF'/'GLOBAL'
-- only when the item looks cyber (a cyber keyword hit OR a region-suggesting
-- source), leaving NULL otherwise; the batched AI classification pass then sets
-- it authoritatively and leaves it NULL when the story is not cyber. A partial
-- CHECK enforces the three-value domain while still permitting NULL.
--
-- Hand-written and additive: one ADD COLUMN and one CHECK constraint; no existing
-- object is altered or dropped. The retired `isNigeriaRelated` column is NOT
-- touched here (columns are never dropped). Deployed to the Docker localtest DB
-- only (postgresql://novr:novr@localhost:5440/np_localtest).

-- AlterTable
ALTER TABLE "np_event" ADD COLUMN "cyberRegion" TEXT;

-- AddConstraint
ALTER TABLE "np_event"
  ADD CONSTRAINT "np_event_cyberRegion_check"
  CHECK ("cyberRegion" IS NULL OR "cyberRegion" IN ('NG', 'AF', 'GLOBAL'));
