import { describe, expect, it, vi } from "vitest";
import {
  processFacebookReveal,
  type FacebookRevealDeps,
} from "@/lib/queue/facebook-reveal";

const now = new Date("2026-08-17T01:00:00.000Z");

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    status: "SENT",
    commenterId: "psid-1",
    facebookRecipientId: "psid-1",
    linkDeliveredAt: null,
    followUpQueuedAt: null,
    followUpSentAt: null,
    automation: {
      id: "automation-1",
      isActive: true,
      dmMessage: "Here you go 💛 Journal on Amazon: {link}",
      linkButtonLabel: "View on Amazon",
      followUpEnabled: true,
      followUpMessage: "Hey! Did you get a chance to look at the journal?",
      followUpDelayMinutes: 5,
      trackedLinks: [
        { slug: "journal", destinationUrl: "https://taap.it/Journal" },
      ],
    },
    facebookPage: {
      pageId: "page-1",
      accessToken: "encrypted-token",
      isConnected: true,
    },
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<FacebookRevealDeps> = {}
): FacebookRevealDeps {
  return {
    findLog: vi.fn().mockResolvedValue(record()),
    updateLog: vi.fn().mockResolvedValue({ id: "log-1" }),
    claimFollowUp: vi.fn().mockResolvedValue(true),
    resetFollowUpClaim: vi.fn().mockResolvedValue(undefined),
    decryptToken: vi.fn().mockReturnValue("page-token"),
    signRecipientReference: vi.fn().mockReturnValue("signed-ref"),
    sendLinkButton: vi.fn().mockResolvedValue({ message_id: "message-2" }),
    queueFollowUp: vi.fn().mockResolvedValue(undefined),
    now: () => now,
    ...overrides,
  };
}

describe("Facebook View on Amazon reveal", () => {
  it("records the Messenger interaction, sends the tracked link, and schedules five minutes", async () => {
    const deps = createDeps();

    await processFacebookReveal(
      { dmLogId: "log-1", pageId: "page-1", userId: "psid-1" },
      deps
    );

    expect(deps.updateLog).toHaveBeenCalledWith("log-1", {
      facebookInteractionAt: now,
      facebookRecipientId: "psid-1",
    });
    expect(deps.sendLinkButton).toHaveBeenCalledWith(
      "page-token",
      "page-1",
      "psid-1",
      "Here you go 💛 Journal on Amazon:",
      "View on Amazon",
      expect.stringMatching(/\/r\/journal\?ref=signed-ref$/)
    );
    expect(deps.updateLog).toHaveBeenCalledWith("log-1", {
      linkDeliveredAt: now,
      linkDeliveryError: null,
    });
    expect(deps.queueFollowUp).toHaveBeenCalledWith("log-1", 300_000);
  });

  it("does not deliver the link twice", async () => {
    const deps = createDeps({
      findLog: vi.fn().mockResolvedValue(
        record({ linkDeliveredAt: now, followUpQueuedAt: now })
      ),
    });

    await processFacebookReveal(
      { dmLogId: "log-1", pageId: "page-1", userId: "psid-1" },
      deps
    );

    expect(deps.sendLinkButton).not.toHaveBeenCalled();
    expect(deps.queueFollowUp).not.toHaveBeenCalled();
  });
});
