import { prisma } from "@/lib/db/client";
import {
  getRecentFacebookPagePosts,
  getRecentFacebookPostComments,
  type FacebookPageComment,
  type FacebookPagePost,
} from "@/lib/meta/facebook-client";
import { MetaApiError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getDMQueue, type ProcessCommentJob } from "@/lib/queue/client";
import { matchKeywords } from "@/lib/utils/keyword-matcher";

const LOOKBACK_HOURS = Number(
  process.env.FACEBOOK_COMMENT_POLL_LOOKBACK_HOURS ?? 72
);
const MAX_NEW_PER_SWEEP = Number(
  process.env.FACEBOOK_COMMENT_POLL_MAX_PER_SWEEP ?? 30
);
const RECENT_POST_LIMIT = 10;

interface FacebookPollingAutomation {
  id: string;
  name: string;
  workspaceId: string;
  postId: string | null;
  matchAnyPost: boolean;
  matchAnyWord: boolean;
  keywords: string[];
  wholeWordMatch: boolean;
  publicReplyEnabled: boolean;
  facebookPage: {
    id: string;
    pageId: string;
    accessToken: string;
  };
}

interface FacebookSweepStat {
  campaign: string;
  keywords: string;
  matched: number;
  alreadyHandled: number;
  enqueued: number;
  errors: string[];
}

export interface FacebookCommentReconcilerDeps {
  findAutomations(): Promise<FacebookPollingAutomation[]>;
  decryptToken(value: string): string;
  getRecentPosts(
    accessToken: string,
    pageId: string,
    limit: number
  ): Promise<FacebookPagePost[]>;
  getRecentComments(
    accessToken: string,
    postId: string
  ): Promise<FacebookPageComment[]>;
  findHandledCommentIds(
    automationId: string,
    commentIds: string[],
    publicReplyEnabled: boolean
  ): Promise<string[]>;
  queueComment(job: ProcessCommentJob): Promise<unknown>;
  recordSweep(
    workspaceId: string,
    stat: FacebookSweepStat
  ): Promise<unknown>;
  now(): Date;
}

const productionDeps: FacebookCommentReconcilerDeps = {
  async findAutomations() {
    const automations = await prisma.automation.findMany({
      where: {
        isActive: true,
        platform: "FACEBOOK",
        facebookPageId: { not: null },
        facebookPage: { isConnected: true },
      },
      select: {
        id: true,
        name: true,
        workspaceId: true,
        postId: true,
        matchAnyPost: true,
        matchAnyWord: true,
        keywords: true,
        wholeWordMatch: true,
        publicReplyEnabled: true,
        facebookPage: {
          select: {
            id: true,
            pageId: true,
            accessToken: true,
          },
        },
      },
    });

    return automations.flatMap((automation) =>
      automation.facebookPage
        ? [
            {
              ...automation,
              facebookPage: automation.facebookPage,
            },
          ]
        : []
    );
  },
  decryptToken,
  getRecentPosts: getRecentFacebookPagePosts,
  getRecentComments: getRecentFacebookPostComments,
  async findHandledCommentIds(
    automationId,
    commentIds,
    publicReplyEnabled
  ) {
    if (commentIds.length === 0) return [];
    const logs = await prisma.dmLog.findMany({
      where: {
        automationId,
        commentId: { in: commentIds },
        ...(publicReplyEnabled
          ? { publicReplySentAt: { not: null } }
          : { status: "SENT" }),
      },
      select: { commentId: true },
    });
    return logs.map((log) => log.commentId);
  },
  queueComment(job) {
    return getDMQueue().add("process-comment", job);
  },
  recordSweep(workspaceId, stat) {
    if (stat.enqueued === 0 && stat.errors.length === 0) {
      return Promise.resolve();
    }
    return prisma.operationalEvent.create({
      data: {
        workspaceId,
        source: "SYSTEM",
        level: stat.errors.length > 0 ? "WARNING" : "INFO",
        message: `Facebook comment sweep "${stat.campaign}" [${stat.keywords}]: ${stat.enqueued} enqueued, ${stat.matched} matched, ${stat.alreadyHandled} already handled`,
        payload: { ...stat },
      },
    });
  },
  now: () => new Date(),
};

