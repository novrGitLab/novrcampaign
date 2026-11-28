ALTER TABLE "np_event" ADD COLUMN "photos" JSONB;
ALTER TABLE "publish_item" ADD COLUMN "photos" JSONB;
ALTER TABLE "feed_entry" ADD COLUMN "photos" JSONB;
ALTER TABLE "briefing_section_item" ADD COLUMN "photos" JSONB;

UPDATE "briefing_section_item" SET "photos" = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'url', "imageUrl", 'alt', "imageAlt", 'credit', "imageCredit"
))) WHERE "imageUrl" IS NOT NULL AND NULLIF(trim("imageAlt"), '') IS NOT NULL;

UPDATE "publish_item" p SET "photos" = gallery.photos FROM (
  SELECT DISTINCT ON (l."publishItemId") l."publishItemId", l.photos
  FROM "briefing_section_item" l JOIN "briefing_section" s ON s.id = l."sectionId"
  JOIN "briefing" b ON b.id = s."briefingId" WHERE l.photos IS NOT NULL
  ORDER BY l."publishItemId", b."briefingDate" DESC, l.id
) gallery WHERE p.id = gallery."publishItemId";

UPDATE "np_event" e SET "photos" = gallery.photos FROM (
  SELECT DISTINCT ON ("eventId") "eventId", photos FROM "publish_item"
  WHERE "eventId" IS NOT NULL AND photos IS NOT NULL ORDER BY "eventId", "createdAt" DESC, id
) gallery WHERE e.id = gallery."eventId";
