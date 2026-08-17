export interface FacebookCommentEvent {
  platform: "FACEBOOK";
  pageId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
}

export interface FacebookMessageEvent {
  platform: "FACEBOOK";
  pageId: string;
  messageId: string;
  messageText: string;
  senderId: string;
}

export interface FacebookPostbackEvent {
  platform: "FACEBOOK";
  pageId: string;
  userId: string;
  payload: string;
  interactionTimestamp: number;
  mid?: string;
}

export interface FacebookReadEvent {
  platform: "FACEBOOK";
  pageId: string;
  userId: string;
  watermark?: number;
}

export function buildFacebookCommentJob(event: FacebookCommentEvent) {
  return {
    name: "process-comment" as const,
    data: {
      platform: "FACEBOOK" as const,
      accountId: event.pageId,
      facebookPageId: event.pageId,
      commentId: event.commentId,
      commentText: event.commentText,
      commenterId: event.commenterId,
      commenterName: event.commenterName,
      mediaId: event.mediaId,
      source: "WEBHOOK" as const,
    },
    jobId: `comment_facebook_${event.pageId}_${event.commentId}`.replace(
      /:/g,
      "_"
    ),
  };
}

export interface FacebookWebhookPayload {
  object: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        item?: string;
        verb?: string;
        comment_id?: string;
        post_id?: string;
        sender_id?: string;
        sender_name?: string;
        message?: string;
      };
    }>;
    messaging?: Array<{
      timestamp?: number;
      sender?: { id?: string };
      recipient?: { id?: string };
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        is_deleted?: boolean;
        is_unsupported?: boolean;
        attachments?: Array<{ type?: string }>;
        quick_reply?: { payload?: string };
      };
      postback?: { mid?: string; payload?: string; title?: string };
      read?: { watermark?: number; seq?: number };
    }>;
  }>;
}

export function parseFacebookCommentEvents(
  payload: FacebookWebhookPayload
): FacebookCommentEvent[] {
  if (payload.object !== "page") return [];

  const events: FacebookCommentEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const pageId = entry.id;
    if (!pageId) continue;

    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (
        change.field !== "feed" ||
        value?.item !== "comment" ||
        value.verb !== "add"
      ) {
        continue;
      }

      const commentId = value.comment_id;
      const mediaId = value.post_id;
      const commenterId = value.sender_id;
      if (!commentId || !mediaId || !commenterId || commenterId === pageId) {
        continue;
      }

      events.push({
        platform: "FACEBOOK",
        pageId,
        commentId,
        commentText: value.message ?? "",
        commenterId,
        commenterName: value.sender_name,
        mediaId,
      });
    }
  }

  return events;
}

export function parseFacebookMessageEvents(
  payload: FacebookWebhookPayload
): FacebookMessageEvent[] {
  if (payload.object !== "page") return [];

  const events: FacebookMessageEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const pageId = entry.id ?? messaging.recipient?.id;
      const senderId = messaging.sender?.id;
      const message = messaging.message;
      if (!pageId || !senderId || senderId === pageId || !message) continue;
      if (
        message.is_echo ||
        message.is_deleted ||
        message.is_unsupported ||
        message.quick_reply?.payload
      ) {
        continue;
      }

      const messageId = message.mid;
      const messageText = message.text?.trim();
      if (!messageId || !messageText) continue;

      events.push({
        platform: "FACEBOOK",
        pageId,
        messageId,
        messageText,
        senderId,
      });
    }
  }

  return events;
}

export function parseFacebookPostbackEvents(
  payload: FacebookWebhookPayload
): FacebookPostbackEvent[] {
  if (payload.object !== "page") return [];

  const events: FacebookPostbackEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const pageId = entry.id ?? messaging.recipient?.id;
      const userId = messaging.sender?.id;
      const payloadValue =
        messaging.postback?.payload ?? messaging.message?.quick_reply?.payload;
      const interactionTimestamp = messaging.timestamp;
      if (
        !pageId ||
        !userId ||
        userId === pageId ||
        !payloadValue ||
        !Number.isFinite(interactionTimestamp)
      ) {
        continue;
      }

      events.push({
        platform: "FACEBOOK",
        pageId,
        userId,
        payload: payloadValue,
        interactionTimestamp: interactionTimestamp as number,
        mid: messaging.postback?.mid ?? messaging.message?.mid,
      });
    }
  }

  return events;
}

export function parseFacebookReadEvents(
  payload: FacebookWebhookPayload
): FacebookReadEvent[] {
  if (payload.object !== "page") return [];

  const events: FacebookReadEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const pageId = entry.id ?? messaging.recipient?.id;
      const userId = messaging.sender?.id;
      if (!messaging.read || !pageId || !userId || userId === pageId) continue;

      events.push({
        platform: "FACEBOOK",
        pageId,
        userId,
        watermark: messaging.read.watermark,
      });
    }
  }

  return events;
}
