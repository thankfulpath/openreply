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
              timestamp: 1786928400000,
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
        interactionTimestamp: 1786928400000,
      },
      jobId: "facebook_reveal_page-1_person-1_log-1_1786928400000",
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

  it("keeps workspace attribution when fan-out fails", async () => {
    const deps = createDeps();
    vi.mocked(deps.queueReveal).mockRejectedValue(new Error("Redis unavailable"));

    await expect(
      processFacebookWebhookIngest(
        {
          webhookEventId: "webhook-1",
          payload: {
            object: "page",
            entry: [
              {
                id: "page-1",
                messaging: [
                  {
                    timestamp: 1786928400000,
                    sender: { id: "person-1" },
                    recipient: { id: "page-1" },
                    message: {
                      mid: "mid-1",
                      quick_reply: { payload: "facebook_reveal:signed" },
                    },
                  },
                ],
              },
            ],
          },
        },
        deps
      )
    ).rejects.toThrow("Redis unavailable");

    expect(deps.updateEvent).toHaveBeenCalledWith("webhook-1", {
      workspaceId: "workspace-1",
      status: "FAILED",
      processedAt: expect.any(Date),
      errorMessage: "Redis unavailable",
    });
  });

  it("attributes a multi-Page failure to the Page that actually failed", async () => {
    const deps = createDeps();
    vi.mocked(deps.findConnectedPage).mockImplementation(async (pageId) => ({
      workspaceId: pageId === "page-1" ? "workspace-1" : "workspace-2",
    }));
    vi.mocked(deps.queueReveal).mockRejectedValue(new Error("Redis unavailable"));

    const promise = processFacebookWebhookIngest(
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
            {
              id: "page-2",
              messaging: [
                {
                  timestamp: 1786928460000,
                  sender: { id: "person-2" },
                  recipient: { id: "page-2" },
                  message: {
                    mid: "mid-2",
                    quick_reply: { payload: "facebook_reveal:signed" },
                  },
                },
              ],
            },
          ],
        },
      },
      deps
    );

    await expect(promise).rejects.toMatchObject({
      message: "Redis unavailable",
      facebookPageId: "page-2",
      workspaceId: "workspace-2",
    });
    expect(deps.updateEvent).toHaveBeenCalledWith("webhook-1", {
      workspaceId: "workspace-2",
      status: "FAILED",
      processedAt: expect.any(Date),
      errorMessage: "Redis unavailable",
    });
  });

  it("gives fresh taps distinct reveal job IDs", async () => {
    const deps = createDeps();
    const makePayload = (timestamp: number) => ({
      object: "page",
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              timestamp,
              sender: { id: "person-1" },
              recipient: { id: "page-1" },
              message: {
                mid: `mid-${timestamp}`,
                quick_reply: { payload: "facebook_reveal:signed" },
              },
            },
          ],
        },
      ],
    });

    await processFacebookWebhookIngest(
      { webhookEventId: "webhook-1", payload: makePayload(1_000) },
      deps
    );
    await processFacebookWebhookIngest(
      { webhookEventId: "webhook-2", payload: makePayload(2_000) },
      deps
    );

    expect(vi.mocked(deps.queueReveal).mock.calls.map(([job]) => job.jobId)).toEqual([
      "facebook_reveal_page-1_person-1_log-1_1000",
      "facebook_reveal_page-1_person-1_log-1_2000",
    ]);
  });
});
