-- AI assistant feature key ("assistant"): ON for every existing business, so nobody loses the
-- assistant when the feature gate ships. Admins can switch it off per client afterwards.
-- Data only (no schema change). Live sessions pick it up because permissionsUpdatedAt moves.

INSERT INTO "FeaturePermission" ("id", "businessId", "featureKey", "enabled")
SELECT gen_random_uuid()::text, b."id", 'assistant', true
FROM "Business" b
ON CONFLICT ("businessId", "featureKey") DO UPDATE SET "enabled" = true;

UPDATE "Business" SET "permissionsUpdatedAt" = CURRENT_TIMESTAMP;
