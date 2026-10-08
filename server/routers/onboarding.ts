import { eq } from "drizzle-orm";
import { z } from "zod";
import { onboardingStepStates } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import {
  getInstallation,
  getLocationCustomValues,
  getLocationPickerVariables,
  type PickerVariable,
} from "../ghl-service.js";
import { publicProcedure, router } from "../_core/trpc.js";

type RequirementKind = "custom_value" | "custom_field" | "system";
type RequirementStatus = "complete" | "incomplete" | "blocked";
type PageStatus = "complete" | "incomplete" | "blocked" | "skipped";

type Requirement = {
  id: string;
  label: string;
  kind: RequirementKind;
  aliases: string[];
  required: boolean;
  reason?: string;
};

type PageDefinition = {
  id: string;
  stepOrder: number;
  title: string;
  description: string;
  route: string;
  required: boolean;
  skippable?: boolean;
  requirements: Requirement[];
};

export type OnboardingRequirementResult = {
  id: string;
  label: string;
  kind: RequirementKind;
  key: string;
  required: boolean;
  status: RequirementStatus;
  reason: string;
};

export type OnboardingPageResult = {
  id: string;
  stepOrder: number;
  title: string;
  description: string;
  route: string;
  required: boolean;
  skippable: boolean;
  skipped: boolean;
  status: PageStatus;
  complete: boolean;
  completedCount: number;
  totalCount: number;
  missingCount: number;
  requirements: OnboardingRequirementResult[];
  reviewed?: boolean;
};

const customValue = (
  id: string,
  label: string,
  aliases: string[],
  required = true,
  reason?: string
): Requirement => ({ id, label, kind: "custom_value", aliases, required, reason });

const customField = (
  id: string,
  label: string,
  aliases: string[],
  required = true,
  reason?: string
): Requirement => ({ id, label, kind: "custom_field", aliases, required, reason });

const systemRequirement = (
  id: string,
  label: string,
  required = true,
  reason?: string
): Requirement => ({ id, label, kind: "system", aliases: [id], required, reason });

const ACCOUNT_SETUP_VALUES: Requirement[] = [
  customValue("business-name-homeflow", "Business Name (HomeFlow)", ["homeflow_business_name"]),
  customValue("business-name-company", "Business Name (Company)", ["company_name"]),
  customValue("business-owner-name", "Business Owner Name", ["homeflow_business_owner_name"]),
  customValue("business-email", "Business Email", ["business_email"]),
  customValue("business-phone", "Business Phone", ["business_phone"]),
  customValue("business-logo-homeflow", "Business Logo (HomeFlow)", ["homeflow_business_logo"]),
  customValue("business-logo-company", "Business Logo (Company)", ["company_logo"]),
  customValue("payment-link", "Payment Link", ["add_payment_link"]),
  customValue("facebook-page-link", "Facebook Page Link", ["facebook_page_link"]),
  customValue("lead-campaign-offer", "Lead Campaign Offer", ["discountfree_offer_for_lead_campaigns"]),
  customValue("reactivation-offer", "Reactivation Campaign Offer", ["discountfree_offer_for_reengagement_campaigns"]),
];

const FOLLOW_UP_VALUES: Requirement[] = [
  customValue("lead-followup-option", "Lead Follow-Up Option", ["lead_followup_options"]),
  customValue("initial-outreach-timing", "Initial Outreach Scheduling", ["initial_request_scheduling"]),
  customValue("follow-up-limit", "Follow-Up Limit", [
    "08. How Many Times Should We Follow-Up For A Review? (0, 1, 2, or 3)",
    "follow_up_limit",
    "followup_limit",
  ]),
  customField("initial-request-delay", "Initial Request Delay Contact Field", ["initial_request_delay"]),
  customField("service-type", "Service Type Contact Field", ["service_type"]),
];

const FOLLOW_UP_QUOTE_VALUES: Requirement[] = [
  customValue("quote-company-name", "Company Name", ["company_name"]),
  customValue("quote-company-logo", "Company Logo", ["company_logo", "homeflow_business_logo"]),
  customValue("quote-title", "Quote Title", ["quote_title"]),
  customValue("quote-company-description", "Company Description", ["company_description"]),
  customValue("quote-offer", "Lead Offer", ["leads_line_item_1"]),
  customValue("quote-terms-link", "Terms of Service Link", ["tos_link"]),
];

