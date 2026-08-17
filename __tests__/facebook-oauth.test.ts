import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeFacebookCode,
  exchangeForLongLivedFacebookToken,
  getFacebookAuthorizationUrl,
} from "../lib/meta/facebook-oauth";

const fetchMock = vi.fn<typeof fetch>();

describe("Facebook OAuth", () => {
  beforeEach(() => {
    vi.stubEnv("FACEBOOK_APP_ID", "app-123");
    vi.stubEnv("FACEBOOK_APP_SECRET", "app-secret");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("requests only the Page permissions required by the campaign", () => {
    const url = new URL(
      getFacebookAuthorizationUrl(
        "https://openreply-pied.vercel.app/api/facebook/callback",
        "signed-state"
      )
    );

    expect(url.origin + url.pathname).toBe(
      "https://www.facebook.com/v25.0/dialog/oauth"
    );
    expect(url.searchParams.get("client_id")).toBe("app-123");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_engagement",
      "pages_manage_metadata",
      "pages_messaging",
    ]);
  });

  it("exchanges the callback code without placing the app secret in a header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "short-token" }), {
        status: 200,
      })
    );

    const token = await exchangeFacebookCode(
      "code-123",
      "https://openreply-pied.vercel.app/api/facebook/callback"
    );

    expect(token).toBe("short-token");
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v25.0/oauth/access_token");
    expect(parsed.searchParams.get("code")).toBe("code-123");
    expect(parsed.searchParams.get("client_secret")).toBe("app-secret");
  });

  it("exchanges the short token for a long-lived user token", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "long-token", expires_in: 5_184_000 }),
        { status: 200 }
      )
    );

    const result = await exchangeForLongLivedFacebookToken("short-token");

    expect(result).toEqual({ accessToken: "long-token", expiresIn: 5_184_000 });
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(parsed.searchParams.get("fb_exchange_token")).toBe("short-token");
  });
});
