import { getMetaGraphApiVersion } from "@/lib/env";
import { handleResponse } from "@/lib/meta/client";

function facebookGraphBase(): string {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function graphPost<T>(
  accessToken: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${facebookGraphBase()}${path}`, {
    method: "POST",
    headers: {
      ...bearerHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return handleResponse<T>(response);
}

export interface FacebookManagedPage {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
}

export async function listManagedFacebookPages(
  userAccessToken: string
): Promise<FacebookManagedPage[]> {
  const params = new URLSearchParams({
    fields: "id,name,access_token,tasks",
    limit: "100",
  });
  const response = await fetch(
    `${facebookGraphBase()}/me/accounts?${params.toString()}`,
    { headers: bearerHeaders(userAccessToken) }
  );
  const result = await handleResponse<{ data?: FacebookManagedPage[] }>(response);
  return result.data ?? [];
}

export async function subscribeFacebookPage(
  pageAccessToken: string,
  pageId: string
): Promise<{ success: boolean }> {
  const body = new URLSearchParams({
    subscribed_fields: [
      "feed",
      "messages",
      "messaging_postbacks",
      "message_reads",
    ].join(","),
  });
  const response = await fetch(
    `${facebookGraphBase()}/${pageId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        ...bearerHeaders(pageAccessToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  return handleResponse(response);
}

export async function sendFacebookPublicReply(
  pageAccessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  return graphPost(pageAccessToken, `/${commentId}/comments`, { message });
}

export async function sendFacebookPrivateReply(
  pageAccessToken: string,
  commentId: string,
  message: string
): Promise<{ message_id?: string; recipient_id?: string; id?: string }> {
  return graphPost(pageAccessToken, `/${commentId}/private_replies`, {
    message,
  });
}

export async function sendFacebookDirectMessage(
  pageAccessToken: string,
  pageId: string,
  recipientId: string,
  text: string
): Promise<{ message_id?: string; recipient_id?: string }> {
  return graphPost(pageAccessToken, `/${pageId}/messages`, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: { text },
  });
}

export async function sendFacebookDirectMessageWithLinkButton(
  pageAccessToken: string,
  pageId: string,
  recipientId: string,
  text: string,
  buttonTitle: string,
  url: string
): Promise<{ message_id?: string; recipient_id?: string }> {
  return graphPost(pageAccessToken, `/${pageId}/messages`, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: text.slice(0, 640),
          buttons: [
            {
              type: "web_url",
              title: buttonTitle.slice(0, 20),
              url,
            },
          ],
        },
      },
    },
  });
}
