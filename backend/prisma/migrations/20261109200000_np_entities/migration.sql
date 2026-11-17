-- CreateTable
CREATE TABLE "np_entity" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "country" TEXT,
    "identifiers" JSONB,
    "description" TEXT,
    "mergedInto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "np_entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "np_entity_alias" (
    "alias" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "np_entity_alias_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "np_event_entity" (
    "eventId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'mentioned',

    CONSTRAINT "np_event_entity_pkey" PRIMARY KEY ("eventId","entityId","role")
);

-- CreateIndex
CREATE INDEX "np_entity_type_idx" ON "np_entity"("type");

-- CreateIndex
CREATE INDEX "np_entity_canonicalName_idx" ON "np_entity"("canonicalName");

-- CreateIndex
CREATE INDEX "np_entity_alias_entityId_idx" ON "np_entity_alias"("entityId");

-- CreateIndex
CREATE INDEX "np_event_entity_entityId_idx" ON "np_event_entity"("entityId");

-- AddForeignKey
ALTER TABLE "np_entity_alias" ADD CONSTRAINT "np_entity_alias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "np_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "np_event_entity" ADD CONSTRAINT "np_event_entity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "np_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "np_event_entity" ADD CONSTRAINT "np_event_entity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "np_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
