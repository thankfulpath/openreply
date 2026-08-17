import type { Prisma } from "@/app/generated/prisma/client";
import { releaseWorkspaceDMReservation, reserveWorkspaceDMSend } from "@/lib/billing/usage";
import { prisma } from "@/lib/db/client";
import {
  sendFacebookPrivateReply,
  sendFacebookPublicReply,
} from "@/lib/meta/facebook-client";
import { decryptToken } from "@/lib/meta/oauth";
import type { ProcessCommentJob } from "@/lib/queue/client";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
} from "@/lib/tracking/message";
import { signRecipientReference } from "@/lib/tracking/recipient-reference";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot, type RateLimitResult } from "@/lib/utils/rate-limiter";

export interface FacebookAutomation {
  id: string;
  workspaceId: string;
  name: string;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  dmMessage: string;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  facebookPageId: string;
  facebookPage: {
    id: string;
    pageId: string;
    accessToken: string;
  };
  trackedLinks: Array<{
    slug: string;
    label: string | null;
    destinationUrl: string;
  }>;
}

interface FacebookExistingLog {
  id: string;
  status: string;
  publicReplySentAt: Date | null;
}

interface WorkspaceReservation {
  allowed: boolean;
  reserved: boolean;
  remaining: number;
  limit: number;
  periodStart: Date | null;
}

type LogData = Record<string, unknown>;

export interface FacebookCommentProcessorDeps {
  findAutomations(pageId: string, mediaId: string): Promise<FacebookAutomation[]>;
  findLog(automationId: string, commentId: string): Promise<FacebookExistingLog | null>;
  findOtherSentLog(
    automationId: string,
    commentId: string
  ): Promise<{ automationName: string } | null>;
  upsertLog(
    automationId: string,
    commentId: string,
    create: LogData,
    update: LogData
  ): Promise<{ id: string }>;
  updateLog(
    automationId: string,
    commentId: string,
    data: LogData
  ): Promise<unknown>;
  decryptToken(value: string): string;
  reserveWorkspaceDMSend(workspaceId: string): Promise<WorkspaceReservation>;
  releaseWorkspaceDMReservation(
    workspaceId: string,
    periodStart: Date | null
  ): Promise<unknown>;
  reserveDMSlot(accountId: string, requeueAttempt: number): Promise<RateLimitResult>;
  sendPublicReply(
    accessToken: string,
    commentId: string,
    message: string
  ): Promise<unknown>;
  sendPrivateReply(
    accessToken: string,
    commentId: string,
    message: string
  ): Promise<{ message_id?: string; recipient_id?: string; id?: string }>;
  signRecipientReference(dmLogId: string): string;
  now(): Date;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const productionDeps: FacebookCommentProcessorDeps = {
  async findAutomations(pageId, mediaId) {
    const automations = await prisma.automation.findMany({
      where: {
        platform: "FACEBOOK",
        isActive: true,
        facebookPageId: { not: null },
        facebookPage: { pageId },
        OR: [{ postId: mediaId }, { matchAnyPost: true }],
      },
      include: {
        facebookPage: true,
        trackedLinks: {
          select: { slug: true, label: true, destinationUrl: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return automations.flatMap((automation) =>
      automation.facebookPage && automation.facebookPageId
        ? [
            {
              ...automation,
              facebookPageId: automation.facebookPageId,
              facebookPage: automation.facebookPage,
            },
          ]
        : []
    );
  },
  findLog(automationId, commentId) {
    return prisma.dmLog.findUnique({
      where: { automationId_commentId: { automationId, commentId } },
      select: {
        id: true,
        status: true,
        publicReplySentAt: true,
      },
    });
  },
  async findOtherSentLog(automationId, commentId) {
    const found = await prisma.dmLog.findFirst({
      where: {
        platform: "FACEBOOK",
        commentId,
        status: "SENT",
        automationId: { not: automationId },
      },
      select: { automation: { select: { name: true } } },
    });
    return found ? { automationName: found.automation.name } : null;
  },
  upsertLog(automationId, commentId, create, update) {
    return prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId, commentId } },
      create: create as Prisma.DmLogUncheckedCreateInput,
      update: update as Prisma.DmLogUncheckedUpdateInput,
    });
  },
  updateLog(automationId, commentId, data) {
    return prisma.dmLog.update({
      where: { automationId_commentId: { automationId, commentId } },
      data: data as Prisma.DmLogUncheckedUpdateInput,
    });
  },
  decryptToken,
  reserveWorkspaceDMSend,
  releaseWorkspaceDMReservation,
  reserveDMSlot,
  sendPublicReply: sendFacebookPublicReply,
  sendPrivateReply: sendFacebookPrivateReply,
  signRecipientReference,
  now: () => new Date(),
};

export async function processFacebookComment(
  job: ProcessCommentJob,
  attemptsMade = 0,
  deps: FacebookCommentProcessorDeps = productionDeps
): Promise<void> {
  const pageId = job.facebookPageId ?? job.accountId;
  if (job.platform !== "FACEBOOK" || !pageId) return;

  const automations = await deps.findAutomations(pageId, job.mediaId);
  for (const automation of automations) {
    const match = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          job.commentText,
          automation.keywords,
          automation.wholeWordMatch
        );
    if (!match.matched) continue;

    const existing = await deps.findLog(automation.id, job.commentId);
    const dmAlreadySent = existing?.status === "SENT";
    const publicAlreadySent = Boolean(existing?.publicReplySentAt);
    if (
      dmAlreadySent &&
      (publicAlreadySent || !automation.publicReplyEnabled)
    ) {
      continue;
    }

    const logBase: LogData = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      platform: "FACEBOOK",
      instagramAccountId: null,
      facebookPageId: automation.facebookPageId,
      commenterId: job.commenterId,
      commenterName: job.commenterName ?? null,
      commentText: job.commentText,
      commentId: job.commentId,
      matchedKeyword: match.matchedKeyword,
    };
    const log = await deps.upsertLog(
      automation.id,
      job.commentId,
      { ...logBase, status: "PENDING" },
      { matchedKeyword: match.matchedKeyword }
    );

    let accessToken: string;
    try {
      accessToken = deps.decryptToken(automation.facebookPage.accessToken);
    } catch (error) {
      await deps.updateLog(automation.id, job.commentId, {
        status: "FAILED",
        attempts: attemptsMade + 1,
        errorMessage: formatError(error),
      });
      continue;
    }

    const replyPool =
      automation.publicReplyMessages.length > 0
        ? automation.publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !publicAlreadySent
    ) {
      try {
        const message = replyPool[0];
        await deps.sendPublicReply(accessToken, job.commentId, message);
        await deps.updateLog(automation.id, job.commentId, {
          publicReplySentAt: deps.now(),
          publicReplyError: null,
        });
      } catch (error) {
        await deps.updateLog(automation.id, job.commentId, {
          publicReplyError: formatError(error),
        });
      }
    }

