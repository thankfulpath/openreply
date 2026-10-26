import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createOAuthState,
  decryptToken,
  encryptToken,
  exchangeCodeForToken,
  verifyOAuthState,
} from "../lib/meta/oauth";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv(
    "ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
});

describe("OAuth state and token encryption", () => {
  it("round-trips encrypted tokens", () => {
    const encrypted = encryptToken("long-lived-token");
    expect(encrypted).not.toBe("long-lived-token");
    expect(decryptToken(encrypted)).toBe("long-lived-token");
  });

  it("signs and verifies Instagram OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(state)?.workspaceId).toBe("workspace_123");
  });

  it("keeps the requested Facebook Page ID in signed OAuth state", () => {
    const state = createOAuthState("workspace_123", "1202857256253166");
    expect(verifyOAuthState(state)).toMatchObject({
      workspaceId: "workspace_123",
      facebookPageId: "1202857256253166",
    });
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });

  it("rejects tampered OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });
});

describe("Instagram authorization code exchange", () => {
  beforeEach(() => {
    vi.stubEnv("INSTAGRAM_APP_ID", "instagram-app-id");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "instagram-app-secret");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads Meta's documented data-array response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                access_token: "short-token",
                user_id: "123",
                permissions: "instagram_business_basic",
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    expect(await exchangeCodeForToken("code", "https://example.com/callback")).toEqual({
      accessToken: "short-token",
      userId: "123",
    });
  });

  it("continues to read flat responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "short-token", user_id: 123 }), {
          status: 200,
        })
      )
    );

    expect(await exchangeCodeForToken("code", "https://example.com/callback")).toEqual({
      accessToken: "short-token",
      userId: "123",
    });
  });

  it("rejects a response without a token instead of calling Graph with undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ user_id: "123" }] }), {
          status: 200,
        })
      )
    );

    await expect(
      exchangeCodeForToken("code", "https://example.com/callback")
    ).rejects.toThrow("Instagram token response missing access token or user ID");
  });
});