const REACTIVATION_VALUES: Requirement[] = [
  customValue("reactivation-option", "Reactivation Option", ["lead_followup_options"]),
  customValue("one-time-reactivation-timing", "One-Time Reactivation Scheduling", ["onetime_service_reactivation_scheduling"]),
];

const REACTIVATION_QUOTE_VALUES: Requirement[] = [
  customValue("reactivation-company-name", "Company Name", ["company_name"]),
  customValue("reactivation-company-logo", "Company Logo", ["company_logo", "homeflow_business_logo"]),
  customValue("reactivation-business-owner", "Business Owner Name", ["homeflow_business_owner_name"]),
  customValue("reactivation-quote-title", "Quote Title", ["quote_title"]),
  customValue("reactivation-company-image", "Company Image", ["company_image"]),
  customValue("reactivation-offer", "Reactivation Offer", ["discountfree_offer_for_reengagement_campaigns", "leads_line_item_2"]),
];

const ALERT_VALUES: Requirement[] = [
  customValue("alert-auto-reply-lead-toggle", "Auto-Reply New Lead Toggle", ["autoreplies_to_new_leads"]),
  customValue("alert-auto-reply-lead-message", "Auto-Reply New Lead Message", ["autoreply_new_lead_message"]),
  customValue("alert-auto-reply-customer-toggle", "Auto-Reply New Customer Toggle", ["autoreply_to_new_customers"]),
  customValue("alert-auto-reply-customer-message", "Auto-Reply New Customer Message", ["autoreply_new_customer_message"]),
  customValue("alert-team-lead-toggle", "Team Notification New Lead Toggle", ["internal_new_lead_notification"]),
  customValue("alert-team-lead-message", "Team Notification New Lead Message", ["teamnotification_new_lead_message"]),
  customValue("alert-team-customer-toggle", "Team Notification New Customer Toggle", ["internal_new_customer_notification"]),
  customValue("alert-team-customer-message", "Team Notification New Customer Message", ["teamnotification_new_customer_message"]),
  customValue("alert-team-phone", "Team Notification Phone", ["send_team_notification_phone"]),
  customValue("alert-team-email", "Team Notification Email", ["send_team_notification_email"]),
  customValue("alert-failed-payment-toggle", "Failed Payment Toggle", ["failed_payment_message"]),
  customValue("alert-failed-payment-message", "Failed Payment Message", ["custom_failed_payment_message"]),
  customValue("alert-skipped-job-toggle", "Skipped Job Toggle", ["skipped_job_message"]),
  customValue("alert-skipped-job-message", "Skipped Job Message", ["custom_skipped_job_message"]),
  customValue("alert-subscription-toggle", "Subscription Paused/Unpaused Toggle", ["subscription_pausedunpaused_message"]),
  customValue("alert-subscription-paused-message", "Subscription Paused Message", ["custom_subscription_pausedunpaused_message"]),
  customValue("alert-subscription-unpaused-message", "Subscription Unpaused Message", ["account_unpaused_message"]),
];

const PRICING_VALUES: Requirement[] = [
  customValue("pricing-initial-recurring", "Initial and Recurring Pricing", ["initial_and_recurring_pricing"]),
  customValue("pricing-one-time", "One-Time Pricing", ["onetime_pricing"]),
  customValue("pricing-add-ons", "Add-On Pricing", ["add_on_pricing"]),
];