    if (dmAlreadySent) continue;

    const otherSent = await deps.findOtherSentLog(
      automation.id,
      job.commentId
    );
    if (otherSent) {
      await deps.updateLog(automation.id, job.commentId, {
        status: "SKIPPED_DEDUP",
        errorMessage: `Another campaign (${otherSent.automationName}) already sent the private reply for this Facebook comment`,
      });
      continue;
    }

    const usage = await deps.reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await deps.updateLog(automation.id, job.commentId, {
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      });
      continue;
    }

    const rate = await deps.reserveDMSlot(pageId, attemptsMade);
    if (!rate.allowed) {
      await deps.releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      const status = rate.shouldRequeue ? "FAILED" : "SKIPPED_RATE_LIMIT";
      await deps.updateLog(automation.id, job.commentId, {
        status,
        attempts: attemptsMade + 1,
        errorMessage: "Facebook Page private reply rate limit reached",
      });
      if (rate.shouldRequeue) {
        throw new Error("Facebook Page private reply rate limit reached");
      }
      continue;
    }

    try {
      const primaryLink = automation.trackedLinks[0];
      const recipientTrackedUrl = primaryLink
        ? (() => {
            const url = new URL(buildTrackedUrl(primaryLink.slug));
            url.searchParams.set(
              "ref",
              deps.signRecipientReference(log.id)
            );
            return url.toString();
          })()
        : undefined;
      const message = renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName: job.commenterName,
        trackedLinks: automation.trackedLinks,
        trackedUrl: recipientTrackedUrl,
      });
      const result = await deps.sendPrivateReply(
        accessToken,
        job.commentId,
        message
      );
      await deps.updateLog(automation.id, job.commentId, {
        status: "SENT",
        dmSentAt: deps.now(),
        facebookRecipientId: result.recipient_id ?? job.commenterId,
        errorMessage: null,
      });
    } catch (error) {
      await deps.releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await deps.updateLog(automation.id, job.commentId, {
        status: "FAILED",
        attempts: attemptsMade + 1,
        errorMessage: formatError(error),
      });
      throw error;
    }
  }
}
