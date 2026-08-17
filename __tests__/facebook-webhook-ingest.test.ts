import { describe, expect, it, vi } from "vitest";
import {
  processFacebookWebhookIngest,
  type FacebookWebhookIngestDeps,
} from "@/lib/queue/facebook-webhook-ingest";

function createDeps(): FacebookWebhookIngestDeps {
  return {
    findConnectedPage: vi.fn().mockResolvedValue({ workspaceId: "workspace-1" }),
    verifyReference: vi.fn().mockReturnValue({ dmLogId: "log-1" }),
    queueComment: vi.fn().mockResolvedValue(undefined),
    queueReveal: vi.fn().mockResolvedValue(undefined),
    updateEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Facebook webhook ingestion worker", () => {
  it("fans out a comment and qualifying quick reply for a connected Page", async () => {
    const deps = createDeps();
    const payload = {
      object: "page",
      entry: [
        {
          id: "page-1",
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "comment-1",
                post_id: "post-1",
                sender_id: "person-1",
                message: "JOURNAL",
              },
            },
          ],
          messaging: [
            {
              sender: { id: "person-1" },
              recipient: { id: "page-1" },
              message: {
                mid: "mid-1",
                text: "View on Amazon",
                quick_reply: { payload: "facebook_reveal:signed" },
              },
            },
          ],
        },
      ],
    };

    await processFacebookWebhookIngest(
      { webhookEventId: "webhook-1", payload },
      deps
    );

    expect(deps.queueComment).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "comment_facebook_page-1_comment-1" })
    );
    expect(deps.queueReveal).toHaveBeenCalledWith({
      data: {
        platform: "FACEBOOK",
        dmLogId: "log-1",
        pageId: "page-1",
        userId: "person-1",
      },
      jobId: "facebook_reveal_page-1_person-1_log-1",
    });
    expect(deps.updateEvent).toHaveBeenCalledWith("webhook-1", {
      workspaceId: "workspace-1",
      status: "PROCESSED",
      processedAt: expect.any(Date),
      errorMessage: null,
    });
  });

  it("ignores a Page that has been disconnected", async () => {
    const deps = createDeps();
    vi.mocked(deps.findConnectedPage).mockResolvedValue(null);

    await processFacebookWebhookIngest(
      {
        webhookEventId: "webhook-1",
        payload: {
          object: "page",
          entry: [
            {
              id: "page-1",
              changes: [
                {
                  field: "feed",
                  value: {
                    item: "comment",
                    verb: "add",
                    comment_id: "comment-1",
                    post_id: "post-1",
                    sender_id: "person-1",
                    message: "JOURNAL",
                  },
                },
              ],
            },
          ],
        },
      },
      deps
    );

    expect(deps.queueComment).not.toHaveBeenCalled();
    expect(deps.queueReveal).not.toHaveBeenCalled();
  });
});
