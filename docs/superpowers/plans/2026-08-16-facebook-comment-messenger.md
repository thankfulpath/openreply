# Facebook Comment to Messenger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready Facebook Page `JOURNAL` comment automation that sends the journal link in Messenger and schedules a five-minute click follow-up while preserving the live Instagram campaign.

**Architecture:** Keep the existing automation engine and add an explicit `FACEBOOK` platform plus a `FacebookPage` account model. Normalize Facebook webhook events into the existing BullMQ pipeline and route delivery through platform-specific Meta client functions. Store a signed, log-specific reference in tracked URLs so click follow-ups target the right Messenger recipient without exposing a Facebook ID.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7/PostgreSQL, BullMQ/Redis, Vitest, Meta Graph API v25.0, Vercel, Railway.

**Spec:** `docs/superpowers/specs/2026-08-16-facebook-comment-messenger-design.md`

## Global Constraints

- Keep the existing Instagram campaign live and behavior-compatible.
- Use Page `103331758424249`, keyword `JOURNAL`, and destination `https://taap.it/Journal`.
- Use neutral copy without `{username}` on Facebook and Instagram.
- Send `Sent it 💛 Check Messenger.` as the Facebook public reply.
- Put the tracked journal link in the first Facebook private reply.
- Schedule the follow-up five minutes after the tracked-link click.
- Do not send outside Meta's allowed messaging window; record permanent policy failures without retrying.
- Encrypt Page access tokens and never expose them to browser code or logs.
- Do not add paid services or payment methods.

---

### Task 1: Platform-aware database model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260816190000_add_facebook_page_channel/migration.sql`
- Test: `__tests__/facebook-schema.test.ts`

