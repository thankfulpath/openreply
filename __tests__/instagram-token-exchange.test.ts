import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLongLivedToken,
  refreshLongLivedToken,
} from "../lib/meta/client";

const fetchMock = vi.fn<typeof fetch>();

describe("Instagram long-lived token exchange", () => {
  beforeEach(() => {
    vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the unversioned Instagram token exchange endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "long-token", expires_in: 5_184_000 }),
        { status: 200 }
      )
    );

    const result = await getLongLivedToken("short-token");

    expect(result).toEqual({ accessToken: "long-token", expiresIn: 5_184_000 });
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe(
      "https://graph.instagram.com/access_token"
    );
    expect(parsed.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(parsed.searchParams.get("client_secret")).toBe("app-secret");
    expect(parsed.searchParams.get("access_token")).toBe("short-token");
  });

  it("refreshes a long-lived token at Instagram's unversioned endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "renewed-token", expires_in: 5_184_000 }),
        { status: 200 }
      )
    );

    const result = await refreshLongLivedToken("current-token");

    expect(result).toEqual({ accessToken: "renewed-token", expiresIn: 5_184_000 });
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe(
      "https://graph.instagram.com/refresh_access_token"
    );
    expect(parsed.searchParams.get("grant_type")).toBe("ig_refresh_token");
    expect(parsed.searchParams.get("access_token")).toBe("current-token");
  });
});
