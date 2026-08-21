import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { publicProcedure, router } from "./_core/trpc.js";
import { ghlRouter } from "./routers/ghl.js";
import { requestSchedulingRouter } from "./routers/requestScheduling.js";
import { reactivationRouter } from "./routers/reactivation.js";
import { addOnCampaignRouter } from "./routers/addOnCampaign.js";
import { quickSendRouter } from "./routers/quickSend.js";
import { contactsRouter } from "./routers/contacts.js";
import { alertsNotificationsRouter } from "./routers/alertsNotifications.js";
import { accountSetupRouter } from "./routers/accountSetup.js";
import { pricingRouter } from "./routers/pricing.js";
import { integrationsRouter } from "./routers/integrations.js";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // GHL Marketplace integration
  ghl: ghlRouter,
  requestScheduling: requestSchedulingRouter,
  reactivation: reactivationRouter,
  addOnCampaign: addOnCampaignRouter,
  quickSend: quickSendRouter,
  contacts: contactsRouter,
  alertsNotifications: alertsNotificationsRouter,
  accountSetup: accountSetupRouter,
  pricing: pricingRouter,
  integrations: integrationsRouter,
});

export type AppRouter = typeof appRouter;
