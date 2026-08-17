import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFacebookPageById,
  getRecentFacebookPagePosts,
  getRecentFacebookPostComments,
  listManagedFacebookPages,
  sendFacebookDirectMessage,
  sendFacebookDirectMessageWithLinkButton,
  sendFacebookPrivateReply,
  sendFacebookPublicReply,
  subscribeFacebookPage,
  unsubscribeFacebookPage,
} from "../lib/meta/facebook-client";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Facebook Page Graph client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the public confirmation under the source comment", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "reply-1" }));

    await sendFacebookPublicReply("page-token", "comment-1", "Sent it 💛 Check Messenger.");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/graph\.facebook\.com\/v25\.0\/comment-1\/comments$/);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer page-token" });
    expect(JSON.parse(String(init?.body))).toEqual({
      message: "Sent it 💛 Check Messenger.",
    });
  });

  it("opens the private conversation with a qualifying quick reply", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message_id: "message-1", recipient_id: "psid-1" })
    );

    const result = await sendFacebookPrivateReply(
      "page-token",
      "page-1",
      "comment-1",
      "Hey! Tap below and I’ll send the Amazon link.",
      "View on Amazon",
      "facebook_reveal:signed-reference"
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/graph\.facebook\.com\/v25\.0\/page-1\/messages$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { comment_id: "comment-1" },
      messaging_type: "RESPONSE",
      message: {
        text: "Hey! Tap below and I’ll send the Amazon link.",
        quick_replies: [
          {
            content_type: "text",
            title: "View on Amazon",
            payload: "facebook_reveal:signed-reference",
          },
        ],
      },
    });
    expect(result).toEqual({ message_id: "message-1", recipient_id: "psid-1" });
  });

  it("sends a direct Messenger response to a Page-scoped recipient", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "message-2" }));

    await sendFacebookDirectMessage("page-token", "page-1", "psid-1", "Hey!");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/graph\.facebook\.com\/v25\.0\/page-1\/messages$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "psid-1" },
      messaging_type: "RESPONSE",
      message: { text: "Hey!" },
    });
  });

  it("sends a web URL button through Messenger", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "message-3" }));

    await sendFacebookDirectMessageWithLinkButton(
      "page-token",
      "page-1",
      "psid-1",
      "Here you go 💛",
      "View on Amazon",
      "https://example.test/r/journal"
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "psid-1" },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "Here you go 💛",
            buttons: [
              {
                type: "web_url",
                title: "View on Amazon",
                url: "https://example.test/r/journal",
              },
            ],
          },
        },
      },
    });
  });

  it("lists managed Pages without leaking the user token into the URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "page-1",
            name: "Thankful Path",
            access_token: "page-token",
            tasks: ["MODERATE", "MESSAGING"],
          },
        ],
      })
    );

    const pages = await listManagedFacebookPages("user-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("user-token");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer user-token" });
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toBe("Thankful Path");
  });

  it("gets the configured Page directly when Meta omits it from me/accounts", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "103331758424249",
        name: "Thankful Path",
        access_token: "page-token",
      })
    );

    const page = await getFacebookPageById(
      "user-token",
      "103331758424249"
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/103331758424249?");
    expect(String(url)).not.toContain("user-token");
    expect(new URL(String(url)).searchParams.get("fields")).toBe(
      "id,name,access_token"
    );
    expect(init?.headers).toMatchObject({ Authorization: "Bearer user-token" });
    expect(page).toEqual({
      id: "103331758424249",
      name: "Thankful Path",
      access_token: "page-token",
    });
  });

  it("subscribes the Page to comment and Messenger webhook fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));

    await subscribeFacebookPage("page-token", "page-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/graph\.facebook\.com\/v25\.0\/page-1\/subscribed_apps$/);
    expect(String(init?.body)).toBe(
      "subscribed_fields=feed%2Cmessages%2Cmessaging_postbacks%2Cmessage_reads"
    );
  });

  it("unsubscribes the Page before a local disconnect", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));

    await unsubscribeFacebookPage("page-token", "page-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(
      /graph\.facebook\.com\/v25\.0\/page-1\/subscribed_apps$/
    );
    expect(init?.method).toBe("DELETE");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer page-token" });
  });

  it("lists recent Page posts for the polling safety net", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "page-1_post-1",
            created_time: "2026-08-17T12:24:51+0000",
          },
        ],
      })
    );

    const posts = await getRecentFacebookPagePosts(
      "page-token",
      "page-1",
      10
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/page-1/feed?");
    expect(new URL(String(url)).searchParams.get("fields")).toBe(
      "id,created_time"
    );
    expect(new URL(String(url)).searchParams.get("limit")).toBe("10");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer page-token" });
    expect(posts).toEqual([
      { id: "page-1_post-1", created_time: "2026-08-17T12:24:51+0000" },
    ]);
  });

  it("lists recent comments on a Page post without putting the token in the URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "post-1_comment-1",
            message: "JOURNAL",
            created_time: "2026-08-17T12:26:49+0000",
            from: { id: "person-1", name: "Sergei Imanov" },
          },
        ],
      })
    );

    const comments = await getRecentFacebookPostComments(
      "page-token",
      "page-1_post-1"
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/page-1_post-1/comments?");
    expect(String(url)).not.toContain("page-token");
    expect(new URL(String(url)).searchParams.get("fields")).toBe(
      "id,message,created_time,from"
    );
    expect(new URL(String(url)).searchParams.get("order")).toBe(
      "reverse_chronological"
    );
    expect(init?.headers).toMatchObject({ Authorization: "Bearer page-token" });
    expect(comments[0]).toMatchObject({
      id: "post-1_comment-1",
      message: "JOURNAL",
      from: { id: "person-1", name: "Sergei Imanov" },
    });
  });
});
