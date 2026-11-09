import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context.js";
import { checkLocationAccess } from "./ghlSso.js";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * Procedures that act on a HighLevel location. The `locationId` in the input
 * must be one the caller's HomeFlow SSO session is allowed to use (see
 * ghlSso.ts). No-op until GHL_APP_SSO_KEY is configured.
 */
const requireLocationAccess = t.middleware(async opts => {
  const { ctx, next } = opts;
  const rawInput = (await opts.getRawInput()) as
    | { locationId?: unknown }
    | null
    | undefined;
  const locationId =
    rawInput && typeof rawInput.locationId === "string"
      ? rawInput.locationId
      : undefined;

  const access = await checkLocationAccess(ctx.req, locationId);
  if (!access.ok) {
    throw new TRPCError({
      code: access.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      message: access.message,
    });
  }
  return next();
});

export const locationProcedure = t.procedure.use(requireLocationAccess);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
