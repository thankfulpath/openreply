import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { FACEBOOK_JOURNAL_CAMPAIGN } from "@/lib/facebook/journal-campaign";
import {
  getFacebookPageById,
  listManagedFacebookPages,
  subscribeFacebookPage,
} from "@/lib/meta/facebook-client";
import {
  exchangeFacebookCode,
  exchangeForLongLivedFacebookToken,
  chooseConfiguredFacebookPage,
} from "@/lib/meta/facebook-oauth";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import { canManageWorkspace } from "@/lib/workspace-access";

async function ensureJournalCampaign(
  workspaceId: string,
  facebookPageId: string
) {
  const defaults = FACEBOOK_JOURNAL_CAMPAIGN;
  const existing = await prisma.automation.findFirst({
    where: {
      workspaceId,
      platform: "FACEBOOK",
      facebookPageId,
      name: defaults.name,
    },
    include: {
      trackedLinks: { orderBy: { createdAt: "asc" }, take: 1 },
    },
  });

  const campaignData = {
    platform: "FACEBOOK" as const,
    instagramAccountId: null,
    facebookPageId,
    name: defaults.name,
    postId: null,
    postUrl: null,
    matchAnyPost: defaults.matchAnyPost,
    keywords: [...defaults.keywords],
    matchAnyWord: false,
    wholeWordMatch: defaults.wholeWordMatch,
    dmTriggerEnabled: false,
    dmMessage: defaults.dmMessage,
    openingDmEnabled: defaults.openingDmEnabled,
    openingDmMessage: defaults.openingDmMessage,
    openingDmButtonLabel: defaults.openingDmButtonLabel,
    linkButtonLabel: defaults.linkButtonLabel,
    requireFollow: false,
    followPromptMessage: null,
    followPromptButtonLabel: null,
    followUpEnabled: defaults.followUpEnabled,
    followUpMessage: defaults.followUpMessage,
    followUpDelayMinutes: defaults.followUpDelayMinutes,
    publicReplyEnabled: defaults.publicReplyEnabled,
    publicReplyMessage: defaults.publicReplyMessage,
    publicReplyMessages: [],
    isActive: defaults.isActive,
  };

  if (existing) {
    // Reconnecting refreshes credentials only. Never pause the campaign or
    // overwrite copy/keywords/link edits made after the initial seed.
    return;
  }

  await prisma.automation.create({
    data: {
      workspaceId,
      ...campaignData,
      trackedLinks: {
        create: {
          workspaceId,
          slug: generateTrackedLinkSlug(),
          label: defaults.linkButtonLabel,
          destinationUrl: defaults.destinationUrl,
        },
      },
    },
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: state.workspaceId, userId: session.user.id },
  });
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/facebook/callback`;
    const shortLivedToken = await exchangeFacebookCode(code, redirectUri);
    const longLived = await exchangeForLongLivedFacebookToken(shortLivedToken);
    const pages = await listManagedFacebookPages(longLived.accessToken);
    const configuredPageId = process.env.FACEBOOK_PAGE_ID?.trim();
    let page = chooseConfiguredFacebookPage(
      pages,
      configuredPageId
    );

    let directLookupReason: string | null = null;
    if (!page && configuredPageId) {
      try {
        page = await getFacebookPageById(
          longLived.accessToken,
          configuredPageId
        );
      } catch (directLookupError) {
        directLookupReason =
          directLookupError instanceof Error
            ? directLookupError.message
            : "Unknown direct Page lookup error";
      }
    }

    if (!page) {
      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "ERROR",
            workspaceId: state.workspaceId,
            message: "Configured Facebook Page was not returned by Meta",
            payload: {
              configuredPageId: configuredPageId ?? null,
              returnedPageIds: pages.map((candidate) => candidate.id),
              directLookupReason,
            },
          },
        })
        .catch(() => {});
      return NextResponse.redirect(`${baseUrl}/settings?facebook=page_not_found`);
    }

    const existingPage = await prisma.facebookPage.findUnique({
      where: { pageId: page.id },
      select: { workspaceId: true },
    });
    if (existingPage && existingPage.workspaceId !== state.workspaceId) {
      return NextResponse.redirect(
        `${baseUrl}/settings?facebook=already_connected`
      );
    }

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeFacebookPage(
        page.access_token,
        page.id
      );
      webhookSubscribed = Boolean(subscription.success);
    } catch (subscriptionError) {
      console.warn(
        "[Facebook Callback] Webhook subscription failed:",
        subscriptionError
      );
    }

    const tokenExpiresAt = longLived.expiresIn
      ? new Date(Date.now() + longLived.expiresIn * 1000)
      : null;
    const connectedPage = await prisma.facebookPage.upsert({
      where: { pageId: page.id },
      create: {
        workspaceId: state.workspaceId,
        pageId: page.id,
        name: page.name,
        accessToken: encryptToken(page.access_token),
        tokenExpiresAt,
        isConnected: true,
        webhookSubscribed,
      },
      update: {
        workspaceId: state.workspaceId,
        name: page.name,
        accessToken: encryptToken(page.access_token),
        tokenExpiresAt,
        isConnected: true,
        webhookSubscribed,
      },
    });

    await ensureJournalCampaign(state.workspaceId, connectedPage.id);
    return NextResponse.redirect(`${baseUrl}/settings?facebook=connected`);
  } catch (callbackError) {
    const reason =
      callbackError instanceof Error ? callbackError.message : "Unknown error";
    console.error("[Facebook Callback] Error:", callbackError);
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Facebook Page connection failed",
          payload: { reason },
        },
      })
      .catch(() => {});

    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=failed&reason=${encodeURIComponent(
        reason.slice(0, 200)
      )}`
    );
  }
}
