import { describe, expect, it } from "vitest";
import { FACEBOOK_JOURNAL_CAMPAIGN } from "@/lib/facebook/journal-campaign";

describe("Facebook journal campaign defaults", () => {
  it("matches the approved neutral comment-to-Messenger flow", () => {
    expect(FACEBOOK_JOURNAL_CAMPAIGN).toMatchObject({
      name: "Journal · Facebook",
      keywords: ["JOURNAL"],
      matchAnyPost: true,
      wholeWordMatch: true,
      dmMessage:
        "Here you go 💛 You can see The Original Gratitude Journal on Amazon here: {link}",
      openingDmEnabled: true,
      openingDmMessage:
        "Hey! Thanks for your interest in our gratitude journal 💛 Tap below and I’ll send you the Amazon link.",
      openingDmButtonLabel: "Send me the link",
      publicReplyEnabled: true,
      publicReplyMessage: "Sent it 💛 Check Messenger.",
      followUpEnabled: true,
      followUpDelayMinutes: 5,
      followUpMessage:
        "Hey! Did you get a chance to look at the journal? I’d love to hear what you think 💛",
      destinationUrl: "https://taap.it/Journal",
      linkButtonLabel: "View on Amazon",
      isActive: false,
    });

    expect(JSON.stringify(FACEBOOK_JOURNAL_CAMPAIGN)).not.toContain(
      "{username}"
    );
  });
});
