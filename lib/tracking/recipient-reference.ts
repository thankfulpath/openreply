import { createHmac, timingSafeEqual } from "node:crypto";

function getSigningSecret(explicitSecret?: string): string {
  const secret = explicitSecret ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for recipient tracking");
  }
  return secret;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signRecipientReference(
  dmLogId: string,
  explicitSecret?: string
): string {
  const payload = Buffer.from(
    JSON.stringify({ dmLogId }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${signature(payload, getSigningSecret(explicitSecret))}`;
}

export function verifyRecipientReference(
  value: string | null | undefined,
  explicitSecret?: string
): { dmLogId: string } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, received] = parts;
  const expected = signature(payload, getSigningSecret(explicitSecret));

  try {
    if (
      !timingSafeEqual(
        Buffer.from(received, "utf8"),
        Buffer.from(expected, "utf8")
      )
    ) {
      return null;
    }
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { dmLogId?: unknown };
    return typeof parsed.dmLogId === "string" && parsed.dmLogId.length > 0
      ? { dmLogId: parsed.dmLogId }
      : null;
  } catch {
    return null;
  }
}
