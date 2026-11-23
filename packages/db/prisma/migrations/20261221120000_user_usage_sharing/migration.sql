ALTER TABLE "user" ADD COLUMN "usageSharing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "usageSharingAnsweredAt" TIMESTAMP(3);
UPDATE "user" SET "usageSharingAnsweredAt" = CURRENT_TIMESTAMP;