/** The two removed cards are intentionally absent from this list. */
const PAGE_DEFINITIONS: PageDefinition[] = [
  {
    id: "account-setup",
    stepOrder: 1,
    title: "Account Setup",
    description: "Business name, owner, contact details, logo, links, and campaign offers.",
    route: "/account-setup",
    required: true,
    requirements: ACCOUNT_SETUP_VALUES,
  },
  {
    id: "pricing",
    stepOrder: 2,
    title: "Pricing",
    description: "Initial, one-time, recurring, premium-area, and add-on pricing content.",
    route: "/pricing",
    required: true,
    requirements: PRICING_VALUES,
  },
  {
    id: "request-scheduling",
    stepOrder: 3,
    title: "Follow Up",
    description: "Select the lead follow-up path and timing, complete its supporting fields, or skip this campaign.",
    route: "/request-scheduling",
    required: true,
    skippable: true,
    requirements: FOLLOW_UP_VALUES,
  },
  {
    id: "reactivation",
    stepOrder: 4,
    title: "Reactivation",
    description: "Select the past-customer campaign and one-time outreach timing, or skip this campaign.",
    route: "/reactivation",
    required: true,
    skippable: true,
    requirements: REACTIVATION_VALUES,
  },
  {
    id: "add-on-campaign",
    stepOrder: 5,
    title: "Add-On Campaign",
    description: "Configure the add-on campaign duration if this feature will be used, or skip it.",
    route: "/add-on-campaign",
    required: true,
    skippable: true,
    requirements: [customValue("add-on-duration", "Add-On Duration", ["addon_duration"])],
  },
  {
    id: "alerts-notifications",
    stepOrder: 6,
    title: "Alerts & Notifications",
    description: "Configure notification controls and messages if these alerts will be used, or skip them.",
    route: "/alerts-notifications",
    required: true,
    skippable: true,
    requirements: ALERT_VALUES,
  },
  {
    id: "integrations",
    stepOrder: 7,
    title: "Integrations",
    description: "Complete the connection required by the selected workflow and review provider status.",
    route: "/integrations",
    required: true,
    requirements: [
      customValue("integration-webhook", "HomeFlow Webhook URL", ["homeflow_webhook"]),
      customValue("integration-access-token", "Sweep & Go Access Token", ["sg_authorization_key_access_token"]),
    ],
  },
  {
    id: "zapier",
    stepOrder: 8,
    title: "Zapier Integration",
    description: "Optional Zapier connection and custom-trigger workflow setup.",
    route: "/integrations",
    required: false,
    skippable: true,
    requirements: [],
  },
];