function errorMessage(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta ${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

export async function reconcileFacebookComments(
  deps: FacebookCommentReconcilerDeps = productionDeps
): Promise<void> {
  const automations = await deps.findAutomations();
  const sinceMs =
    deps.now().getTime() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const tokenCache = new Map<string, string | null>();

  for (const automation of automations) {
    const stat: FacebookSweepStat = {
      campaign: automation.name,
      keywords: automation.matchAnyWord
        ? "(any word)"
        : automation.keywords.join(","),
      matched: 0,
      alreadyHandled: 0,
      enqueued: 0,
      errors: [],
    };

    let accessToken = tokenCache.get(automation.facebookPage.id);
    if (accessToken === undefined) {
      try {
        accessToken = deps.decryptToken(automation.facebookPage.accessToken);
      } catch {
        accessToken = null;
      }
      tokenCache.set(automation.facebookPage.id, accessToken);
    }
    if (!accessToken) {
      stat.errors.push("Failed to decrypt Facebook Page access token");
      await deps.recordSweep(automation.workspaceId, stat);
      continue;
    }

    let postIds: string[] = [];
    if (automation.postId) {
      postIds = [automation.postId];
    } else if (automation.matchAnyPost) {
      try {
        const posts = await deps.getRecentPosts(
          accessToken,
          automation.facebookPage.pageId,
          RECENT_POST_LIMIT
        );
        postIds = posts.map((post) => post.id);
      } catch (error) {
        stat.errors.push(`Post list: ${errorMessage(error)}`);
      }
    }

    const candidates: Array<{
      comment: FacebookPageComment;
      postId: string;
    }> = [];
    for (const postId of postIds) {
      try {
        const comments = await deps.getRecentComments(accessToken, postId);
        for (const comment of comments) {
          const commenterId = comment.from?.id;
          const createdAt = Date.parse(comment.created_time);
          if (
            !commenterId ||
            commenterId === automation.facebookPage.pageId ||
            !Number.isFinite(createdAt) ||
            createdAt < sinceMs
          ) {
            continue;
          }
          const matched = automation.matchAnyWord
            ? true
            : matchKeywords(
                comment.message ?? "",
                automation.keywords,
                automation.wholeWordMatch
              ).matched;
          if (!matched) continue;
          stat.matched += 1;
          candidates.push({ comment, postId });
        }
      } catch (error) {
        stat.errors.push(`Comments ${postId}: ${errorMessage(error)}`);
      }
    }

    const handledIds = await deps.findHandledCommentIds(
      automation.id,
      candidates.map(({ comment }) => comment.id),
      automation.publicReplyEnabled
    );
    const handled = new Set(handledIds);
    stat.alreadyHandled = candidates.filter(({ comment }) =>
      handled.has(comment.id)
    ).length;

    const fresh = candidates
      .filter(({ comment }) => !handled.has(comment.id))
      .sort(
        (a, b) =>
          Date.parse(a.comment.created_time) -
          Date.parse(b.comment.created_time)
      )
      .slice(0, MAX_NEW_PER_SWEEP);

    for (const { comment, postId } of fresh) {
      try {
        await deps.queueComment({
          platform: "FACEBOOK",
          accountId: automation.facebookPage.pageId,
          facebookPageId: automation.facebookPage.pageId,
          commentId: comment.id,
          commentText: comment.message ?? "",
          commenterId: comment.from!.id!,
          commenterName: comment.from?.name,
          mediaId: postId,
          source: "POLLING",
        });
        stat.enqueued += 1;
      } catch (error) {
        stat.errors.push(`Queue ${comment.id}: ${errorMessage(error)}`);
      }
    }

    await deps.recordSweep(automation.workspaceId, stat);
  }
}
