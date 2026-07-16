# Project TODO

- [x] Create GHL OAuth tokens database table (store access_token, refresh_token, locationId, companyId, expires_at)
- [x] Implement backend OAuth callback endpoint to exchange auth code for tokens
- [x] Implement automatic token refresh logic (refresh before expiry)
- [x] Create backend API proxy endpoints for GHL API (create contact, add to workflow)
- [x] Restore and update SingleContactForm component (use backend proxy instead of direct API calls)
- [x] Restore and update CSVUploadFlow component (use backend proxy instead of direct API calls)
- [x] Restore ColumnMapping component
- [x] Restore ReviewConfirm component
- [x] Remove SettingsDialog (no longer needed with OAuth)
- [x] Update Home page with two-panel layout (single contact left, CSV upload right)
- [x] Add connection status indicator (show if GHL is connected via OAuth)
- [x] Write vitest tests for OAuth token exchange and refresh
- [x] Write vitest tests for contact creation API proxy
- [x] Update index.css with Royal Review green theme
- [x] Write comprehensive GHL Marketplace registration and publishing guide
- [x] Add vitest unit tests for exchangeCodeForTokens success/failure responses using mocked fetch
- [x] Add vitest unit tests for refreshAccessToken and getValidAccessToken refresh-before-expiry behavior
