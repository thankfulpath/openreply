import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  sendFacebookDirectMessage,
  shouldRetryFacebookSend,
} from "@/lib/meta/facebook-client";
import { decryptToken } from "@/lib/meta/oauth";
import { renderMessageWithoutLink } from "@/lib/tracking/message";

interface FacebookFollowUpRecord {
  id: string;
  status: string;
  dmSentAt: Date | null;
  facebookInteractionAt: Date | null;
  followUpSentAt: Date | null;
  facebookRecipientId: string | null;
  automation: {
    id: string;
    isActive: boolean;
    followUpEnabled: boolean;
    followUpMessage: string | null;
  };
  facebookPage: {
    pageId: string;
    accessToken: string;
  } | null;
}

export interface FacebookFollowUpDeps {
  findLog(dmLogId: string): Promise<FacebookFollowUpRecord | null>;
  updateLog(dmLogId: string, data: Record<string, unknown>): Promise<unknown>;
  decryptToken(value: string): string;
  sendDirectMessage(
    accessToken: string,
    pageId: string,
    recipientId: string,
    message: string
  ): Promise<unknown>;
  now(): Date;
}

const productionDeps: FacebookFollowUpDeps = {
  findLog(dmLogId) {
    return prisma.dmLog.findFirst({
      where: {
        id: dmLogId,
        platform: "FACEBOOK",
        facebookPageId: { not: null },
      },
      select: {
        id: true,
        status: true,
        dmSentAt: true,
        facebookInteractionAt: true,
        followUpSentAt: true,
        facebookRecipientId: true,
        automation: {
          select: {
            id: true,
            isActive: true,
            followUpEnabled: true,
            followUpMessage: true,
          },
        },
        facebookPage: {
          select: { pageId: true, accessToken: true },
        },
      },
    });
  },
  updateLog(dmLogId, data) {
    return prisma.dmLog.update({
      where: { id: dmLogId },
      data: data as Prisma.DmLogUncheckedUpdateInput,
    });
  },
  decryptToken,
  sendDirectMessage: sendFacebookDirectMessage,
  now: () => new Date(),
};

const MESSENGER_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function processFacebookFollowUp(
  dmLogId: string,
  deps: FacebookFollowUpDeps = productionDeps
): Promise<void> {
  const log = await deps.findLog(dmLogId);
  if (
    !log ||
    log.status !== "SENT" ||
    log.followUpSentAt ||
    !log.dmSentAt ||
    !log.facebookInteractionAt ||
    !log.facebookRecipientId ||
    !log.facebookPage ||
    !log.automation.isActive ||
    !log.automation.followUpEnabled ||
    !log.automation.followUpMessage?.trim()
  ) {
    return;
  }

  if (
    deps.now().getTime() - log.facebookInteractionAt.getTime() >
    MESSENGER_RESPONSE_WINDOW_MS
  ) {
    await deps.updateLog(dmLogId, {
      followUpError: "Messenger 24-hour response window expired",
    });
    return;
  }

  let accessToken: string;
  try {
    accessToken = deps.decryptToken(log.facebookPage.accessToken);
  } catch (error) {
    await deps.updateLog(dmLogId, {
      followUpError: error instanceof Error ? error.message : "Token decryption failed",
    });
    return;
  }

  try {
    await deps.sendDirectMessage(
      accessToken,
      log.facebookPage.pageId,
      log.facebookRecipientId,
      renderMessageWithoutLink({
        message: log.automation.followUpMessage,
        commenterName: null,
      })
    );
    await deps.updateLog(dmLogId, {
      followUpSentAt: deps.now(),
      followUpError: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Meta error";
    await deps.updateLog(dmLogId, { followUpError: message });
    if (shouldRetryFacebookSend(error)) throw error;
  }
}
