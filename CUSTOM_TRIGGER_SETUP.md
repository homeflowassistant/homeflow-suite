# HomeFlow Custom Trigger Webhook

This implementation adds a stable public webhook URL per installed HighLevel location and forwards each accepted JSON payload to every active HighLevel Marketplace custom-trigger workflow binding for that location.

## HighLevel Marketplace setup

Create and publish a Marketplace Workflow Trigger with the sample payload shape required by the external sender. Configure its Subscription URL to:

```text
https://YOUR_BACKEND_DOMAIN/api/ghl/custom-trigger/subscription
```

Configure the optional request header below in the HighLevel Marketplace trigger settings when `CUSTOM_TRIGGER_SUBSCRIPTION_SECRET` is set:

```text
X-Homeflow-Subscription-Secret: YOUR_SECRET
```

Attach the published custom trigger to the workflow in the source account, publish the workflow, and include both the workflow and trigger in the snapshot. Attach that snapshot to the SaaS plan. The Marketplace app must also be installed/integrated in the destination sub-account so HighLevel exposes the custom trigger there.

When HighLevel creates or updates a trigger instance in a workflow, it calls the Subscription URL. The implementation stores `triggerData.targetUrl` using `extras.locationId`, `extras.workflowId`, and the trigger key. The application then forwards external payloads to that saved HighLevel target URL. It also writes the generated public URL to the existing GHL custom value `homeflow_webhook`, which is the value read by the integration page’s Webhook URL field. If `homeflow_webhook` is missing from the snapshot, the app uses HighLevel’s supported Create Custom Value API to create it.

## Environment variables

```dotenv
# Public backend origin. Use the backend origin when frontend and backend are deployed separately.
CUSTOM_TRIGGER_WEBHOOK_BASE_URL=https://YOUR_BACKEND_DOMAIN

# Same secret configured as X-Homeflow-Subscription-Secret in HighLevel.
CUSTOM_TRIGGER_SUBSCRIPTION_SECRET=replace-with-a-long-random-secret

# Required by the existing app and used to HMAC-hash and encrypt webhook tokens.
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://...
```

## Public endpoint contract

The integration page requests:

```text
GET /api/custom-trigger/webhook?locationId=LOCATION_ID
```

The server verifies that the location is installed, provisions a URL if necessary, and returns a response similar to:

```json
{
  "success": true,
  "locationId": "LOCATION_ID",
  "webhookUrl": "https://YOUR_BACKEND_DOMAIN/webhooks/hfwh_...",
  "status": "ready",
  "bindingCount": 1,
  "bindings": []
}
```

External systems send the complete event payload without an Authorization header:

```text
POST https://YOUR_BACKEND_DOMAIN/webhooks/hfwh_...
Content-Type: application/json
```

The URL token is the credential. The token is high entropy, unique per location, stored encrypted at rest, and looked up using an HMAC hash. The public request is never routed using the payload’s `client` field.

The endpoint returns `202` when all active HighLevel workflow deliveries succeed, `409` when the URL exists but no active workflow binding has been received, `502` when at least one HighLevel delivery fails, and `404` for an unknown or rotated token.

## Database migration

Apply `drizzle/0003_custom_trigger_webhooks.sql` to the production PostgreSQL database. The location token must have the `locations/customValues.write` scope so the app can create or update `homeflow_webhook`. The snapshot should still include this custom value so its display name and merge-field setup are consistent. The migration creates:

- `custom_trigger_webhooks`, which stores one encrypted public token per location.
- `custom_trigger_bindings`, which stores the per-workflow HighLevel `targetUrl` and lifecycle status.

The webhook URL can be rotated with:

```text
POST /api/custom-trigger/webhook/rotate
Content-Type: application/json

{"locationId":"LOCATION_ID"}
```

After rotation, the old URL is immediately invalid and external senders must be updated.

## SaaS onboarding verification

HighLevel documents that SaaS checkout automatically creates the sub-account and applies an attached snapshot. The implementation also provisions the public URL after the location installation webhook succeeds, and the integration page provisions it on first load as a fallback.

Before production rollout, create one test SaaS account and verify that the destination workflow is published/active, the custom trigger is visible, the Subscription URL receives `CREATED`, the integration page displays the URL, and a sample POST reaches the workflow. HighLevel’s public documentation confirms snapshot and Premium Feature provisioning but does not guarantee the exact publication state of every snapshot-loaded workflow, so this final check is required.
