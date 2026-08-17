# Facebook Comment to Messenger Design

Date: 2026-08-16

## Goal

Add Facebook Page comment automation to the existing OpenReply deployment without changing the live Instagram workflow.

The first Facebook campaign will run on the **Thankful Path** Page. A person comments `JOURNAL` on any Page post or reel, receives a public confirmation, then receives the journal link in Messenger. OpenReply schedules a neutral follow-up five minutes after the tracked-link click.

## Approved campaign behavior

- Page: Thankful Path (`103331758424249`)
- Trigger scope: any Page post or reel
- Keyword: `JOURNAL`, whole-word matching
- Public reply: `Sent it 💛 Check Messenger.`
- Messenger message: `Hey! Thanks for your interest in our gratitude journal 💛 Here you go: {link}`
- Link label when Messenger accepts a button template: `View on Amazon`
- Destination: `https://taap.it/Journal`
- Follow-up: `Hey! Did you get a chance to look at the journal? I’d love to hear what you think 💛`
- Follow-up delay: five minutes after a tracked-link click
- No `{username}` personalization on Facebook or Instagram

Facebook's private-reply capability and messaging window determine the exact presentation. OpenReply sends the journal link in the first private reply so a person receives the promised resource even if Meta does not permit a second message. A later Messenger message is attempted only after a qualifying interaction and inside Meta's allowed window. If Meta refuses the follow-up, OpenReply records the refusal and does not retry outside policy.

## Architecture

OpenReply will keep one campaign engine and introduce a platform boundary.

### Accounts and campaigns

Add a `FacebookPage` model that stores the Page ID, name, encrypted Page access token, connection state, and webhook subscription state.

Add an `AutomationPlatform` enum with `INSTAGRAM` and `FACEBOOK`. Existing automations default to `INSTAGRAM`. An automation points to exactly one account: an `InstagramAccount` or a `FacebookPage`. Application validation enforces that rule.

`DmLog`, `ProcessedComment`, and `LinkClick` gain platform-aware account references. Existing Instagram rows remain valid through migration defaults and nullable Facebook fields.

### Meta connection

Add a Facebook OAuth flow under `/api/facebook/connect` and `/api/facebook/callback`.

The flow requests the minimum Page scopes needed for this feature:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_engagement`
- `pages_manage_metadata`
- `pages_messaging`

The callback exchanges the user token, finds Pages managed by the user, selects Thankful Path, encrypts its Page access token, and subscribes the Page to `feed`, `messages`, `messaging_postbacks`, and `message_reads` where Meta exposes those fields.

The settings page shows Facebook and Instagram connections separately. Disconnecting Facebook removes the stored Page token and disables Facebook automations without affecting Instagram.

### Webhooks

The existing `/api/webhook` endpoint continues to verify `X-Hub-Signature-256` against the configured Meta app secrets.

Instagram payload parsing stays unchanged. A Facebook parser accepts `object: "page"` and emits normalized events for:

- new Page feed comments (`item: "comment"`, `verb: "add"`)
- Messenger postbacks and quick-reply payloads
- inbound Messenger messages
- Messenger read receipts when supplied

The parser ignores Page-authored comments, comment edits, deletes, replies that lack a usable comment ID, message echoes, and attachment-only messages.

The webhook route acknowledges valid events quickly and queues normalized jobs. Job IDs include the platform so an Instagram identifier cannot collide with a Facebook identifier.

### Delivery adapters

Introduce a channel adapter interface for these operations:

- public comment reply
- private reply to a comment
- direct message to a Page-scoped user ID
- direct message with a tracked-link button when Meta permits it

The Instagram adapter wraps current client functions. The Facebook adapter calls the Page endpoints with the Page access token.

For a Facebook comment match, the worker:

1. reserves usage and creates an idempotent log;
2. posts the public reply when enabled;
3. sends one private Messenger reply containing the tracked URL;
4. records the returned Page-scoped recipient ID when Meta supplies it;
5. marks the log sent and releases the reservation on failure.

The first private reply contains the destination link. This avoids relying on a second outbound message before the person has interacted in Messenger.

### Tracking and follow-up

Tracked links remain campaign-owned. A click route records the platform and account from the campaign log associated with the recipient token.

The Facebook private reply uses a recipient-specific tracked URL. That URL carries an opaque signed reference to the log, not a Facebook user ID. A click schedules one follow-up job for that log. Database uniqueness and deterministic queue IDs prevent duplicate follow-ups from repeat clicks.

Before sending the follow-up, the worker checks:

- the campaign is active;
- the original Facebook DM log succeeded;
- no follow-up was sent for that log;
- the interaction is still inside the Messenger policy window known to OpenReply.

The worker records Meta policy errors as a skipped follow-up instead of retrying them.

## User interface

The settings page adds a Facebook Page card with Connect, Reconnect, and Disconnect actions plus webhook status.

The campaign builder adds a platform selector and then shows accounts for that platform. The existing Instagram campaign defaults and screens remain unchanged. Facebook hides Instagram-only options such as follow gating and Instagram DM keyword triggers.

Campaign cards display an Instagram or Facebook badge. The first Facebook Journal campaign is created from the approved settings after the Page connects.

## Security

- Store Page access tokens with the existing AES encryption helper.
- Sign OAuth state with the workspace ID and a short expiration.
- Never expose Page tokens to the browser or logs.
- Verify every workspace/account relation on API writes.
- Verify webhook signatures before parsing or storing actionable data.
- Store only opaque tracking references in public URLs.

## Error handling

- Treat expired tokens, missing permissions, rate limits, duplicate private replies, and closed messaging windows as distinct outcomes.
- Retry rate limits and transient Meta failures with the existing queue backoff.
- Do not retry permanent permission or policy-window failures.
- Show connection and webhook failures in Diagnostics.
- Keep Facebook failures isolated from Instagram jobs.

## Testing

Add automated coverage for:

- Facebook feed-comment webhook parsing and ignored-event cases
- Messenger message and postback parsing
- Facebook API request shapes
- platform-aware queue IDs and deduplication
- Facebook keyword matching and public/private reply behavior
- recipient-specific tracked links and one follow-up per log
- migration compatibility for existing Instagram rows
- settings and automation API authorization

Run the full unit suite, TypeScript check, lint, Prisma validation/generation, and production build. After deployment, perform a live test from a non-Page Facebook account and confirm the comment reply, Messenger delivery, tracked redirect, five-minute follow-up, logs, and zero failed queue jobs.

## Rollout

1. Deploy the schema and application with Facebook disabled until a Page is connected.
2. Configure the Facebook app ID and callback URL in Vercel and Meta.
3. Connect Thankful Path and subscribe the Page webhooks.
4. Create the Facebook Journal campaign in paused state.
5. Run a live comment test from a separate Facebook account.
6. Activate the campaign after the complete path passes.

Instagram remains live during the rollout. A failed Facebook connection or test does not pause the Instagram campaign.

## External constraints

Meta may require Advanced Access and App Review for real Facebook users who do not have a role on the app. The implementation can be completed and tested with app-role accounts before review. Production delivery to the Page audience starts only after Meta grants the required permissions.

Primary Meta references:

- https://www.postman.com/meta/messenger-platform-api/folder/22794852-b5d97624-14d8-4e67-a2e4-529add49ca58
- https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api
- https://www.facebook.com/help/111845295668907/