**Interfaces:**
- Produces: `AutomationPlatform`, `FacebookPage`, optional `facebookPageId` relations, `followUpSentAt`, and `followUpError`.
- Existing Instagram rows keep `platform = INSTAGRAM` and their current foreign keys.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Facebook schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  it("defines a Facebook Page and platform-aware campaigns", () => {
    expect(schema).toContain("enum AutomationPlatform");
    expect(schema).toContain("model FacebookPage");
    expect(schema).toContain("facebookPageId");
    expect(schema).toContain("followUpSentAt");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- __tests__/facebook-schema.test.ts`
Expected: FAIL because the schema lacks `FacebookPage`.

- [ ] **Step 3: Add the schema and migration**

Use this model boundary:

```prisma
enum AutomationPlatform {
  INSTAGRAM
  FACEBOOK
}

model FacebookPage {
  id                String   @id @default(cuid())
  workspaceId       String
  pageId             String   @unique
  name               String
  accessToken        String
  tokenExpiresAt     DateTime?
  webhookSubscribed  Boolean  @default(false)
  connectedAt        DateTime @default(now())
  updatedAt          DateTime @updatedAt
  workspace          Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  automations        Automation[]
  dmLogs             DmLog[]
  linkClicks         LinkClick[]
  @@index([workspaceId])
}
```

Add `platform AutomationPlatform @default(INSTAGRAM)` and nullable account relations to `Automation`, `DmLog`, `ProcessedComment`, and `LinkClick`. Add `followUpSentAt DateTime?` and `followUpError String?` to `DmLog`. Preserve every existing Instagram constraint that can remain valid; use application validation for the one-of-two account invariant.

- [ ] **Step 4: Generate Prisma client and run the schema test**

Run: `npm run db:generate && npm test -- __tests__/facebook-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma __tests__/facebook-schema.test.ts
git commit -m "feat: add Facebook Page data model"
```

### Task 2: Facebook webhook normalization

**Files:**
- Create: `lib/meta/facebook-webhook.ts`
- Modify: `app/api/webhook/route.ts`
- Test: `__tests__/facebook-webhook.test.ts`

**Interfaces:**
- Produces: `parseFacebookCommentEvents(payload)`, `parseFacebookMessageEvents(payload)`, `parseFacebookPostbackEvents(payload)`, and normalized event types with `platform: "FACEBOOK"`.
- Consumes: Page webhook payloads with `object: "page"`.

- [ ] **Step 1: Write failing parser tests**

```ts
it("parses a new Page feed comment", () => {
  const events = parseFacebookCommentEvents({
    object: "page",
    entry: [{
      id: "103331758424249",
      changes: [{ field: "feed", value: {
        item: "comment", verb: "add", comment_id: "c1", post_id: "p1",
        sender_id: "u1", sender_name: "Customer", message: "JOURNAL"
      }}]
    }]
  });
  expect(events).toEqual([{ platform: "FACEBOOK", pageId: "103331758424249", commentId: "c1", commentText: "JOURNAL", commenterId: "u1", commenterName: "Customer", mediaId: "p1" }]);
});

it("ignores Page-authored comments, edits, and deletes", () => {
  expect(parseFacebookCommentEvents(pageAuthoredFixture)).toEqual([]);
  expect(parseFacebookCommentEvents(editFixture)).toEqual([]);
  expect(parseFacebookCommentEvents(deleteFixture)).toEqual([]);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- __tests__/facebook-webhook.test.ts`
Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement focused parsers**

```ts
export interface FacebookCommentEvent {
  platform: "FACEBOOK";
  pageId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
}

export function parseFacebookCommentEvents(payload: FacebookWebhookPayload): FacebookCommentEvent[] {
  if (payload.object !== "page") return [];
  // Accept only field=feed, item=comment, verb=add with all required IDs.
}
```

Add equivalent strict parsing for non-echo Messenger text, quick-reply/postback payloads, and read receipts.

- [ ] **Step 4: Route Facebook events into platform-aware jobs**

In `app/api/webhook/route.ts`, select the parser from `payload.object`, look up `FacebookPage` by `pageId`, and queue IDs such as `comment_facebook_<pageId>_<commentId>`. Preserve the Instagram branches.

- [ ] **Step 5: Run parser and existing webhook tests**

Run: `npm test -- __tests__/facebook-webhook.test.ts __tests__/webhook.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/meta/facebook-webhook.ts app/api/webhook/route.ts __tests__/facebook-webhook.test.ts
git commit -m "feat: normalize Facebook Page webhooks"
```

### Task 3: Facebook Meta API client

**Files:**
- Create: `lib/meta/facebook-client.ts`
- Test: `__tests__/facebook-client.test.ts`
- Modify: `lib/meta/client.ts`

**Interfaces:**
- Produces: `sendFacebookPublicReply`, `sendFacebookPrivateReply`, `sendFacebookDirectMessage`, `subscribeFacebookPage`, `listManagedFacebookPages`.
- Consumes: encrypted-token callers pass a decrypted Page token and explicit Page/comment/user IDs.

- [ ] **Step 1: Write failing request-shape tests**

```ts
it("sends a private reply with the tracked URL in the first message", async () => {
  await sendFacebookPrivateReply("token", "comment-1", "Hey! Link: https://example.test/r/x");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/comment-1/private_replies"),
    expect.objectContaining({ method: "POST" })
  );
  expect(JSON.parse(mockFetchBody())).toEqual({ message: "Hey! Link: https://example.test/r/x" });
});
```

Cover public `/{comment-id}/comments`, private `/{comment-id}/private_replies`, Page `/{page-id}/messages`, Page discovery, and `/{page-id}/subscribed_apps`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- __tests__/facebook-client.test.ts`
Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the Page client using the shared Meta error mapper**

```ts
export async function sendFacebookPrivateReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id?: string; message_id?: string }> {
  return graphPost(`/${commentId}/private_replies`, accessToken, { message });
}
```

Export the current response handler from `lib/meta/client.ts` or move it to a small shared file without changing existing Instagram behavior.

- [ ] **Step 4: Run client tests**

Run: `npm test -- __tests__/facebook-client.test.ts __tests__/dm-worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/meta/facebook-client.ts lib/meta/client.ts __tests__/facebook-client.test.ts
git commit -m "feat: add Facebook Page Graph client"
```

### Task 4: Platform-aware worker and idempotency

**Files:**
- Modify: `lib/queue/client.ts`
- Modify: `lib/queue/dm-worker.ts`
- Create: `lib/queue/facebook-comment.ts`
- Test: `__tests__/facebook-dm-worker.test.ts`
- Modify: `__tests__/dm-worker.test.ts`

**Interfaces:**
- Queue comment jobs contain `platform`, `accountId`, and the normalized comment fields.
- `processFacebookComment(job, deps)` returns after logging public and private outcomes.
- Existing Instagram jobs without `platform` are treated as `INSTAGRAM` during migration.

- [ ] **Step 1: Write failing worker tests**

Test keyword matching, public reply, one private reply, first-message tracked URL, duplicate comment idempotency, usage release on failure, and permanent-policy-error handling.

```ts
expect(mockSendFacebookPrivateReply).toHaveBeenCalledWith(
  "page-token",
  "comment-1",
  expect.stringContaining("https://openreply-pied.vercel.app/r/")
);
expect(mockSendFacebookPrivateReply).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the worker tests and verify they fail**

Run: `npm test -- __tests__/facebook-dm-worker.test.ts`
Expected: FAIL because the Facebook processor does not exist.

- [ ] **Step 3: Add platform-aware queue types**

```ts
export type AutomationPlatform = "INSTAGRAM" | "FACEBOOK";

export interface ProcessCommentJob {
  platform?: AutomationPlatform;
  accountId?: string;
  instagramAccountId?: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  source?: CommentSource;
}
```

- [ ] **Step 4: Implement the Facebook processor in a focused module**

Load active `FACEBOOK` automations for the Page, reuse `matchKeywords`, reserve usage, upsert `DmLog`, post the public reply, render the tracked link, send one private reply, and persist recipient/outcome fields. Use the existing backoff only for transient errors.

- [ ] **Step 5: Dispatch by platform from the worker**

```ts
if (job.name === "process-comment" && job.data.platform === "FACEBOOK") {
  return processFacebookComment(job as Job<ProcessCommentJob>);
}
return processComment(job as Job<ProcessCommentJob>);
```

- [ ] **Step 6: Run Facebook and Instagram worker tests**

Run: `npm test -- __tests__/facebook-dm-worker.test.ts __tests__/dm-worker.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/queue __tests__/facebook-dm-worker.test.ts __tests__/dm-worker.test.ts
git commit -m "feat: process Facebook comment campaigns"
```

### Task 5: Recipient-specific tracking and follow-up

**Files:**
- Modify: `app/r/[slug]/route.ts`
- Create: `lib/tracking/recipient-reference.ts`
- Modify: `lib/queue/client.ts`
- Modify: `lib/queue/dm-worker.ts`
- Test: `__tests__/facebook-follow-up.test.ts`
- Modify: `__tests__/tracking.test.ts`

**Interfaces:**
- Produces: `signRecipientReference(dmLogId): string` and `verifyRecipientReference(value): { dmLogId: string } | null`.
- The click URL accepts `ref=<signed opaque value>` and never exposes a Page-scoped user ID.

- [ ] **Step 1: Write failing signature and follow-up tests**

```ts
const token = signRecipientReference("log_1");
expect(verifyRecipientReference(token)).toEqual({ dmLogId: "log_1" });
expect(verifyRecipientReference(token + "x")).toBeNull();
```

Verify repeat clicks create one deterministic `followup_facebook_<dmLogId>` job and that a sent follow-up cannot send again.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- __tests__/facebook-follow-up.test.ts __tests__/tracking.test.ts`
Expected: FAIL because recipient references do not exist.

- [ ] **Step 3: Implement HMAC-signed recipient references**

Use `NEXTAUTH_SECRET` as the HMAC key, encode payload and signature with base64url, compare signatures with `timingSafeEqual`, and reject malformed input.

- [ ] **Step 4: Schedule the click follow-up**

On a valid Facebook recipient reference, record `LinkClick` with `platform = FACEBOOK` and enqueue a five-minute job keyed by `dmLogId`. Keep existing anonymous Instagram click tracking unchanged.

- [ ] **Step 5: Send the Messenger follow-up once**

Load the log, campaign, and Page; stop if inactive, unsent, previously followed up, or outside policy. Send the approved neutral copy through `sendFacebookDirectMessage`, then set `followUpSentAt`. Store permanent Meta refusal text in `followUpError`.

- [ ] **Step 6: Run tracking and follow-up tests**

Run: `npm test -- __tests__/facebook-follow-up.test.ts __tests__/tracking.test.ts __tests__/dm-worker.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/r lib/tracking lib/queue __tests__/facebook-follow-up.test.ts __tests__/tracking.test.ts
git commit -m "feat: add Facebook click follow-ups"
```

### Task 6: Facebook OAuth and Page settings

**Files:**
- Create: `app/api/facebook/connect/route.ts`
- Create: `app/api/facebook/callback/route.ts`
- Create: `app/api/facebook/accounts/route.ts`
- Create: `app/api/facebook/disconnect/route.ts`
- Create: `lib/meta/facebook-oauth.ts`
- Modify: `app/(dashboard)/settings/page.tsx`
- Modify: `.env.example`
- Test: `__tests__/facebook-oauth.test.ts`

**Interfaces:**
- Produces authenticated connection endpoints and Page status JSON.
- Required environment: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, existing `WEBHOOK_VERIFY_TOKEN`, `NEXTAUTH_URL`.

- [ ] **Step 1: Write failing OAuth state and callback tests**

Cover signed state, workspace authorization, denied consent, Page discovery, Page `103331758424249` selection, token encryption, webhook subscription, and token non-disclosure.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- __tests__/facebook-oauth.test.ts`
Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement OAuth with exact scopes**

```ts
const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_manage_metadata",
  "pages_messaging",
];
```

Use a short-lived signed state tied to the authenticated workspace. Exchange the authorization code on the server, fetch managed Pages, select Thankful Path by ID, encrypt its Page token, subscribe webhook fields, and redirect to `/settings?facebook=connected`.

- [ ] **Step 4: Add the Facebook settings card**

Show Page name, connected state, webhook state, Connect/Reconnect, and Disconnect. Keep tokens server-only.

- [ ] **Step 5: Run OAuth tests and typecheck the settings page**

Run: `npm test -- __tests__/facebook-oauth.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/facebook app/'(dashboard)'/settings lib/meta/facebook-oauth.ts .env.example __tests__/facebook-oauth.test.ts
git commit -m "feat: connect Facebook Pages"
```

### Task 7: Platform-aware campaign UI and API

**Files:**
- Modify: `app/api/automations/route.ts`
- Modify: `components/campaign-builder.tsx`
- Modify: `app/(dashboard)/campaigns/page.tsx`
- Modify: `app/(dashboard)/campaigns/[id]/page.tsx`
- Test: `__tests__/facebook-automations.test.ts`

**Interfaces:**
- Automation create/update accepts `platform` plus exactly one account ID.
- Facebook campaigns hide follow gating and Instagram inbound-DM triggers.

- [ ] **Step 1: Write failing API tests**

Cover workspace ownership, one-account validation, Facebook defaults, Instagram backward compatibility, and serialized platform badges.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- __tests__/facebook-automations.test.ts`
Expected: FAIL because automation APIs accept only Instagram account IDs.

- [ ] **Step 3: Extend schemas and queries**

Use a discriminated input:

```ts
type AutomationAccountInput =
  | { platform: "INSTAGRAM"; instagramAccountId: string; facebookPageId?: never }
  | { platform: "FACEBOOK"; facebookPageId: string; instagramAccountId?: never };
```

Reject mismatched workspace/account pairs and disable Instagram-only flags for Facebook.

- [ ] **Step 4: Add the platform selector and badges**

Default existing/edit screens to the stored platform. For Facebook show Page accounts, `JOURNAL` trigger settings, public Messenger wording, first-message link text, and follow-up delay. Keep Instagram screens unchanged.

- [ ] **Step 5: Run API tests, typecheck, and lint touched UI**

Run: `npm test -- __tests__/facebook-automations.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/automations components/campaign-builder.tsx app/'(dashboard)'/campaigns __tests__/facebook-automations.test.ts
git commit -m "feat: manage Facebook campaigns"
```

### Task 8: Diagnostics, documentation, and production verification

**Files:**
- Modify: `app/api/admin/diagnostics/route.ts`
- Modify: `app/(dashboard)/diagnostics/page.tsx`
- Modify: `README.md`
- Modify: `docs/setup.md`
- Modify: `META_APP_REVIEW.md`
- Test: `__tests__/diagnostics.test.ts`

**Interfaces:**
- Diagnostics identify Facebook token, webhook, private-reply, and policy-window failures without exposing secrets.

- [ ] **Step 1: Add failing diagnostics tests**

Verify platform labels and redacted Facebook errors appear in API results while access tokens never do.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- __tests__/diagnostics.test.ts`
Expected: FAIL until Facebook diagnostics are included.

- [ ] **Step 3: Add diagnostics and setup documentation**

Document callback URL `/api/facebook/callback`, webhook object `page`, fields, scopes, App Review requirement, and the live test checklist. Label Meta review as an external production gate.

- [ ] **Step 4: Run the complete local verification suite**

Run: `npm test && npm run typecheck && npm run lint && npx prisma validate && npm run build`
Expected: every command exits 0.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin app/'(dashboard)'/diagnostics README.md docs/setup.md META_APP_REVIEW.md __tests__/diagnostics.test.ts
git commit -m "docs: add Facebook operations guide"
```

- [ ] **Step 6: Deploy application and worker**

Push the implementation branch, deploy Vercel, apply the production Prisma migration, and redeploy the Railway worker with the same commit. Add `FACEBOOK_APP_ID` to Vercel and Railway without printing secrets.

- [ ] **Step 7: Configure Meta**

Add the exact Facebook OAuth callback, configure the existing webhook callback for the `page` object, connect Thankful Path, and verify `feed`, `messages`, `messaging_postbacks`, and `message_reads` subscriptions accepted by Meta.

- [ ] **Step 8: Create and activate the Facebook Journal campaign**

Create it paused with the approved copy and `https://taap.it/Journal`. Run a test comment from a non-Page account, click the tracked link, wait five minutes, and verify the Messenger follow-up. Activate only after logs show zero permanent failures.

- [ ] **Step 9: Record production evidence**

Capture the deployed commit, Page connection state, webhook status, campaign ID, successful DM log, tracked click, follow-up timestamp, worker health, and queue failure count. Do not include access tokens.
