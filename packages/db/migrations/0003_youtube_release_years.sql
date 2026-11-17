-- Tracks known only from YouTube got the video's upload year as their release
-- year (a 1993 song uploaded in 2009 read as 2009). Clear those so the server
-- looks the year up again (Apple Music match or MusicBrainz) on next use.
UPDATE "track" SET "release_year" = NULL
WHERE EXISTS (SELECT 1 FROM "track_provider_ref" r WHERE r."track_id" = "track"."id" AND r."provider" = 'YOUTUBE')
  AND NOT EXISTS (SELECT 1 FROM "track_provider_ref" r WHERE r."track_id" = "track"."id" AND r."provider" IN ('APPLE_MUSIC', 'VYBZ_DEMO'));
