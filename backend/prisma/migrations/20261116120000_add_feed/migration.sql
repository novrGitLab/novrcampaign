-- CreateTable
CREATE TABLE "feed_entry" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feed_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_feed_entry" (
    "campaignId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "insertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "insertedBy" TEXT NOT NULL,

    CONSTRAINT "campaign_feed_entry_pkey" PRIMARY KEY ("campaignId","entryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_entry_url_key" ON "feed_entry"("url");

-- CreateIndex
CREATE INDEX "feed_entry_publishedAt_idx" ON "feed_entry"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "feed_entry_status_idx" ON "feed_entry"("status");

-- CreateIndex
CREATE INDEX "campaign_feed_entry_entryId_idx" ON "campaign_feed_entry"("entryId");

-- AddForeignKey
ALTER TABLE "campaign_feed_entry" ADD CONSTRAINT "campaign_feed_entry_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "feed_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
