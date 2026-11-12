export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  // Immutable key of the separate HighLevel Marketplace trigger used by n8n.
  n8nCustomTriggerKey: process.env.N8N_CUSTOM_TRIGGER_KEY ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // GHL Marketplace OAuth
  ghlClientId: process.env.GHL_CLIENT_ID ?? "",
  ghlClientSecret: process.env.GHL_CLIENT_SECRET ?? "",
  // Marketplace app "Shared Secret" used to decrypt HighLevel SSO payloads.
  // When set, location-scoped endpoints require a HomeFlow session.
  ghlSsoKey: (process.env.GHL_APP_SSO_KEY ?? "").trim(),
  // enforce (default when the SSO key is set) | report (log only) | off
  authMode: process.env.HOMEFLOW_AUTH_MODE ?? "enforce",
  // PEM public key HighLevel uses to sign webhooks (x-wh-signature). When
  // set, unsigned or invalid /api/ghl/webhook requests are rejected.
  ghlWebhookPublicKey: (process.env.GHL_WEBHOOK_PUBLIC_KEY ?? "")
    .replace(/\\n/g, "\n")
    .trim(),
  // Shared secret for the Marketplace SMS custom action endpoints. When set,
  // requests must send it as X-Homeflow-Action-Secret or ?secret=.
  customActionSecret: (process.env.GHL_CUSTOM_ACTION_SECRET ?? "").trim(),
  // Zapier private app integration
  zapierInviteUrl: process.env.ZAPIER_INVITE_URL ?? "",
  zapierKeyPrefix: process.env.ZAPIER_KEY_PREFIX ?? "zap_live_",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "",
  // n8n webhook (secret; set on Render) that receives GHL workflow "Webhook" actions relayed through
  // each sub-account's /webhooks/<token> URL. Relay is off when unset.
  ghlWorkflowN8nWebhookUrl: process.env.GHL_WORKFLOW_N8N_WEBHOOK_URL ?? "",
  customTriggerWebhookBaseUrl:
    process.env.CUSTOM_TRIGGER_WEBHOOK_BASE_URL ??
    process.env.APP_DOMAIN ??
    process.env.VITE_API_URL ??
    "https://homeflow-suite.vercel.app",
  customTriggerSubscriptionSecret:
    process.env.CUSTOM_TRIGGER_SUBSCRIPTION_SECRET ?? "",
  appDomain:
    process.env.APP_DOMAIN ??
    process.env.VITE_API_URL ??
    "https://homeflow-suite.vercel.app",
};
