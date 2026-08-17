-- CreateEnum
CREATE TYPE "AutomationPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK');

-- CreateTable
CREATE TABLE "FacebookPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "isConnected" BOOLEAN NOT NULL DEFAULT true,
    "webhookSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookPage_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Automation"
    ADD COLUMN "platform" "AutomationPlatform" NOT NULL DEFAULT 'INSTAGRAM',
    ADD COLUMN "facebookPageId" TEXT,
    ALTER COLUMN "instagramAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DmLog"
    ADD COLUMN "platform" "AutomationPlatform" NOT NULL DEFAULT 'INSTAGRAM',
    ADD COLUMN "facebookPageId" TEXT,
    ADD COLUMN "facebookRecipientId" TEXT,
    ADD COLUMN "followUpQueuedAt" TIMESTAMP(3),
    ADD COLUMN "followUpSentAt" TIMESTAMP(3),
    ADD COLUMN "followUpError" TEXT,
    ALTER COLUMN "instagramAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProcessedComment"
    ADD COLUMN "platform" "AutomationPlatform" NOT NULL DEFAULT 'INSTAGRAM',
    ADD COLUMN "facebookPageId" TEXT,
    ALTER COLUMN "instagramAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LinkClick"
    ADD COLUMN "platform" "AutomationPlatform" NOT NULL DEFAULT 'INSTAGRAM',
    ADD COLUMN "facebookPageId" TEXT,
    ADD COLUMN "dmLogId" TEXT,
    ALTER COLUMN "instagramAccountId" DROP NOT NULL;

-- Account invariants
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_platform_account_check"
CHECK (
    ("platform" = 'INSTAGRAM' AND "instagramAccountId" IS NOT NULL AND "facebookPageId" IS NULL)
    OR
    ("platform" = 'FACEBOOK' AND "instagramAccountId" IS NULL AND "facebookPageId" IS NOT NULL)
);

ALTER TABLE "DmLog" ADD CONSTRAINT "DmLog_platform_account_check"
CHECK (
    ("platform" = 'INSTAGRAM' AND "instagramAccountId" IS NOT NULL AND "facebookPageId" IS NULL)
    OR
    ("platform" = 'FACEBOOK' AND "instagramAccountId" IS NULL AND "facebookPageId" IS NOT NULL)
);

ALTER TABLE "ProcessedComment" ADD CONSTRAINT "ProcessedComment_platform_account_check"
CHECK (
    ("platform" = 'INSTAGRAM' AND "instagramAccountId" IS NOT NULL AND "facebookPageId" IS NULL)
    OR
    ("platform" = 'FACEBOOK' AND "instagramAccountId" IS NULL AND "facebookPageId" IS NOT NULL)
);

ALTER TABLE "LinkClick" ADD CONSTRAINT "LinkClick_platform_account_check"
CHECK (
    ("platform" = 'INSTAGRAM' AND "instagramAccountId" IS NOT NULL AND "facebookPageId" IS NULL)
    OR
    ("platform" = 'FACEBOOK' AND "instagramAccountId" IS NULL AND "facebookPageId" IS NOT NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "FacebookPage_pageId_key" ON "FacebookPage"("pageId");
CREATE INDEX "FacebookPage_workspaceId_idx" ON "FacebookPage"("workspaceId");
CREATE INDEX "Automation_facebookPageId_idx" ON "Automation"("facebookPageId");
CREATE INDEX "DmLog_facebookPageId_idx" ON "DmLog"("facebookPageId");
CREATE INDEX "ProcessedComment_facebookPageId_idx" ON "ProcessedComment"("facebookPageId");
CREATE INDEX "LinkClick_facebookPageId_idx" ON "LinkClick"("facebookPageId");
CREATE INDEX "LinkClick_dmLogId_idx" ON "LinkClick"("dmLogId");

-- AddForeignKey
ALTER TABLE "FacebookPage" ADD CONSTRAINT "FacebookPage_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Automation" ADD CONSTRAINT "Automation_facebookPageId_fkey"
FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DmLog" ADD CONSTRAINT "DmLog_facebookPageId_fkey"
FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcessedComment" ADD CONSTRAINT "ProcessedComment_instagramAccountId_fkey"
FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcessedComment" ADD CONSTRAINT "ProcessedComment_facebookPageId_fkey"
FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LinkClick" ADD CONSTRAINT "LinkClick_facebookPageId_fkey"
FOREIGN KEY ("facebookPageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LinkClick" ADD CONSTRAINT "LinkClick_dmLogId_fkey"
FOREIGN KEY ("dmLogId") REFERENCES "DmLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
