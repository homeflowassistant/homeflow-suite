import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { ghlRouter } from "./routers/ghl";
import { requestSchedulingRouter } from "./routers/requestScheduling";
import { reactivationRouter } from "./routers/reactivation";
import { addOnCampaignRouter } from "./routers/addOnCampaign";
import { quickSendRouter } from "./routers/quickSend";
import { contactsRouter } from "./routers/contacts";
import { alertsNotificationsRouter } from "./routers/alertsNotifications";
import { pricingRouter } from "./routers/pricing";

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
  pricing: pricingRouter,
});

export type AppRouter = typeof appRouter;
