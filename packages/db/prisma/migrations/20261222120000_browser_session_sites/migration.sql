CREATE TABLE "browser_session_sites" (
  "botId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "site" TEXT NOT NULL,
  "itemVersion" TEXT NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "browser_session_sites_pkey" PRIMARY KEY ("botId", "site"),
  CONSTRAINT "browser_session_sites_botId_fkey" FOREIGN KEY ("botId")
    REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "browser_session_sites_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "browser_session_sites_userId_spaceId_idx"
  ON "browser_session_sites"("userId", "spaceId");

ALTER TABLE "browser_session_sites" ENABLE ROW LEVEL SECURITY;
CREATE POLICY browser_session_sites_tenant ON "browser_session_sites"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), '')
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY browser_session_sites_system ON "browser_session_sites"
  USING ((SELECT app_rls_bypass()));
