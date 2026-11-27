CREATE TYPE "StaffAccessState" AS ENUM ('NEW', 'PENDING', 'APPROVED', 'DECLINED');
CREATE TABLE "staff_access_request" (
  "id" TEXT PRIMARY KEY, "oidcSubject" TEXT NOT NULL UNIQUE, "email" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "StaffAccessState" NOT NULL DEFAULT 'NEW', "requestedAt" TIMESTAMP(3), "decidedAt" TIMESTAMP(3),
  "decidedBy" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE, "role" "Role"
);
CREATE INDEX "staff_access_request_status_requestedAt_idx" ON "staff_access_request"("status", "requestedAt");
CREATE TABLE "staff_access_notice" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "staff_access_request"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipient" TEXT NOT NULL, "kind" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMP(3),
  UNIQUE ("requestId", "recipient", "kind")
);
CREATE INDEX "staff_access_notice_sentAt_availableAt_idx" ON "staff_access_notice"("sentAt","availableAt");

