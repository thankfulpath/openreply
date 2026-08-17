import { describe, expect, it } from "vitest";
import {
  buildFacebookCommentJob,
  parseFacebookCommentEvents,
  parseFacebookMessageEvents,
  parseFacebookPostbackEvents,
  parseFacebookReadEvents,
} from "../lib/meta/facebook-webhook";

describe("Facebook Page webhook parsing", () => {
  it("normalizes a new feed comment", () => {
    const events = parseFacebookCommentEvents({
      object: "page",
      entry: [
        {
          id: "103331758424249",
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "comment-1",
                post_id: "post-1",
                sender_id: "person-1",
                sender_name: "Customer",
                message: "JOURNAL",
              },
            },
          ],
        },
      ],
    });

    expect(events).toEqual([
      {
        platform: "FACEBOOK",
        pageId: "103331758424249",
        commentId: "comment-1",
        commentText: "JOURNAL",
        commenterId: "person-1",
        commenterName: "Customer",
        mediaId: "post-1",
      },
    ]);
  });

  it("builds a platform-scoped queue job", () => {
    expect(
      buildFacebookCommentJob({
        platform: "FACEBOOK",
        pageId: "page-1",
        commentId: "comment-1",
        commentText: "JOURNAL",
        commenterId: "person-1",
        commenterName: "Customer",
        mediaId: "post-1",
      })
    ).toEqual({
      name: "process-comment",
      data: {
        platform: "FACEBOOK",
        accountId: "page-1",
        facebookPageId: "page-1",
        commentId: "comment-1",
        commentText: "JOURNAL",
        commenterId: "person-1",
        commenterName: "Customer",
        mediaId: "post-1",
        source: "WEBHOOK",
      },
      jobId: "comment_facebook_page-1_comment-1",
    });
  });

  it.each([
    ["Page-authored", { item: "comment", verb: "add", comment_id: "c1", post_id: "p1", sender_id: "page-1", message: "JOURNAL" }],
    ["edited", { item: "comment", verb: "edited", comment_id: "c1", post_id: "p1", sender_id: "person-1", message: "JOURNAL" }],
    ["removed", { item: "comment", verb: "remove", comment_id: "c1", post_id: "p1", sender_id: "person-1", message: "JOURNAL" }],
    ["post change", { item: "post", verb: "add", post_id: "p1", sender_id: "person-1", message: "JOURNAL" }],
  ])("ignores %s feed events", (_label, value) => {
    expect(
      parseFacebookCommentEvents({
        object: "page",
        entry: [{ id: "page-1", changes: [{ field: "feed", value }] }],
      })
    ).toEqual([]);
  });

  it("normalizes Messenger text and quick-reply messages", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: "person-1" },
              recipient: { id: "page-1" },
              message: { mid: "mid-1", text: "hello" },
            },
            {
              sender: { id: "person-2" },
              recipient: { id: "page-1" },
              message: {
                mid: "mid-2",
                text: "Send it",
                quick_reply: { payload: "reveal:auto-1" },
              },
            },
          ],
        },
      ],
    };

    expect(parseFacebookMessageEvents(payload)).toEqual([
      {
        platform: "FACEBOOK",
        pageId: "page-1",
        messageId: "mid-1",
        messageText: "hello",
        senderId: "person-1",
      },
    ]);
    expect(parseFacebookPostbackEvents(payload)).toEqual([
      {
        platform: "FACEBOOK",
        pageId: "page-1",
        userId: "person-2",
        payload: "reveal:auto-1",
        mid: "mid-2",
      },
    ]);
  });

  it("drops message echoes and attachment-only messages", () => {
    expect(
      parseFacebookMessageEvents({
        object: "page",
        entry: [
          {
            id: "page-1",
            messaging: [
              {
                sender: { id: "page-1" },
                recipient: { id: "person-1" },
                message: { mid: "mid-1", text: "echo", is_echo: true },
              },
              {
                sender: { id: "person-1" },
                recipient: { id: "page-1" },
                message: { mid: "mid-2", attachments: [{ type: "image" }] },
              },
            ],
          },
        ],
      })
    ).toEqual([]);
  });

  it("normalizes postbacks and read receipts", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: "person-1" },
              recipient: { id: "page-1" },
              postback: { mid: "mid-3", payload: "reveal:auto-1" },
            },
            {
              sender: { id: "person-2" },
              recipient: { id: "page-1" },
              read: { watermark: 1234 },
            },
          ],
        },
      ],
    };

    expect(parseFacebookPostbackEvents(payload)).toEqual([
      {
        platform: "FACEBOOK",
        pageId: "page-1",
        userId: "person-1",
        payload: "reveal:auto-1",
        mid: "mid-3",
      },
    ]);
    expect(parseFacebookReadEvents(payload)).toEqual([
      {
        platform: "FACEBOOK",
        pageId: "page-1",
        userId: "person-2",
        watermark: 1234,
      },
    ]);
  });

  it("ignores non-Page payloads", () => {
    expect(parseFacebookCommentEvents({ object: "instagram", entry: [] })).toEqual([]);
    expect(parseFacebookMessageEvents({ object: "instagram", entry: [] })).toEqual([]);
    expect(parseFacebookPostbackEvents({ object: "instagram", entry: [] })).toEqual([]);
    expect(parseFacebookReadEvents({ object: "instagram", entry: [] })).toEqual([]);
  });
});
