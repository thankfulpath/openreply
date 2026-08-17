import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    trackedLink: {
      findUnique: vi.fn(),
    },
    linkClick: {
      create: vi.fn(),
    },
    dmLog: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import { GET } from "../app/r/[slug]/route";
import { signRecipientReference } from "../lib/tracking/recipient-reference";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
});

describe("tracked link redirect route", () => {
  it("logs a workspace-isolated click and redirects to the destination", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: {
        platform: "INSTAGRAM",
        instagramAccountId: "instagram_account_123",
        facebookPageId: null,
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await GET(
      new Request("https://manychat-alternative.com/r/abc123", {
        headers: {
          "user-agent": "vitest",
          referer: "https://instagram.com/",
          "x-forwarded-for": "203.0.113.10",
        },
      }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/offer");
    expect(mockPrisma.trackedLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc123" },
      select: expect.any(Object),
    });
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_123",
        automationId: "automation_123",
        instagramAccountId: "instagram_account_123",
        trackedLinkId: "link_123",
        userAgent: "vitest",
        referrer: "https://instagram.com/",
      }),
    });
  });

  it("records a Facebook recipient click without opening the Messenger window", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://taap.it/Journal",
      automation: {
        platform: "FACEBOOK",
        instagramAccountId: null,
        facebookPageId: "facebook_page_row_123",
      },
    });
    mockPrisma.dmLog.findFirst.mockResolvedValue({
      id: "log_123",
      automationId: "automation_123",
      facebookPageId: "facebook_page_row_123",
      facebookRecipientId: "psid_123",
      automation: {
        followUpEnabled: true,
        followUpMessage: "Hey! Did you get a chance to look at the journal?",
        followUpDelayMinutes: 5,
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});
    const ref = signRecipientReference("log_123", "test-secret");

    const response = await GET(
      new Request(
        `https://openreply-pied.vercel.app/r/journal?ref=${encodeURIComponent(ref)}`
      ) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "journal" }) }
    );

    expect(response.headers.get("location")).toBe("https://taap.it/Journal");
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platform: "FACEBOOK",
        instagramAccountId: null,
        facebookPageId: "facebook_page_row_123",
        dmLogId: "log_123",
      }),
    });
  });

  it("redirects unknown slugs to the homepage without logging a click", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(null);

    const response = await GET(
      new Request("https://manychat-alternative.com/r/missing") as Parameters<
        typeof GET
      >[0],
      { params: Promise.resolve({ slug: "missing" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://manychat-alternative.com/");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
  });
});
