-- A sign-in made with a pairing code names its device, so the account can list and revoke it.
ALTER TABLE "session" ADD COLUMN "pairedDevice" TEXT;
