# Deploying "Addcontact" to Vercel

This document explains how to deploy the Royal Review — Add Contacts app to Vercel as a project named `Addcontact`.

High-level options
- Deploy frontend and backend together using Vercel (server as a serverless function). The repository includes a suggested `vercel.json` that maps `/api/*` to a Node function and serves the built client.

Prerequisites
- Install Vercel CLI: `npm i -g vercel`
- Ensure environment variables are available (see below).

Required environment variables
- `GHL_CLIENT_ID` — from GHL Marketplace app registration
- `GHL_CLIENT_SECRET` — from GHL Marketplace app registration
- `DATABASE_URL` — MySQL connection string used by Drizzle
- `JWT_SECRET` — used by the app for session signing
- Optional: `OAUTH_SERVER_URL`, `BUILT_IN_FORGE_API_KEY`, etc.

Important: OAuth Redirect URI

When registering the app in the GHL Marketplace, set the OAuth Redirect URI to:

  https://<YOUR_VERCEL_PROJECT_DOMAIN>/api/ghl/oauth/callback

Replace `<YOUR_VERCEL_PROJECT_DOMAIN>` with your Vercel domain (for example, `addcontact.vercel.app`).

Suggested deploy steps

1. Build locally to verify:

```bash
pnpm install
pnpm build
```

2. Log in to Vercel and create a project (name it `Addcontact`):

```bash
vercel login
vercel --prod --name Addcontact
```

3. During the Vercel project setup, add the environment variables listed above in the Vercel dashboard (Settings → Environment Variables). For production, set them under the Production scope.

4. After deployment, register the Redirect URI in GHL Marketplace to `https://<your-domain>/api/ghl/oauth/callback` and install the app into the `Royal Review (Testing Account)` to test.

Notes & caveats
- The codebase runs an Express server under `server/_core/index.ts`. Vercel runs server code as serverless functions; the `vercel.json` in this repo is a suggested starting point but you may need to adapt the server to export a handler compatible with Vercel serverless functions (or add a small wrapper in `/api` that imports and calls the Express app).
- If you prefer an easier server deployment, consider hosting the server on a platform that supports long-running Node processes (Railway, Render, Fly) and deploy only the client to Vercel, pointing `/api` calls to the server URL.

Post-deploy verification
1. Install the app into the test subaccount and verify `/api/ghl/oauth/callback` completes token exchange and stores installation (check Drizzle `ghl_installations` table).
2. Open the app in GHL with `?locationId=...` and try adding a single contact and a CSV upload. Confirm non-DND contacts are enrolled into the configured workflow.
