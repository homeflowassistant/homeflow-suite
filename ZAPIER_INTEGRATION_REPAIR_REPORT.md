# HomeFlow Zapier Integration Repair Report

## Scope

The Royal Review repository was cloned and inspected as the working reference. HomeFlow Suite was then compared against it across the embedded integration page, location-ID propagation, token generation and storage, authorization, GHL OAuth token lookup and refresh, database schema, Zapier authentication, contact upsert behavior, and Vercel serverless bootstrap.

## Root cause of `FUNCTION_INVOCATION_FAILED`

The HomeFlow latest commit had converted the server dependency graph to native-ESM-style imports with explicit `.js` specifiers, but one import remained inconsistent in `server/_core/app.ts`:

```ts
const { serveStatic } = await import("./vite");
```

Royal Review uses the native-ESM-safe form:

```ts
const { serveStatic } = await import("./vite.js");
```

Because `api/index.ts` imports `createApp()` during Vercel function initialization, the unresolved extensionless dynamic import was part of the serverless module graph. The function could therefore fail before Express registered `/api/zapier/connection/rotate`, producing Vercel’s generic `500 FUNCTION_INVOCATION_FAILED` rather than an application-level JSON response. The import was changed to `./vite.js`, matching Royal Review and the rest of HomeFlow’s server graph.

The latest HomeFlow commit also removed the complete client and deployment scaffold while leaving `package.json` configured to use `patches/wouter@3.7.1.patch`. A clean `pnpm install --frozen-lockfile` consequently failed because that patch file was absent. The deleted application/deployment files were restored from the immediate parent commit so the existing HomeFlow functionality and the `/integrate` route remain deployable. The restored files include the full Add Contact page, the complete client application, `vercel.json`, `vite.config.ts`, TypeScript configuration, the lockfile, and the referenced patch.

## Reference flow confirmed from Royal Review

The integration page reads `locationId` from the embedded page query string and sends it to the backend as either `GET /api/zapier/connection?locationId=...` or JSON `{ "locationId": "..." }` for rotate and revoke. The backend first requires an installed GHL location, then creates or rotates a per-location Zapier key in a database transaction. The raw key is returned only when it is first generated or rotated; its HMAC-SHA256 hash is used for validation, while the raw key is retained for later copying by the integration page.

Zapier sends the key in `X-Zapier-Connection-Key`, with query/body fallbacks supported for compatibility. The authentication test resolves the active connection, confirms the HomeFlow/GHL installation, refreshes the GHL access token when needed, records `lastUsedAt`, and returns the resolved location details. Contact upserts reuse the application’s GHL contact-processing path instead of creating a separate credential or API-key path.

## Applied changes

| Area | Change |
| --- | --- |
| Vercel/native ESM bootstrap | Changed `await import("./vite")` to `await import("./vite.js")` in `server/_core/app.ts`. |
| Existing HomeFlow functionality | Restored the full client and deployment scaffold removed by the latest cleanup commit. |
| Zapier contact compatibility | Preserved Royal Review’s `customFields: [{ key, value }]` payload contract in HomeFlow’s Zapier route. |
| HomeFlow Add Contact parity | Continued forwarding first name, last name, email, phone, street address, city, state, ZIP/postal code, number of dogs, last time scooped, clean-up frequency, campaign tag, DND, and marketing consent. |
| Custom-field forwarding | Normalized and forwarded arbitrary Royal-compatible custom fields alongside HomeFlow’s explicit fields. |
| Marketing consent | Sends `marketing_allowed` as `Yes` or `No` when Zapier supplies the consent field, instead of silently dropping an explicit false value. |
| Token persistence | Kept the existing `zapier_connections` transaction, active-key rotation, hash validation, raw-key copy, and revoke behavior unchanged. |

## Files changed or restored

The primary source changes are:

- `server/_core/app.ts`
- `server/routes/zapier.ts`
- `server/services/zapier-service.ts`

The repository also restores the application/deployment files deleted by the latest commit, including the Add Contact page and form, `vercel.json`, `vite.config.ts`, `tsconfig.json`, `pnpm-lock.yaml`, and `patches/wouter@3.7.1.patch`.

## Validation performed

| Check | Result |
| --- | --- |
| Clean dependency installation | Passed with `pnpm install --frozen-lockfile`. |
| TypeScript | Passed with `pnpm check`. |
| Production build | Passed with `pnpm build`; Vite and the server bundle completed. |
| Native-ESM API import | Passed by bundling `api/index.ts` and importing the result from within the repository. |
| Local HTTP route smoke test | Passed; a test location reached the route and received handled `403 { success: false, message: ... }` because no local GHL installation/database was configured, proving the handler initialized instead of crashing. |
| Focused existing test | Passed: `server/routers/integrations.test.ts` (2 tests). |
| Full existing test suite | Not fully green because the repository contains 18 pre-existing failures in `server/routes/contactsCustomField.test.ts`; these failures are unrelated to the Zapier route and were not changed. |

A real production `200` token rotation, database write, GHL token refresh, Zapier auth test, and contact creation require the production `DATABASE_URL`, `JWT_SECRET`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, and a valid installed GHL location. Those credentials were not available in the sandbox, so production-side end-to-end effects could not be executed here. Before deployment, apply `drizzle/0002_zapier_connections.sql` to the intended production database and configure the variables documented in `.env.example` and `ZAPIER_FIX_DEPLOYMENT.md`.
