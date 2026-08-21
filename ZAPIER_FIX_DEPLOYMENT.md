# Homeflow Suite Zapier Fix

This package contains the fixes for the `/integrate` serverless invocation failure, the native-ESM Vercel module-resolution error, and the Add Contact field-parity update.

## Files to copy

Copy the archive contents over the matching paths in your local `homeflow-suite` repository. The corrected package includes the full `api/`, `server/`, `shared/`, and `drizzle/` source trees because native Vercel ESM requires explicit `.js` specifiers throughout the complete server dependency graph. It also includes `.env.example`, `package.json`, and the updated Zapier integration page.

The package deliberately excludes `node_modules`, `dist`, local environment files, and temporary test artifacts.

## Required Vercel environment variables

Set these server-side variables in the Vercel project for the Production environment, using the same values already used by the application where applicable:

```text
DATABASE_URL=<your PostgreSQL connection string>
JWT_SECRET=<your existing application secret>
GHL_CLIENT_ID=<your existing GHL client id>
GHL_CLIENT_SECRET=<your existing GHL client secret>
ZAPIER_INVITE_URL=https://zapier.com/developer/public-invite/240507/da63c72aee602b7838b5e5b8d6d72396/
ZAPIER_KEY_PREFIX=zap_live_
```

Keep `VITE_ZAPIER_INVITE_URL` and `VITE_ZAPIER_APP_CLI_NAME` configured as client-side variables if the page uses them. `ZAPIER_INVITE_URL` is a separate server-side variable.

## Apply the database migration

After copying the files and configuring `DATABASE_URL`, apply the committed migration from the repository root:

```bash
pnpm install
pnpm exec drizzle-kit migrate
```

Do not run this against production until `DATABASE_URL` points to the intended production database. The migration creates `zapier_connections`, including the raw-key column used by the integration page.

## Build and deploy

Run the same build used by Vercel locally first:

```bash
pnpm build
```

The build now runs `tsc --noEmit` before the Vite and server bundle steps. Then commit the copied files, push them to the deployment branch, and redeploy Vercel.

## Zapier action payload

The Zapier action should send these field names to `POST /api/zapier/contacts/upsert`:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+15551234567",
  "address1": "123 Main St",
  "city": "Austin",
  "state": "TX",
  "postalCode": "78701",
  "numberOfDogs": "2",
  "lastTimeScooped": "2026-08-22",
  "frequency": "Weekly",
  "marketingAllowed": true,
  "dnd": false,
  "tagName": "new lead (via homeflow)"
}
```

Zapier must send the connection key as the `X-Zapier-Connection-Key` header, or as the supported fallback query/body value. The backend will pass all standard fields and custom fields through the existing Homeflow contact-processing pipeline and will also apply the selected campaign tag plus the internal trigger tag.

## Validation result

The patched workspace passed `pnpm build`, including TypeScript checking. A local unbundled native-ESM simulation imported the emitted `api/index.js` successfully, proving that the previous `/var/task/server/_core/app` resolution failure is fixed. A local request against the bundled API initialized successfully and returned a handled `403` for a test location that is not installed, instead of crashing with `FUNCTION_INVOCATION_FAILED`. The repository’s existing full test suite still contains unrelated pre-existing failures in `contactsCustomField.test.ts`; those failures are not caused by this patch.
