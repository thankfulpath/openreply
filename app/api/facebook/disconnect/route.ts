import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can disconnect pages" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const facebookPageId =
    typeof body.facebookPageId === "string" ? body.facebookPageId : null;
  if (!facebookPageId) {
    return NextResponse.json(
      { success: false, error: "Facebook Page is required" },
      { status: 400 }
    );
  }

  const page = await prisma.facebookPage.findFirst({
    where: { id: facebookPageId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!page) {
    return NextResponse.json(
      { success: false, error: "Facebook Page not found" },
      { status: 404 }
    );
  }

  await prisma.$transaction([
    prisma.automation.updateMany({
      where: {
        workspaceId: context.workspaceId,
        facebookPageId: page.id,
      },
      data: { isActive: false },
    }),
    prisma.facebookPage.update({
      where: { id: page.id },
      data: {
        accessToken: encryptToken("disconnected"),
        tokenExpiresAt: null,
        isConnected: false,
        webhookSubscribed: false,
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}
