import { describe, expect, it, vi } from "vitest";
import {
  processFacebookFollowUp,
  type FacebookFollowUpDeps,
} from "../lib/queue/facebook-follow-up";

const sentAt = new Date("2026-08-16T19:00:00.000Z");
const interactionAt = new Date("2026-08-16T19:59:00.000Z");

function createDeps(
  overrides: Partial<FacebookFollowUpDeps> = {}
): FacebookFollowUpDeps {
  return {
    findLog: vi.fn().mockResolvedValue({
      id: "log-1",
      status: "SENT",
      dmSentAt: sentAt,
      facebookInteractionAt: interactionAt,
      followUpSentAt: null,
      facebookRecipientId: "psid-1",
      automation: {
        id: "automation-1",
        isActive: true,
        followUpEnabled: true,
        followUpMessage:
          "Hey! Did you get a chance to look at the journal? I’d love to hear what you think 💛",
      },
      facebookPage: {
        pageId: "page-1",
        accessToken: "encrypted-page-token",
      },
    }),
    updateLog: vi.fn().mockResolvedValue({ id: "log-1" }),
    decryptToken: vi.fn().mockReturnValue("page-token"),
    sendDirectMessage: vi.fn().mockResolvedValue({ message_id: "message-2" }),
    now: () => new Date("2026-08-16T20:00:00.000Z"),
    ...overrides,
  };
}

describe("Facebook click follow-up", () => {
  it("sends the neutral message once inside the Messenger window", async () => {
    const deps = createDeps();

    await processFacebookFollowUp("log-1", deps);

    expect(deps.sendDirectMessage).toHaveBeenCalledWith(
      "page-token",
      "page-1",
      "psid-1",
      "Hey! Did you get a chance to look at the journal? I’d love to hear what you think 💛"
    );
    expect(deps.updateLog).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({
        followUpSentAt: new Date("2026-08-16T20:00:00.000Z"),
        followUpError: null,
      })
    );
  });

  it("does not send again after a successful follow-up", async () => {
    const deps = createDeps({
      findLog: vi.fn().mockResolvedValue({
        id: "log-1",
        status: "SENT",
        dmSentAt: sentAt,
        facebookInteractionAt: interactionAt,
        followUpSentAt: new Date("2026-08-16T19:05:00.000Z"),
        facebookRecipientId: "psid-1",
        automation: {
          id: "automation-1",
          isActive: true,
          followUpEnabled: true,
          followUpMessage: "Hey!",
        },
        facebookPage: {
          pageId: "page-1",
          accessToken: "encrypted-page-token",
        },
      }),
    });

    await processFacebookFollowUp("log-1", deps);

    expect(deps.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("records a closed policy window without sending", async () => {
    const deps = createDeps({
      now: () => new Date("2026-08-17T19:59:00.001Z"),
    });

    await processFacebookFollowUp("log-1", deps);

    expect(deps.sendDirectMessage).not.toHaveBeenCalled();
    expect(deps.updateLog).toHaveBeenCalledWith("log-1", {
      followUpError: "Messenger 24-hour response window expired",
    });
  });

  it("records a permanent Meta refusal without retrying", async () => {
    const deps = createDeps({
      sendDirectMessage: vi
        .fn()
        .mockRejectedValue(new Error("Message sent outside allowed window")),
    });

    await expect(processFacebookFollowUp("log-1", deps)).resolves.toBeUndefined();
    expect(deps.updateLog).toHaveBeenCalledWith("log-1", {
      followUpError: "Message sent outside allowed window",
    });
  });

  it("retries transient network failures", async () => {
    const deps = createDeps({
      sendDirectMessage: vi
        .fn()
        .mockRejectedValue(new TypeError("network unavailable")),
    });

    await expect(processFacebookFollowUp("log-1", deps)).rejects.toThrow(
      "network unavailable"
    );
  });
});
