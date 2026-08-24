# HomeFlow Zapier Location Installation Fix

The false installation message came from two separate location-ID assumptions in the Zapier flow. The Zapier page only read `locationId`, while the working HomeFlow integration page accepts both `locationId` and `location_id`. GHL embeds can provide the latter form, so the Zapier page could send the wrong or empty location context even though the other pages appeared to work.

The Zapier client now accepts `locationId`, `location_id`, `location.id`, and `subAccountId`, and uses the last stored live location only when the URL contains none of those values. The Zapier connection, rotate, revoke, and legacy contact endpoints normalize the same aliases on the server.

The GHL install webhook now accepts camelCase and snake_case location/company identifiers, including nested `location.id` and `company.id` values. This prevents a valid reinstall event from being ignored before the location-specific token row is stored. When the Zapier lookup still cannot find a row, the response now includes the normalized location ID and the server logs that exact ID, making a database/webhook problem distinguishable from a URL-parameter problem.

The Zapier installation guard now distinguishes three cases: missing `DATABASE_URL`, a database query failure, and a successful query with no row for the normalized location ID. The last case alone returns the installation-not-found response.

## Separate Vercel frontend and Render backend

The HomeFlow deployment uses a Vercel frontend and a Render backend. The main client bootstrap sends tRPC traffic to `VITE_API_URL` when configured, but the old Zapier page used relative `/api/zapier/...` requests. In production, those relative requests are handled by the Vercel origin and may query a different or unconfigured database, which explains why other HomeFlow pages can work while Zapier reports no installation. The Zapier page now uses the same `VITE_API_URL` base for connection, rotation, and revoke calls.

Set this variable in the Vercel project for the Production environment, using the actual Render backend URL without a trailing `/api`:

```text
VITE_API_URL=https://<your-render-service>.onrender.com
```

Then redeploy the Vercel frontend. In the browser Network panel, the Zapier request should go to `https://<your-render-service>.onrender.com/api/zapier/connection?...`, not to `https://<your-vercel-app>.vercel.app/api/...`. On Render, keep `DATABASE_URL` pointed at the Supabase PostgreSQL project containing `public.ghl_installations`.

A clean type check and production build passed after these changes. A local request using `?location_id=test-location` reached the Zapier route and produced the expected handled application response rather than a missing-route or serverless invocation failure. A real successful connection requires the production database to contain a `ghl_installations` row for the exact GHL sub-account location ID and the Render service to use that same Supabase database. If the new response shows the correct location ID but still returns 403, inspect Render logs for the GHL INSTALL webhook and `/oauth/locationToken` exchange; reinstalling the app alone is not sufficient if that webhook failed or the location-token exchange did not complete.
