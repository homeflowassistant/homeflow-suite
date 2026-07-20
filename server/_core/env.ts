export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // GHL Marketplace OAuth
  ghlClientId: process.env.GHL_CLIENT_ID ?? "",
  ghlClientSecret: process.env.GHL_CLIENT_SECRET ?? "",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "",
};
