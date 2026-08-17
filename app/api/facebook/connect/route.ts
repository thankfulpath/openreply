import { NextResponse } from "next/server";
import { getBaseUrl, getMissingFacebookOAuthEnv } from "@/lib/env";
import { getFacebookAuthorizationUrl } from "@/lib/meta/facebook-oauth";
import { createOAuthState } from "@/lib/meta/oauth";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  const baseUrl = getBaseUrl();

  if (!context) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  const missingEnv = getMissingFacebookOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  const redirectUri = `${baseUrl}/api/facebook/callback`;
  const state = createOAuthState(context.workspaceId);
  return NextResponse.redirect(getFacebookAuthorizationUrl(redirectUri, state));
}
