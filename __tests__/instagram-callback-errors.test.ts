import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  member: vi.fn(),
  event: vi.fn(),
  exchangeCode: vi.fn(),
  exchangeLongLived: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    workspaceMember: { findFirst: mocks.member },
    operationalEvent: { create: mocks.event },
  },
}));
vi.mock("@/lib/env", () => ({
  getBaseUrl: () => "https://openreply.example",
}));
vi.mock("@/lib/instagram-accounts", () => ({
  canConnectInstagramAccount: vi.fn(),
}));
vi.mock("@/lib/meta/client", () => ({
  getLongLivedToken: mocks.exchangeLongLived,
  getUserInfo: vi.fn(),
  subscribeInstagramAccountToWebhooks: vi.fn(),
}));
vi.mock("@/lib/meta/oauth", () => ({
  encryptToken: vi.fn(),
  exchangeCodeForToken: mocks.exchangeCode,
  verifyOAuthState: () => ({ workspaceId: "workspace-1", ts: Date.now() }),
}));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: () => true,
}));

import { GET } from "../app/api/instagram/callback/route";

describe("Instagram OAuth callback failure reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.member.mockResolvedValue({ role: "OWNER" });
    mocks.event.mockResolvedValue({ id: "event-1" });
    mocks.exchangeCode.mockResolvedValue({
      accessToken: "short-lived-token",
      userId: "instagram-1",
    });
  });

  it("identifies a long-lived token exchange failure without exposing the token", async () => {
    mocks.exchangeLongLived.mockRejectedValue(
      new Error("Unsupported request - method type: get")
    );

    const response = await GET(
      new NextRequest(
        "https://openreply.example/api/instagram/callback?code=code-1&state=signed"
      )
    );
    const redirect = new URL(response.headers.get("location")!);

    expect(redirect.searchParams.get("reason")).toBe(
      "long-lived token exchange: Unsupported request - method type: get"
    );
    expect(mocks.event).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: {
          stage: "long-lived token exchange",
          reason: "Unsupported request - method type: get",
        },
      }),
    });
    expect(JSON.stringify(mocks.event.mock.calls)).not.toContain(
      "short-lived-token"
    );
  });
});
