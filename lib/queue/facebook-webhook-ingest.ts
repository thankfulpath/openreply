import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  buildFacebookCommentJob,
  parseFacebookCommentEvents,
  parseFacebookPostbackEvents,
  type FacebookWebhookPayload,
} from "@/lib/meta/facebook-webhook";
import {
  FACEBOOK_REVEAL_JOB_NAME,
  getDMQueue,
} from "@/lib/queue/client";
import { verifyRecipientReference } from "@/lib/tracking/recipient-reference";

export interface FacebookWebhookIngestJob {
  webhookEventId: string;
  payload: FacebookWebhookPayload;
}

interface QueuedComment {
  name: "process-comment";
  data: ReturnType<typeof buildFacebookCommentJob>["data"];
  jobId: string;
}

interface QueuedReveal {
  data: {
    platform: "FACEBOOK";
    dmLogId: string;
    pageId: string;
    userId: string;
    interactionTimestamp: number;
  };
  jobId: string;
}

export interface FacebookWebhookIngestDeps {
  findConnectedPage(pageId: string): Promise<{ workspaceId: string } | null>;
  verifyReference(value: string): { dmLogId: string } | null;
  queueComment(job: QueuedComment): Promise<unknown>;
  queueReveal(job: QueuedReveal): Promise<unknown>;
  updateEvent(
    webhookEventId: string,
    data: Record<string, unknown>
  ): Promise<unknown>;
}

const productionDeps: FacebookWebhookIngestDeps = {
  findConnectedPage(pageId) {
    return prisma.facebookPage.findUnique({
      where: { pageId, isConnected: true },
      select: { workspaceId: true },
    });
  },
  verifyReference: verifyRecipientReference,
  queueComment(job) {
    return getDMQueue().add(job.name, job.data, { jobId: job.jobId });
  },
  queueReveal(job) {
    return getDMQueue().add(FACEBOOK_REVEAL_JOB_NAME, job.data, {
      jobId: job.jobId,
    });
  },
  updateEvent(webhookEventId, data) {
    return prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: data as Prisma.WebhookEventUncheckedUpdateInput,
    });
  },
};

export async function processFacebookWebhookIngest(
  job: FacebookWebhookIngestJob,
  deps: FacebookWebhookIngestDeps = productionDeps
): Promise<void> {
  const pageCache = new Map<string, { workspaceId: string } | null>();
  let workspaceId: string | null = null;
  const getPage = async (pageId: string) => {
    if (!pageCache.has(pageId)) {
      pageCache.set(pageId, await deps.findConnectedPage(pageId));
    }
    return pageCache.get(pageId) ?? null;
  };

  try {
    for (const event of parseFacebookCommentEvents(job.payload)) {
      const page = await getPage(event.pageId);
      if (!page) continue;
      workspaceId ??= page.workspaceId;
      await deps.queueComment(buildFacebookCommentJob(event));
    }

    for (const event of parseFacebookPostbackEvents(job.payload)) {
      if (!event.payload.startsWith("facebook_reveal:")) continue;
      const reference = deps.verifyReference(
        event.payload.slice("facebook_reveal:".length)
      );
      if (!reference) continue;
      const page = await getPage(event.pageId);
      if (!page) continue;
      workspaceId ??= page.workspaceId;

      await deps.queueReveal({
        data: {
          platform: "FACEBOOK",
          dmLogId: reference.dmLogId,
          pageId: event.pageId,
          userId: event.userId,
          interactionTimestamp: event.interactionTimestamp,
        },
        jobId: `facebook_reveal_${event.pageId}_${event.userId}_${reference.dmLogId}`,
      });
    }

    await deps.updateEvent(job.webhookEventId, {
      workspaceId,
      status: "PROCESSED",
      processedAt: new Date(),
      errorMessage: null,
    });
  } catch (error) {
    await deps.updateEvent(job.webhookEventId, {
      workspaceId,
      status: "FAILED",
      processedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
