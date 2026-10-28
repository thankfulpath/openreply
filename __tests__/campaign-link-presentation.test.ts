import { describe, expect, it } from "vitest";
import { getCampaignLinkPresentation } from "@/lib/campaign-links";

const link = {
  destinationUrl: "https://taap.it/Journal",
  trackedUrl: "https://openreply-pied.vercel.app/r/Pf1wSHLyig",
};

describe("campaign link presentation", () => {
  it("shows the actual direct button URL for Warmheart Facebook", () => {
    expect(
      getCampaignLinkPresentation({
        campaignId: "cmvpnhgmq000108l60fp45fxy",
        platform: "FACEBOOK",
        link,
      })
    ).toEqual({ url: "https://taap.it/Journal", redirectsTo: null });
  });

  it("retains tracked URLs for other Facebook campaigns", () => {
    expect(
      getCampaignLinkPresentation({
        campaignId: "another-campaign",
        platform: "FACEBOOK",
        link,
      })
    ).toEqual({
      url: "https://openreply-pied.vercel.app/r/Pf1wSHLyig",
      redirectsTo: "https://taap.it/Journal",
    });
  });

  it("does not apply the Facebook exception to Instagram", () => {
    expect(
      getCampaignLinkPresentation({
        campaignId: "cmvpnhgmq000108l60fp45fxy",
        platform: "INSTAGRAM",
        link,
      }).url
    ).toBe("https://openreply-pied.vercel.app/r/Pf1wSHLyig");
  });
});