function normalizeKey(value: string): string {
  return value
    .trim()
    .replace(/\{\{\s*custom_values\./gi, "")
    .replace(/\{\{\s*contact\./gi, "")
    .replace(/\}\}/g, "")
    .replace(/^custom_values\./i, "")
    .replace(/^contact\./i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function rawEntryKeys(entry: Record<string, unknown>): string[] {
  return [entry.fieldKey, entry.key, entry.name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizeKey);
}

function rawEntryValue(entry: Record<string, unknown>): string {
  const value = entry.value;
  return value === undefined || value === null ? "" : String(value).trim();
}

function findCustomValue(customValues: Record<string, unknown>[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeKey).filter(Boolean);
  for (const entry of customValues) {
    const keys = rawEntryKeys(entry);
    const matched = keys.some(candidate => normalizedAliases.some(alias =>
      candidate === alias || candidate.includes(alias) || alias.includes(candidate)
    ));
    if (matched) return { found: true, value: rawEntryValue(entry) };
  }
  return { found: false, value: "" };
}

function findCustomField(fields: PickerVariable[], aliases: string[]): boolean {
  const normalizedAliases = aliases.map(normalizeKey).filter(Boolean);
  return fields.some(field => {
    const keys = [field.fieldKey, field.name].map(normalizeKey);
    return keys.some(candidate => normalizedAliases.some(alias =>
      candidate === alias || candidate.includes(alias) || alias.includes(candidate)
    ));
  });
}

function isCustomQuoteSelected(customValues: Record<string, unknown>[]): boolean {
  const selected = findCustomValue(customValues, ["lead_followup_options"]);
  const value = selected.value.toLowerCase().replace(/[\s_]+/g, "-");
  return value.includes("custom") && value.includes("link");
}

function getPageRequirements(page: PageDefinition, customValues: Record<string, unknown>[]): Requirement[] {
  if (page.id === "request-scheduling" && isCustomQuoteSelected(customValues)) {
    return [...page.requirements, ...FOLLOW_UP_QUOTE_VALUES];
  }
  if (page.id === "reactivation" && isCustomQuoteSelected(customValues)) {
    return [...page.requirements, ...REACTIVATION_QUOTE_VALUES];
  }
  return page.requirements;
}

function isPricingPlaceholder(value: string): boolean {
  return /\$\s*X{2}(?:\.X{2})?/i.test(value) || /\b(?:xx|xx\.xx)\b/i.test(value);
}

export function buildOnboardingResults(options: {
  customValues: Record<string, unknown>[];
  customFields: PickerVariable[];
  customValuesAvailable: boolean;
  customFieldsAvailable: boolean;
  connected: boolean;
  reviewed?: boolean;
  skippedStepIds?: Set<string>;
  sourceError?: string;
}): OnboardingPageResult[] {
  return PAGE_DEFINITIONS.map(page => {
    const skipped = Boolean(page.skippable && options.skippedStepIds?.has(page.id));
    const requirements = getPageRequirements(page, options.customValues);
    const results = requirements.map(requirement => {
      if (!options.connected) {
        return {
          id: requirement.id,
          label: requirement.label,
          kind: requirement.kind,
          key: requirement.aliases[0],
          required: requirement.required,
          status: "blocked" as const,
          reason: "HomeFlow is not connected to this GHL location.",
        };
      }
      if (requirement.kind === "custom_value") {
        if (!options.customValuesAvailable) {
          return {
            id: requirement.id,
            label: requirement.label,
            kind: requirement.kind,
            key: requirement.aliases[0],
            required: requirement.required,
            status: "blocked" as const,
            reason: options.sourceError || "Unable to read GHL Custom Values right now.",
          };
        }
        const match = findCustomValue(options.customValues, requirement.aliases);
        const usable = Boolean(match.found && match.value && !(page.id === "pricing" && isPricingPlaceholder(match.value)));
        return {
          id: requirement.id,
          label: requirement.label,
          kind: requirement.kind,
          key: requirement.aliases[0],
          required: requirement.required,
          status: usable ? ("complete" as const) : ("incomplete" as const),
          reason: match.found
            ? usable
              ? "Configured"
              : page.id === "pricing" && match.value && isPricingPlaceholder(match.value)
                ? "Pricing contains a placeholder value and must be completed before testing."
                : requirement.reason || "Custom Value exists but is empty."
            : requirement.reason || "Custom Value is missing from this GHL location.",
        };
      }
      if (requirement.kind === "system") {
        const reviewed = requirement.id === "review-acknowledgment" && options.reviewed;
        return {
          id: requirement.id,
          label: requirement.label,
          kind: requirement.kind,
          key: requirement.aliases[0],
          required: requirement.required,
          status: reviewed ? ("complete" as const) : ("incomplete" as const),
          reason: reviewed ? "Final review acknowledged." : requirement.reason || "This check has not been completed.",
        };
      }
      if (!options.customFieldsAvailable) {
        return {
          id: requirement.id,
          label: requirement.label,
          kind: requirement.kind,
          key: requirement.aliases[0],
          required: requirement.required,
          status: "blocked" as const,
          reason: options.sourceError || "Unable to read GHL Contact Custom Fields right now.",
        };
      }
      const found = findCustomField(options.customFields, requirement.aliases);
      return {
        id: requirement.id,
        label: requirement.label,
        kind: requirement.kind,
        key: requirement.aliases[0],
        required: requirement.required,
        status: found ? ("complete" as const) : ("incomplete" as const),
        reason: found ? "Custom Field exists" : "Contact Custom Field is missing from this GHL location.",
      };
    });
    const blockingResults = page.required ? results.filter(result => result.required) : results;
    const completeCount = results.filter(result => result.status === "complete").length;
    const missingCount = results.filter(result => result.status !== "complete").length;
    const status: PageStatus = skipped
      ? "skipped"
      : !options.connected || blockingResults.some(result => result.status === "blocked")
        ? "blocked"
        : page.skippable && results.length === 0
          ? "incomplete"
          : blockingResults.some(result => result.status !== "complete")
            ? "incomplete"
            : "complete";
    return {
      id: page.id,
      stepOrder: page.stepOrder,
      title: page.title,
      description: page.description,
      route: page.route,
      required: page.required,
      skippable: Boolean(page.skippable),
      skipped,
      status,
      complete: status === "complete",
      completedCount: completeCount,
      totalCount: results.length,
      missingCount,
      requirements: results,
      reviewed: undefined,
    };
  });
}

async function persistStepSnapshots(locationId: string, pages: OnboardingPageResult[]) {
  try {
    const db = await getDb();
    if (!db) return;
    const checkedAt = new Date();
    for (const page of pages) {
      const missing = page.requirements
        .filter(requirement => requirement.status !== "complete")
        .map(requirement => ({ id: requirement.id, label: requirement.label, status: requirement.status, reason: requirement.reason }));
      const state = page.skipped ? "skipped" : page.status;
      await db
        .insert(onboardingStepStates)
        .values({
          locationId,
          stepId: page.id,
          state,
          completedCount: page.completedCount,
          totalCount: page.totalCount,
          missingRequirementsJson: JSON.stringify(missing),
          lastReason: missing[0]?.reason || "All step checks passed.",
          checkedAt,
          completedAt: page.status === "complete" ? checkedAt : null,
          skippedAt: page.skipped ? checkedAt : null,
          reviewed: Boolean(page.reviewed),
          updatedAt: checkedAt,
        })
        .onConflictDoUpdate({
          target: [onboardingStepStates.locationId, onboardingStepStates.stepId],
          set: {
            state,
            completedCount: page.completedCount,
            totalCount: page.totalCount,
            missingRequirementsJson: JSON.stringify(missing),
            lastReason: missing[0]?.reason || "All step checks passed.",
            checkedAt,
            completedAt: page.status === "complete" ? checkedAt : null,
            skippedAt: page.skipped ? checkedAt : null,
            reviewed: Boolean(page.reviewed),
            updatedAt: checkedAt,
          },
        });
    }
  } catch (error) {
    console.warn("[Onboarding] Failed to persist step snapshots:", error);
  }
}

export const onboardingRouter = router({
  getStatus: publicProcedure
    .input(z.object({ locationId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      let skippedStepIds = new Set<string>();
      let reviewed = false;
      try {
        const db = await getDb();
        if (db) {
          const rows = await db
            .select({ stepId: onboardingStepStates.stepId, state: onboardingStepStates.state, reviewed: onboardingStepStates.reviewed })
            .from(onboardingStepStates)
            .where(eq(onboardingStepStates.locationId, locationId));
          skippedStepIds = new Set(rows.filter(row => row.state === "skipped").map(row => row.stepId));
          reviewed = rows.some(row => row.reviewed || (row.stepId === "review-test" && row.state === "reviewed"));
        }
      } catch (error) {
        console.warn("[Onboarding] Failed to read step history:", error);
      }

      let connected = false;
      try {
        connected = Boolean(await getInstallation(locationId));
      } catch (error) {
        console.warn("[Onboarding] Failed to read GHL installation:", error);
      }

      if (!connected) {
        const pages = buildOnboardingResults({
          customValues: [],
          customFields: [],
          customValuesAvailable: false,
          customFieldsAvailable: false,
          connected: false,
          reviewed,
          skippedStepIds,
        });
        await persistStepSnapshots(locationId, pages);
        return {
          locationId,
          connected: false,
          fetchedAt: new Date().toISOString(),
          overallStatus: "blocked" as const,
          progress: { completed: 0, total: pages.filter(page => page.required).reduce((sum, page) => sum + page.totalCount, 0), percentage: 0 },
          pages,
          sourceStatus: { customValues: "blocked" as const, customFields: "blocked" as const },
        };
      }

      const [customValuesResult, pickerResult] = await Promise.allSettled([
        getLocationCustomValues(locationId),
        getLocationPickerVariables(locationId),
      ]);
      const customValuesAvailable = customValuesResult.status === "fulfilled";
      const customFieldsAvailable = pickerResult.status === "fulfilled" && pickerResult.value.sourceStatus.contactCustomFields === "success";
      const customValues = customValuesAvailable ? customValuesResult.value : [];
      const customFields = pickerResult.status === "fulfilled"
        ? pickerResult.value.items.filter(item => item.source === "contact_custom_field")
        : [];
      const sourceError = customValuesResult.status === "rejected"
        ? customValuesResult.reason instanceof Error ? customValuesResult.reason.message : "GHL Custom Values request failed."
        : pickerResult.status === "rejected"
          ? pickerResult.reason instanceof Error ? pickerResult.reason.message : "GHL Custom Fields request failed."
          : undefined;
      const pages = buildOnboardingResults({
        customValues,
        customFields,
        customValuesAvailable,
        customFieldsAvailable,
        connected,
        reviewed,
        skippedStepIds,
        sourceError,
      });
      await persistStepSnapshots(locationId, pages);
      const requiredChecks = pages
        .filter(page => page.required && !page.skipped)
        .flatMap(page => page.requirements.filter(requirement => requirement.required));
      const completed = requiredChecks.filter(requirement => requirement.status === "complete").length;
      const total = requiredChecks.length;
      const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
      const overallStatus = pages.some(page => page.required && page.status === "blocked")
        ? "blocked"
        : requiredChecks.some(requirement => requirement.status !== "complete")
          ? "in_progress"
          : "ready";
      return {
        locationId,
        connected: true,
        fetchedAt: new Date().toISOString(),
        overallStatus,
        progress: { completed, total, percentage },
        pages,
        sourceStatus: {
          customValues: customValuesAvailable ? "success" as const : "error" as const,
          customFields: customFieldsAvailable ? "success" as const : "error" as const,
        },
      };
    }),

  recordProgress: publicProcedure
    .input(z.object({
      locationId: z.string().trim().min(1),
      stepId: z.string().trim().min(1),
      state: z.enum(["complete", "incomplete", "blocked", "skipped"]),
      completedCount: z.number().int().min(0),
      totalCount: z.number().int().min(0),
      missingRequirementsJson: z.string().max(100000).optional(),
      lastReason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const page = PAGE_DEFINITIONS.find(item => item.id === input.stepId);
      if (!page) throw new Error(`Unknown onboarding step '${input.stepId}'.`);
      const db = await getDb();
      if (!db) throw new Error("Onboarding progress cannot be saved because the database is unavailable.");
      const now = new Date();
      await db
        .insert(onboardingStepStates)
        .values({
          locationId: input.locationId,
          stepId: input.stepId,
          state: input.state,
          completedCount: input.completedCount,
          totalCount: input.totalCount,
          missingRequirementsJson: input.missingRequirementsJson || "[]",
          lastReason: input.lastReason || "Step opened but not yet complete.",
          checkedAt: now,
          completedAt: input.state === "complete" ? now : null,
          skippedAt: input.state === "skipped" ? now : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [onboardingStepStates.locationId, onboardingStepStates.stepId],
          set: {
            state: input.state,
            completedCount: input.completedCount,
            totalCount: input.totalCount,
            missingRequirementsJson: input.missingRequirementsJson || "[]",
            lastReason: input.lastReason || "Step opened but not yet complete.",
            checkedAt: now,
            completedAt: input.state === "complete" ? now : null,
            skippedAt: input.state === "skipped" ? now : null,
            updatedAt: now,
          },
        });
      return { success: true, stepId: input.stepId, state: input.state } as const;
    }),

  setStepState: publicProcedure
    .input(z.object({
      locationId: z.string().trim().min(1),
      stepId: z.string().trim().min(1),
      state: z.enum(["active", "skipped"]),
    }))
    .mutation(async ({ input }) => {
      const page = PAGE_DEFINITIONS.find(item => item.id === input.stepId);
      if (!page) throw new Error(`Unknown onboarding step '${input.stepId}'.`);
      if (!page.skippable) throw new Error(`Onboarding step '${input.stepId}' cannot be skipped.`);
      const db = await getDb();
      if (!db) throw new Error("Onboarding step state cannot be saved because the database is unavailable.");
      const now = new Date();
      await db
        .insert(onboardingStepStates)
        .values({
          locationId: input.locationId,
          stepId: input.stepId,
          state: input.state === "skipped" ? "skipped" : "incomplete",
          skippedAt: input.state === "skipped" ? now : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [onboardingStepStates.locationId, onboardingStepStates.stepId],
          set: {
            state: input.state === "skipped" ? "skipped" : "incomplete",
            skippedAt: input.state === "skipped" ? now : null,
            updatedAt: now,
          },
        });
      return { success: true, stepId: input.stepId, state: input.state } as const;
    }),

  acknowledgeReview: publicProcedure
    .input(z.object({ locationId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Final review cannot be saved because the database is unavailable.");
      const now = new Date();
      await db
        .insert(onboardingStepStates)
        .values({ locationId: input.locationId, stepId: "review-test", state: "incomplete", reviewed: true, updatedAt: now })
        .onConflictDoUpdate({
          target: [onboardingStepStates.locationId, onboardingStepStates.stepId],
          set: { reviewed: true, updatedAt: now },
        });
      return { success: true } as const;
    }),
});
