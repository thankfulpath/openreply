"use client";

import { useSearchParams } from "next/navigation";

const messages: Record<
  string,
  { tone: string; title: string; detail: string }
> = {
  connected: {
    tone: "border-success/20 bg-success/10 text-success",
    title: "Facebook Page connected",
    detail:
      "The Journal campaign was created in paused mode. It can be activated after the live comment test passes.",
  },
  denied: {
    tone: "border-warning/20 bg-warning/10 text-warning",
    title: "Facebook connection cancelled",
    detail: "Start again and approve the requested Page permissions.",
  },
  invalid: {
    tone: "border-error/20 bg-error/10 text-error",
    title: "Facebook connection expired",
    detail: "Click Connect Facebook Page to start a fresh attempt.",
  },
  forbidden: {
    tone: "border-error/20 bg-error/10 text-error",
    title: "Not permitted",
    detail: "Only workspace owners and admins can connect a Facebook Page.",
  },
  page_not_found: {
    tone: "border-error/20 bg-error/10 text-error",
    title: "Thankful Path Page was not found",
    detail:
      "The Facebook profile used for authorization does not have full access to the configured Page.",
  },
  already_connected: {
    tone: "border-warning/20 bg-warning/10 text-warning",
    title: "Page already connected",
    detail: "That Facebook Page belongs to another OpenReply workspace.",
  },
};

export function FacebookConnectNotice() {
  const searchParams = useSearchParams();
  const status = searchParams.get("facebook");
  if (!status) return null;

  if (status === "misconfigured") {
    const missing = (searchParams.get("missing") ?? "")
      .split(",")
      .filter(Boolean);
    return (
      <Notice
        tone="border-error/20 bg-error/10 text-error"
        title="Facebook app not configured"
      >
        Set the missing environment variables: {missing.join(", ")}.
      </Notice>
    );
  }

  if (status === "failed") {
    return (
      <Notice
        tone="border-error/20 bg-error/10 text-error"
        title="Facebook connection failed"
      >
        {searchParams.get("reason") ??
          "Meta accepted the login but the Page connection could not be completed."}
      </Notice>
    );
  }

  const message = messages[status];
  if (!message) return null;
  return (
    <Notice tone={message.tone} title={message.title}>
      {message.detail}
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded border p-4 text-sm ${tone}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 break-words opacity-90">{children}</div>
    </div>
  );
}
