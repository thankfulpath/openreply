export const FACEBOOK_JOURNAL_CAMPAIGN = {
  name: "Journal · Facebook",
  keywords: ["JOURNAL"],
  matchAnyPost: true,
  wholeWordMatch: true,
  dmMessage:
    "Hey! Thanks for your interest in our gratitude journal 💛 Here you go: {link}",
  publicReplyEnabled: true,
  publicReplyMessage: "Sent it 💛 Check Messenger.",
  followUpEnabled: true,
  followUpDelayMinutes: 5,
  followUpMessage:
    "Hey! Did you get a chance to look at the journal? I’d love to hear what you think 💛",
  destinationUrl: "https://taap.it/Journal",
  linkButtonLabel: "View on Amazon",
  isActive: false,
} as const;
