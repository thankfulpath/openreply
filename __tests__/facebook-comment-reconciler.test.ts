import { describe, expect, it, vi } from "vitest";
import {
  reconcileFacebookComments,
  type FacebookCommentReconcilerDeps,
} from "@/lib/polling/facebook-comment-reconciler";

function createDeps(): FacebookCommentReconcilerDeps {
  return {
    findAutomations: vi.fn().mockResolvedValue([
      {
        id: "automation-1",
        name: "Journal · Facebook",
        workspaceId: "workspace-1",
        postId: null,
        matchAnyPost: true,
        matchAnyWord: false,
        keywords: ["JOURNAL"],
        wholeWordMatch: true,
        publicReplyEnabled: true,
        facebookPage: {
          id: "facebook-page-row-1",
          pageId: "page-1",
          accessToken: "encrypted-page-token",
        },
      },
    ]),
    decryptToken: vi.fn().mockReturnValue("page-token"),
    getRecentPosts: vi.fn().mockResolvedValue([
      { id: "page-1_post-1", created_time: "2026-08-17T12:24:51+0000" },
    ]),
    getRecentComments: vi.fn().mockResolvedValue([
      {
        id: "post-1_comment-1",
        message: "JOURNAL",
        created_time: "2026-08-17T12:26:49+0000",
        from: { id: "person-1", name: "Sergei Imanov" },
      },
    ]),
    findHandledCommentIds: vi.fn().mockResolvedValue([]),
    queueComment: vi.fn().mockResolvedValue(undefined),
    recordSweep: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-08-17T12:35:00.000Z"),
  };
}

describe("Facebook comment polling safety net", () => {
  it("enqueues a recent matching comment from a recent Page post", async () => {
    const deps = createDeps();

    await reconcileFacebookComments(deps);

    expect(deps.queueComment).toHaveBeenCalledWith({
      platform: "FACEBOOK",
      accountId: "page-1",
      facebookPageId: "page-1",
      commentId: "post-1_comment-1",
      commentText: "JOURNAL",
      commenterId: "person-1",
      commenterName: "Sergei Imanov",
      mediaId: "page-1_post-1",
      source: "POLLING",
    });
  });

  it("skips Page-authored, old, nonmatching, and already handled comments", async () => {
    const deps = createDeps();
    vi.mocked(deps.getRecentComments).mockResolvedValue([
      {
        id: "self",
        message: "JOURNAL",
        created_time: "2026-08-17T12:30:00+0000",
        from: { id: "page-1", name: "Thankful Path" },
      },
      {
        id: "old",
        message: "JOURNAL",
        created_time: "2026-08-10T12:30:00+0000",
        from: { id: "person-2", name: "Old Commenter" },
      },
      {
        id: "wrong-keyword",
        message: "YES",
        created_time: "2026-08-17T12:30:00+0000",
        from: { id: "person-3", name: "Other Commenter" },
      },
      {
        id: "handled",
        message: "JOURNAL",
        created_time: "2026-08-17T12:30:00+0000",
        from: { id: "person-4", name: "Handled Commenter" },
      },
    ]);
    vi.mocked(deps.findHandledCommentIds).mockResolvedValue(["handled"]);

    await reconcileFacebookComments(deps);

    expect(deps.queueComment).not.toHaveBeenCalled();
  });

  it("uses an explicitly selected post without listing the recent feed", async () => {
    const deps = createDeps();
    vi.mocked(deps.findAutomations).mockResolvedValue([
      {
        ...(await vi.mocked(deps.findAutomations)())[0],
        postId: "page-1_selected-post",
        matchAnyPost: false,
      },
    ]);

    await reconcileFacebookComments(deps);

    expect(deps.getRecentPosts).not.toHaveBeenCalled();
    expect(deps.getRecentComments).toHaveBeenCalledWith(
      "page-token",
      "page-1_selected-post"
    );
  });
});
