-- NovrPulse: AI filtering classification flags on events (owner requirement
-- 2026-11-25).
--
-- Three new NULLABLE boolean columns on `np_event`:
--   * "isCybersecurity"  — the story is cybersecurity-related.
--   * "isThreatIntel"    — the story is threat-intelligence related (actors,
--                          campaigns, IOCs/TTPs, malware families, ATT&CK).
--   * "isNigeriaRelated" — the story is Nigeria-related.
--
-- NULLABLE is deliberate: NULL means UNCLASSIFIED. The deterministic keyword
-- pre-tag at store time sets a flag only when it is TRUE and leaves it NULL
-- otherwise (so the accurate LLM pass can still fill it); the batched AI
-- classification pass then sets all three per its judgment. There is no
-- separate `aiClassifiedAt` column — the null booleans ARE the "not yet
-- classified" signal the classification query keys on, so existing rows are
-- correctly treated as unclassified after this migration with no backfill.
--
-- Hand-written and additive: three ADD COLUMNs; no existing object is altered
-- or dropped. Deployed to the Docker localtest DB only
-- (postgresql://novr:novr@localhost:5440/np_localtest).

-- AlterTable
ALTER TABLE "np_event" ADD COLUMN "isCybersecurity" BOOLEAN;
ALTER TABLE "np_event" ADD COLUMN "isThreatIntel" BOOLEAN;
ALTER TABLE "np_event" ADD COLUMN "isNigeriaRelated" BOOLEAN;
