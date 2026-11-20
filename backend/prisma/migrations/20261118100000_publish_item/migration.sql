-- CreateTable
CREATE TABLE "publish_item" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "functionId" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'reported',
    "editorId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "publish_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction" (
    "id" TEXT NOT NULL,
    "publishItemId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedBy" TEXT NOT NULL,
    "redeliveredAt" TIMESTAMP(3),
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publish_item_functionId_tier_publishedAt_idx" ON "publish_item"("functionId", "tier", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "correction_publishItemId_idx" ON "correction"("publishItemId");

-- AddForeignKey
ALTER TABLE "publish_item" ADD CONSTRAINT "publish_item_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "np_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction" ADD CONSTRAINT "correction_publishItemId_fkey" FOREIGN KEY ("publishItemId") REFERENCES "publish_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
