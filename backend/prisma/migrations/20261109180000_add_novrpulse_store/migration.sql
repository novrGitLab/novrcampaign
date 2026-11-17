-- CreateTable
CREATE TABLE "np_source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "functions" INTEGER[],
    "type" TEXT NOT NULL,
    "licence" TEXT NOT NULL DEFAULT 'unknown',
    "licenceStatus" TEXT NOT NULL DEFAULT 'unknown',
    "paywall" BOOLEAN NOT NULL DEFAULT false,
    "hasRss" BOOLEAN NOT NULL DEFAULT false,
    "feedUrl" TEXT,
    "rateLimit" TEXT,
    "reliability" DOUBLE PRECISION,
    "approvedBy" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSuccessAt" TIMESTAMP(3),
    "canaryOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "np_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "np_raw_document" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentType" TEXT,
    "storageKey" TEXT,
    "httpStatus" INTEGER,
    "fetchError" TEXT,
    "body" TEXT,

    CONSTRAINT "np_raw_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "np_event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT,
    "publishedAt" TIMESTAMP(3),
    "canonicalUrl" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "region" TEXT,
    "eventType" TEXT,
    "functions" INTEGER[],
    "severity" INTEGER,
    "severitySource" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'reported',
    "clusterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "np_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "np_event_source" (
    "eventId" TEXT NOT NULL,
    "rawDocumentId" TEXT NOT NULL,
    "extractorModel" TEXT,
    "promptVersion" TEXT,
    "pageRef" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'reported',
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "np_event_source_pkey" PRIMARY KEY ("eventId","rawDocumentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "np_raw_document_contentHash_key" ON "np_raw_document"("contentHash");

-- CreateIndex
CREATE INDEX "np_raw_document_sourceId_fetchedAt_idx" ON "np_raw_document"("sourceId", "fetchedAt");

-- CreateIndex
CREATE INDEX "np_event_publishedAt_idx" ON "np_event"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "np_event_severity_publishedAt_idx" ON "np_event"("severity" DESC, "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "np_event_clusterId_idx" ON "np_event"("clusterId");

-- CreateIndex
CREATE INDEX "np_event_source_rawDocumentId_idx" ON "np_event_source"("rawDocumentId");

-- AddForeignKey
ALTER TABLE "np_raw_document" ADD CONSTRAINT "np_raw_document_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "np_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "np_event_source" ADD CONSTRAINT "np_event_source_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "np_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "np_event_source" ADD CONSTRAINT "np_event_source_rawDocumentId_fkey" FOREIGN KEY ("rawDocumentId") REFERENCES "np_raw_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
