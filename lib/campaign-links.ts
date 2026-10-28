export interface CampaignLinkInput {
  campaignId: string;
  platform: "INSTAGRAM" | "FACEBOOK";
  link: { destinationUrl: string; trackedUrl?: string };
}

// Only this live Warmheart Facebook campaign sends the destination directly.
export function usesDirectDestinationLink(
  campaignId: string,
  platform: "INSTAGRAM" | "FACEBOOK"
) {
  return platform === "FACEBOOK" && campaignId === "cmvpnhgmq000108l60fp45fxy";
}

export function getCampaignLinkPresentation({ campaignId, platform, link }: CampaignLinkInput) {
  if (usesDirectDestinationLink(campaignId, platform)) {
    return { url: link.destinationUrl, redirectsTo: null };
  }
  return {
    url: link.trackedUrl ?? link.destinationUrl,
    redirectsTo: link.trackedUrl ? link.destinationUrl : null,
  };
}
