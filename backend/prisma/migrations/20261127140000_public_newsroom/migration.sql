ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL, ADD COLUMN "oidcSubject" TEXT;
CREATE UNIQUE INDEX "User_oidcSubject_key" ON "User"("oidcSubject");
ALTER TABLE "briefing" ADD COLUMN "sendingAt" TIMESTAMP(3);
ALTER TABLE "briefing_section_item" ADD COLUMN "imageUrl" TEXT, ADD COLUMN "imageAlt" TEXT, ADD COLUMN "imageCredit" TEXT;
ALTER TABLE "briefing_section" DROP CONSTRAINT "briefing_section_functionId_check";
ALTER TABLE "briefing_section" ADD CONSTRAINT "briefing_section_functionId_check" CHECK ("functionId" BETWEEN 1 AND 10);
INSERT INTO "briefing_section" (id, "briefingId", "functionId", position, state)
SELECT gen_random_uuid()::text, b.id, f, f, 'empty' FROM briefing b CROSS JOIN generate_series(9,10) f WHERE b.status NOT IN ('published','archived') ON CONFLICT DO NOTHING;
CREATE INDEX "np_event_public_date_idx" ON np_event ("publishedAt" DESC, id) WHERE "isCybersecurity" IS TRUE AND "reviewStatus" <> 'dismissed';
CREATE TABLE staff_session (hash TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "staff_session_expiresAt_idx" ON staff_session ("expiresAt");
CREATE TABLE newsletter_confirmation (hash TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL);
