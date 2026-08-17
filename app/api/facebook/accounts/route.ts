import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const facebookPages = await prisma.facebookPage.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      pageId: true,
      name: true,
      isConnected: true,
      webhookSubscribed: true,
      tokenExpiresAt: true,
    },
  });

  return NextResponse.json({ success: true, data: { facebookPages } });
}
