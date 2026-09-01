# Custom Trigger Webhook Implementation Report

## Implemented

The application now provisions one stable public webhook URL per installed HighLevel location, stores its token encrypted at rest, and resolves incoming requests by token rather than by any payload field. The public endpoint accepts unauthenticated JSON POST requests and forwards the complete payload to every active HighLevel Marketplace custom-trigger `targetUrl` bound to that location.

The HighLevel Marketplace Subscription URL callback is implemented at `/api/ghl/custom-trigger/subscription`. It accepts `CREATED`, `UPDATED`, and `DELETED` lifecycle events, validates the destination HighLevel execution URL, and stores the binding using `locationId`, `workflowId`, and trigger key.

The location-facing API is `GET /api/custom-trigger/webhook?locationId=...`. It verifies that the app is installed, provisions a URL if necessary, and returns the URL plus binding status. The active integration page is `client/src/pages/ZapierIntegrationPage.tsx`; it now displays a read-only URL with Copy URL and Refresh controls.

The app-install flow also provisions the URL after a successful location-token exchange. This makes the URL available before the first page visit while retaining page-load provisioning as a fallback. Every provision, repair, or rotation now synchronizes the same URL into the existing GHL custom value `homeflow_webhook`, which is the value read by the integration page’s Webhook URL field. The sync uses HighLevel’s supported `POST /locations/:locationId/customValues` create operation when the value is missing, and `PUT` when it already exists.

## Changed files

| File | Purpose |
|---|---|
| `.env.example` | Documents the public webhook origin and callback secret. |
| `render.yaml` | Adds production environment variable slots. |
| `drizzle/schema.ts` | Adds webhook and HighLevel binding models. |
| `drizzle/0003_custom_trigger_webhooks.sql` | Adds the PostgreSQL tables and indexes. |
| `server/_core/env.ts` | Loads the new environment variables. |
| `server/_core/app.ts` | Mounts the custom-trigger routes. |
| `server/ghl-oauth.ts` | Provisions a URL after location installation. |
| `server/ghl-service.ts` | Adds the supported create-or-update custom-value helper for `homeflow_webhook`. |
| `server/services/custom-trigger-service.ts` | Token generation, encryption, lookup, binding lifecycle, and HighLevel delivery. |
| `server/routes/customTrigger.ts` | Subscription, management, rotation, and public webhook endpoints. |
| `client/src/pages/ZapierIntegrationPage.tsx` | Displays and copies the per-location URL. |
| `server/services/custom-trigger-service.test.ts` | Tests token and target URL primitives. |
| `CUSTOM_TRIGGER_SETUP.md` | Setup and deployment instructions. |

## Required production configuration

Set `CUSTOM_TRIGGER_WEBHOOK_BASE_URL` to the public backend origin, set a long random `JWT_SECRET`, and set `CUSTOM_TRIGGER_SUBSCRIPTION_SECRET`. Configure the same subscription secret in the HighLevel Marketplace custom trigger’s Subscription URL headers as `X-Homeflow-Subscription-Secret`. Apply the SQL migration before starting the application.

The HighLevel custom trigger must be approved/published, included in the source snapshot, attached to a published source workflow, and available in the destination account through Marketplace app installation. Premium Workflow Triggers must also be enabled for the SaaS plan/account. The location token must include the `locations/customValues.write` scope so `homeflow_webhook` can be created or updated.

## Validation

`pnpm check` passed. `pnpm build` passed. The focused custom-trigger and existing integrations tests passed: 5 tests total. The repository-wide test command was also run; 18 pre-existing tests in `server/routes/contactsCustomField.test.ts` failed with unrelated custom-field/contact lookup expectations, while the two focused files passed. No custom-trigger test failed.

A real HighLevel/SaaS end-to-end test still needs to be run with production credentials and a test account to confirm the exact timing of the `CREATED` Subscription URL callback during snapshot application, that `homeflow_webhook` is created/updated in the destination account, and that the destination workflow is published/active after provisioning.

The delivered repository ZIP includes the `.git` directory and therefore preserves the original repository history/comments and the new working-tree changes. The patch file is provided separately for review or application to another clone.
