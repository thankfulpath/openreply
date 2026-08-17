import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  sendFacebookDirectMessageWithLinkButton,
  shouldRetryFacebookSend,
} from "@/lib/meta/facebook-client";
import { decryptToken } from "@/lib/meta/oauth";
import { FOLLOWUP_JOB_NAME, getDMQueue } from "@/lib/queue/client";
import {
  buildTrackedUrl,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";
import { signRecipientReference } from "@/lib/tracking/recipient-reference";

interface FacebookRevealRecord {
  id: string;
  status: string;
  commenterId: string;
  facebookRecipientId: string | null;
  linkDeliveredAt: Date | null;
  followUpQueuedAt: Date | null;
  followUpSentAt: Date | null;
  automation: {
    id: string;
    isActive: boolean;
    dmMessage: string;
    linkButtonLabel: string | null;
    followUpEnabled: boolean;
    followUpMessage: string | null;
    followUpDelayMinutes: number;
    trackedLinks: Array<{ slug: string; destinationUrl: string }>;
  };
  facebookPage: {
    pageId: string;
    accessToken: string;
    isConnected: boolean;
  } | null;
}

export interface FacebookRevealJob {
  dmLogId: string;
  pageId: string;
  userId: string;
  interactionTimestamp: number;
}

export interface FacebookRevealDeps {
  findLog(dmLogId: string): Promise<FacebookRevealRecord | null>;
  updateLog(dmLogId: string, data: Record<string, unknown>): Promise<unknown>;
  claimFollowUp(dmLogId: string, queuedAt: Date): Promise<boolean>;
  resetFollowUpClaim(dmLogId: string, queuedAt: Date): Promise<unknown>;
  decryptToken(value: string): string;
  signRecipientReference(dmLogId: string): string;
  sendLinkButton(
    accessToken: string,
    pageId: string,
    recipientId: string,
    text: string,
    buttonTitle: string,
    url: string
  ): Promise<unknown>;
  queueFollowUp(dmLogId: string, delayMs: number): Promise<unknown>;
  now(): Date;
}

const productionDeps: FacebookRevealDeps = {
  findLog(dmLogId) {
    return prisma.dmLog.findFirst({
      where: { id: dmLogId, platform: "FACEBOOK" },
      select: {
        id: true,
        status: true,
        commenterId: true,
        facebookRecipientId: true,
        linkDeliveredAt: true,
        followUpQueuedAt: true,
        followUpSentAt: true,
        automation: {
          select: {
            id: true,
            isActive: true,
            dmMessage: true,
            linkButtonLabel: true,
            followUpEnabled: true,
            followUpMessage: true,
            followUpDelayMinutes: true,
            trackedLinks: {
              select: { slug: true, destinationUrl: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        },
        facebookPage: {
          select: {
            pageId: true,
            accessToken: true,
            isConnected: true,
          },
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
  async claimFollowUp(dmLogId, queuedAt) {
    const result = await prisma.dmLog.updateMany({
      where: { id: dmLogId, followUpQueuedAt: null, followUpSentAt: null },
      data: { followUpQueuedAt: queuedAt, followUpError: null },
    });
    return result.count === 1;
  },
  resetFollowUpClaim(dmLogId, queuedAt) {
    return prisma.dmLog.updateMany({
      where: { id: dmLogId, followUpQueuedAt: queuedAt, followUpSentAt: null },
      data: { followUpQueuedAt: null },
    });
  },
  decryptToken,
  signRecipientReference,
  sendLinkButton: sendFacebookDirectMessageWithLinkButton,
  queueFollowUp(dmLogId, delayMs) {
    return getDMQueue().add(
      FOLLOWUP_JOB_NAME,
      {
        platform: "FACEBOOK",
        dmLogId,
        automationId: "facebook-reveal",
      },
      { delay: delayMs, jobId: `followup_facebook_${dmLogId}` }
    );
  },
  now: () => new Date(),
};

export async function processFacebookReveal(
  job: FacebookRevealJob,
  deps: FacebookRevealDeps = productionDeps
): Promise<void> {
  const log = await deps.findLog(job.dmLogId);
  if (
    !log ||
    log.status !== "SENT" ||
    !log.automation.isActive ||
    !log.facebookPage?.isConnected ||
    log.facebookPage.pageId !== job.pageId ||
    (log.facebookRecipientId !== job.userId && log.commenterId !== job.userId)
  ) {
    return;
  }

  const interactionAt = new Date(job.interactionTimestamp);
  const now = deps.now();
  if (
    !Number.isFinite(interactionAt.getTime()) ||
    now.getTime() - interactionAt.getTime() > 24 * 60 * 60 * 1000
  ) {
    await deps.updateLog(log.id, {
      linkDeliveryError: "Messenger interaction window expired before processing",
    });
    return;
  }

  await deps.updateLog(log.id, {
    facebookInteractionAt: interactionAt,
    facebookRecipientId: job.userId,
  });

  if (!log.linkDeliveredAt) {
    const primaryLink = log.automation.trackedLinks[0];
    if (!primaryLink) return;

    const trackedUrl = new URL(buildTrackedUrl(primaryLink.slug));
    trackedUrl.searchParams.set(
      "ref",
      deps.signRecipientReference(log.id)
    );

    try {
      await deps.sendLinkButton(
        deps.decryptToken(log.facebookPage.accessToken),
        log.facebookPage.pageId,
        job.userId,
        renderMessageWithoutLink({
          message: log.automation.dmMessage,
          commenterName: null,
        }),
        log.automation.linkButtonLabel?.trim() || "View on Amazon",
        trackedUrl.toString()
      );
      await deps.updateLog(log.id, {
        linkDeliveredAt: interactionAt,
        linkDeliveryError: null,
      });
    } catch (error) {
      await deps.updateLog(log.id, {
        linkDeliveryError:
          error instanceof Error ? error.message : "Unknown Meta error",
      });
      if (shouldRetryFacebookSend(error)) throw error;
      return;
    }
  }

  if (
    !log.followUpQueuedAt &&
    !log.followUpSentAt &&
    log.automation.followUpEnabled &&
    log.automation.followUpMessage?.trim()
  ) {
    const queuedAt = deps.now();
    if (await deps.claimFollowUp(log.id, queuedAt)) {
      try {
        await deps.queueFollowUp(
          log.id,
          Math.max(
            0,
            Math.max(0, log.automation.followUpDelayMinutes) * 60_000 -
              Math.max(0, deps.now().getTime() - interactionAt.getTime())
          )
        );
      } catch (error) {
        await deps.resetFollowUpClaim(log.id, queuedAt);
        throw error;
      }
    }
  }
}
