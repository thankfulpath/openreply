import { describe, expect, it, vi } from "vitest";
import {
  processFacebookComment,
  type FacebookAutomation,
  type FacebookCommentProcessorDeps,
} from "../lib/queue/facebook-comment";
import { PermissionError } from "../lib/meta/client";

const automation: FacebookAutomation = {
  id: "automation-1",
  workspaceId: "workspace-1",
  name: "Journal",
  keywords: ["JOURNAL"],
  matchAnyWord: false,
  wholeWordMatch: true,
  dmMessage: "Here you go 💛 You can see the journal on Amazon here: {link}",
  openingDmEnabled: true,
  openingDmMessage:
    "Hey! Thanks for your interest in our gratitude journal 💛 Tap below and I’ll send you the Amazon link.",
  openingDmButtonLabel: "View on Amazon",
  publicReplyEnabled: true,
  publicReplyMessage: "Sent it 💛 Check Messenger.",
  publicReplyMessages: [],
  facebookPageId: "facebook-page-row-1",
  facebookPage: {
    id: "facebook-page-row-1",
    pageId: "page-1",
    accessToken: "encrypted-page-token",
  },
  trackedLinks: [
    {
      slug: "journal-slug",
      label: "View on Amazon",
      destinationUrl: "https://taap.it/Journal",
    },
  ],
};

function createDeps(
  overrides: Partial<FacebookCommentProcessorDeps> = {}
): FacebookCommentProcessorDeps {
  return {
    findAutomations: vi.fn().mockResolvedValue([automation]),
    findLog: vi.fn().mockResolvedValue(null),
    findOtherSentLog: vi.fn().mockResolvedValue(null),
    upsertLog: vi.fn().mockResolvedValue({ id: "log-1" }),
    updateLog: vi.fn().mockResolvedValue({ id: "log-1" }),
    decryptToken: vi.fn().mockReturnValue("page-token"),
    reserveWorkspaceDMSend: vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      remaining: 100,
      limit: 2_000_000_000,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
    }),
    releaseWorkspaceDMReservation: vi.fn().mockResolvedValue({ count: 1 }),
    reserveDMSlot: vi.fn().mockResolvedValue({
      allowed: true,
      currentCount: 1,
      remainingDMs: 749,
      shouldRequeue: false,
      requeueDelayMs: 0,
      shouldSkip: false,
      reserved: true,
    }),
    sendPublicReply: vi.fn().mockResolvedValue({ id: "public-reply-1" }),
    sendPrivateReply: vi.fn().mockResolvedValue({
      message_id: "message-1",
      recipient_id: "psid-1",
    }),
    signRecipientReference: vi.fn().mockReturnValue("signed-reference"),
    now: () => new Date("2026-08-16T20:00:00.000Z"),
    ...overrides,
  };
}

const job = {
  platform: "FACEBOOK" as const,
  accountId: "page-1",
  facebookPageId: "page-1",
  commentId: "comment-1",
  commentText: "JOURNAL",
  commenterId: "person-1",
  commenterName: "Customer",
  mediaId: "post-1",
  source: "WEBHOOK" as const,
};

describe("Facebook comment worker", () => {
  it("sends one public reply and a qualifying Messenger quick reply", async () => {
    const deps = createDeps();

    await processFacebookComment(job, 0, deps);

    expect(deps.sendPublicReply).toHaveBeenCalledWith(
      "page-token",
      "comment-1",
      "Sent it 💛 Check Messenger."
    );
    expect(deps.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(deps.sendPrivateReply).toHaveBeenCalledWith(
      "page-token",
      "page-1",
      "comment-1",
      "Hey! Thanks for your interest in our gratitude journal 💛 Tap below and I’ll send you the Amazon link.",
      "View on Amazon",
      "facebook_reveal:signed-reference"
    );
    expect(deps.updateLog).toHaveBeenCalledWith(
      "automation-1",
      "comment-1",
      expect.objectContaining({
        status: "SENT",
        facebookRecipientId: "psid-1",
        errorMessage: null,
      })
    );
  });

  it("does not send the private reply again after a successful log", async () => {
    const deps = createDeps({
      findLog: vi.fn().mockResolvedValue({
        id: "log-1",
        status: "SENT",
        publicReplySentAt: new Date("2026-08-16T19:00:00.000Z"),
      }),
    });

    await processFacebookComment(job, 0, deps);

    expect(deps.sendPublicReply).not.toHaveBeenCalled();
    expect(deps.sendPrivateReply).not.toHaveBeenCalled();
  });

  it("releases reserved usage and records the Meta failure", async () => {
    const metaError = new Error("Missing pages_messaging permission");
    const deps = createDeps({
      sendPrivateReply: vi.fn().mockRejectedValue(metaError),
    });

    await expect(processFacebookComment(job, 0, deps)).rejects.toThrow(
      "Missing pages_messaging permission"
    );

    expect(deps.releaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace-1",
      new Date("2026-08-01T00:00:00.000Z")
    );
    expect(deps.updateLog).toHaveBeenCalledWith(
      "automation-1",
      "comment-1",
      expect.objectContaining({
        status: "FAILED",
        attempts: 1,
        errorMessage: "Missing pages_messaging permission",
      })
    );
  });

  it("does not retry permanent permission failures", async () => {
    const deps = createDeps({
      sendPrivateReply: vi
        .fn()
        .mockRejectedValue(new PermissionError("Missing pages_messaging")),
    });

    await expect(processFacebookComment(job, 0, deps)).resolves.toBeUndefined();
    expect(deps.updateLog).toHaveBeenCalledWith(
      "automation-1",
      "comment-1",
      expect.objectContaining({ status: "FAILED" })
    );
  });

  it("retries a transient public reply failure after the private reply succeeds", async () => {
    const deps = createDeps({
      sendPublicReply: vi.fn().mockRejectedValue(new TypeError("network down")),
    });

    await expect(processFacebookComment(job, 0, deps)).rejects.toThrow(
      "network down"
    );
    expect(deps.sendPrivateReply).toHaveBeenCalledTimes(1);
  });
});
