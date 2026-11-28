UPDATE "np_event" e SET "articlePublished" = e."articlePublished" || jsonb_build_object('photos', COALESCE((
  SELECT jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'url', l."imageUrl", 'alt', l."imageAlt", 'credit', l."imageCredit"
  ))) FROM "publish_item" p
  JOIN "briefing_section_item" l ON l."publishItemId" = p.id
  JOIN "briefing_section" s ON s.id = l."sectionId"
  JOIN "briefing" b ON b.id = s."briefingId"
  WHERE p."eventId" = e.id AND p.tier = 'public' AND p."withdrawnAt" IS NULL
    AND p."rejectedAt" IS NULL AND p."publishedAt" IS NOT NULL AND b."publishedAt" IS NOT NULL
    AND l."imageUrl" IS NOT NULL AND NULLIF(trim(l."imageAlt"), '') IS NOT NULL
  ORDER BY p."publishedAt" DESC, l.position, l.id LIMIT 1
), '[]'::jsonb))
WHERE jsonb_typeof(e."articlePublished") = 'object' AND NOT e."articlePublished" ? 'photos';
