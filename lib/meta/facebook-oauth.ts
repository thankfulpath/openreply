import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import { handleResponse } from "@/lib/meta/client";

export const FACEBOOK_PAGE_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "pages_manage_metadata",
  "pages_messaging",
] as const;

function graphBase(): string {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

export function getFacebookAuthorizationUrl(
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: FACEBOOK_PAGE_SCOPES.join(","),
  });
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params.toString()}`;
}

export async function exchangeFacebookCode(
  code: string,
  redirectUri: string
): Promise<string> {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    redirect_uri: redirectUri,
    code,
  });
  const response = await fetch(`${graphBase()}/oauth/access_token?${params}`);
  const result = await handleResponse<{ access_token: string }>(response);
  return result.access_token;
}

export async function exchangeForLongLivedFacebookToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    fb_exchange_token: shortLivedToken,
  });
  const response = await fetch(`${graphBase()}/oauth/access_token?${params}`);
  const result = await handleResponse<{
    access_token: string;
    expires_in?: number;
  }>(response);
  return {
    accessToken: result.access_token,
    expiresIn: result.expires_in,
  };
}
