import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { verifyRecipientReference } from "@/lib/tracking/recipient-reference";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          platform: true,
          instagramAccountId: true,
          facebookPageId: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  const recipientReference = verifyRecipientReference(
    new URL(request.url).searchParams.get("ref")
  );
  const recipientLog = recipientReference
    ? await prisma.dmLog.findFirst({
        where: {
          id: recipientReference.dmLogId,
          workspaceId: trackedLink.workspaceId,
          automationId: trackedLink.automationId,
          platform: "FACEBOOK",
          status: "SENT",
          facebookPageId: trackedLink.automation.facebookPageId,
        },
        select: {
          id: true,
          automationId: true,
          facebookPageId: true,
          facebookRecipientId: true,
          automation: {
            select: { followUpEnabled: true },
          },
        },
      })
    : null;

  const isFacebook = trackedLink.automation.platform === "FACEBOOK";

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      platform: trackedLink.automation.platform,
      instagramAccountId: isFacebook
        ? null
        : trackedLink.automation.instagramAccountId,
      facebookPageId: isFacebook
        ? trackedLink.automation.facebookPageId
        : null,
      dmLogId: recipientLog?.id ?? null,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
}
