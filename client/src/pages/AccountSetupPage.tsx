/**
 * Account Set Up Page
 *
 * New GHL sidebar item that lets clients fill in their business profile and
 * saves edited fields to the sub-account's custom values when the user clicks
 * the page Save button.
 *
 * Field → GHL custom value key mapping (order as specified by the client):
 *   Business Name            → {{custom_values.homeflow_business_name}}
 *                              + {{custom_values.company_name}} (both updated)
 *   Business Owner Name      → {{custom_values.homeflow_business_owner_name}}
 *   Business Email           → {{custom_values.business_email}}
 *   Business Phone           → {{custom_values.business_phone}}
 *   Business Logo            → {{custom_values.homeflow_business_logo}}
 *                              + {{custom_values.company_logo}} (both updated)
 *   Payment Link             → {{custom_values.add_payment_link}}
 *   Facebook Page Link       → {{custom_values.facebook_page_link}}
 *   Lead Campaign Offer      → {{custom_values.discountfree_offer_for_lead_campaigns}}
 *   Reactivation Offer       → {{custom_values.discountfree_offer_for_reengagement_campaigns}}
 *
 * Behavior (as requested in the account setup spec):
 *   - Fields are shown in the order listed above, including Business Email and Business Phone.

 *   - Values stay local while the client edits and Save pushes every field
 *     whose value has changed since the last load/save to the CRM.
 *   - A confirmation pop-up (toast) appears after a manual Save.
 *   - Images are entered as a URL (paste an image link). If a base64
 *     data URI is pasted instead, it is uploaded to the GHL Media Library
 *     and the hosted URL is stored — the same workflow the Custom Quote
 *     popup uses for its image fields.
 *   - On page open, every field is pre-filled with the freshest values
 *     currently stored in GHL (staleTime: 0, so never a stale snapshot).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Building2,
  Link2,
  Facebook,
  MapPin,
  Bell,
  ListChecks,
  Mail,
  Phone,
  CreditCard,
  UserRound,
  Image as ImageIcon,
  Tag,
  CheckCircle2,
  Loader2,
  BadgeCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import VideoHelpButton from "@/components/VideoHelpButton";
import TopSaveButton from "@/components/TopSaveButton";
import { useOnboardingSaveHandler } from "@/components/OnboardingSaveContext";

type AccountField =
  | "businessName"
  | "businessOwnerName"
  | "businessEmail"
  | "businessPhone"
  | "businessLogo"
  | "paymentLink"
  | "facebookPageLink"
  | "leadCampaignOffer"
  | "reengagementOffer"
  | "legalBusinessName"
  | "businessAddress"
  | "stateTwoLetterAbbrev"
  | "internalNotificationsEmail"
  | "internalNotificationsPhone"
  | "receiveNewLeadNotifications"
  | "onTheWayNotifications"
  | "jobCompletedNotifications"
  | "offScheduleNotifications"
  | "notificationChannel"
  | "crmSelection";

interface FieldMeta {
  key: AccountField;
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  isUrl?: boolean;
  isImage?: boolean;
  options?: { label: string; value: string }[];
  help?: string;
}

// Display order matches the order given by the client.
const FIELDS: FieldMeta[] = [
  {
    key: "businessName",
    label: "Business Name",
    placeholder: "e.g. Scooping R Us",
    icon: <Building2 size={15} />,
    help: "The business name you want to use in emails and sms messages",
  },
  {
    key: "businessOwnerName",
    label: "Business Owner Name",
    placeholder: "e.g. Jane Doe",
    icon: <UserRound size={15} />,
    help: "The name you want to use use to introduce yourself in emails and sms messages.",
  },
  {
    key: "businessEmail",
    label: "Business Email",
    placeholder: "you@yourbusiness.com",
    icon: <Mail size={15} />,
    help: "The business email address used in emails and notifications.",
  },
  {
    key: "businessPhone",
    label: "Business Phone",
    placeholder: "e.g. (555) 123-4567",
    icon: <Phone size={15} />,
    help: "The business phone number used in emails and notifications.",
  },
  {
    key: "businessLogo",
    label: "Business Logo",
    placeholder: "https://... (paste your logo URL)",
    icon: <ImageIcon size={15} />,
    isUrl: true,
    isImage: true,
    help: "Used in emails and sms messages.",
  },
  {
    key: "paymentLink",
    label: "Payment Link",
    placeholder: "https://client.sweepandgo.com/login/...",
    icon: <CreditCard size={15} />,
    isUrl: true,
    help: "(S&G Only) Link sent to customers with failed payments.",
  },
  {
    key: "facebookPageLink",
    label: "Facebook Page Link",
    placeholder: "https://www.facebook.com/yourpage",
    icon: <Facebook size={15} />,
    isUrl: true,
    help: "Link to Facebook Page added to some emails.",
  },
  {
    key: "leadCampaignOffer",
    label: "Discount / Free Offer for Lead Campaigns",
    placeholder: "Your offer is: ...",
    icon: <Tag size={15} />,
    help: "Offer Used in Lite/Custom Follow-up Campaigns.",
  },
  {
    key: "reengagementOffer",
    label:
      "Discount / Free Offer for Reactivation Campaigns (Reactivation NOT reengagement)",
    placeholder: "Your offer is: ...",
    icon: <Tag size={15} />,
    help: "Offer Used in Lite/Custom Reactivation Campaigns.",
  },
  {
    key: "legalBusinessName",
    label: "Legal Business Name",
    placeholder: "Exact name shown on your EIN paperwork",
    icon: <Building2 size={15} />,
    help: "For sole proprietors, use the legal first and last name only. Do not enter a DBA.",
  },
  {
    key: "businessAddress",
    label: "Business Address",
    placeholder: "Address shown on your EIN paperwork",
    icon: <MapPin size={15} />,
    help: "Use the address shown on your EIN paperwork.",
  },
  {
    key: "stateTwoLetterAbbrev",
    label: "Service State",
    placeholder: "UT",
    icon: <MapPin size={15} />,
    help: "Enter the two-letter state abbreviation where you provide service.",
  },
  {
    key: "crmSelection",
    label: "Which CRM do you use?",
    placeholder: "Select a CRM",
    icon: <ListChecks size={15} />,
    options: [
      { label: "S&G (Stripe)", value: "thank-you-strip" },
      { label: "S&G (Card Pointe)", value: "thank-you-pointe" },
      { label: "All other CRMs", value: "thank-you" },
    ],
  },
  {
    key: "internalNotificationsEmail",
    label: "Internal Notification Email",
    placeholder: "team@yourbusiness.com",
    icon: <Mail size={15} />,
  },
  {
    key: "internalNotificationsPhone",
    label: "Internal Notification Phone",
    placeholder: "(555) 123-4567",
    icon: <Phone size={15} />,
  },
  {
    key: "notificationChannel",
    label: "Notification Channel",
    placeholder: "Select a channel",
    icon: <Bell size={15} />,
    help: "Choose the channel used for customer notifications. SMS is the recommended default.",
    options: [
      { label: "SMS", value: "sms" },
      { label: "Email", value: "email" },
      { label: "Call", value: "call" },
    ],
  },
  {
    key: "receiveNewLeadNotifications",
    label: "Receive New Lead Notifications",
    placeholder: "Select an option",
    icon: <Bell size={15} />,
    options: [
      { label: "True", value: "True" },
      { label: "False", value: "False" },
    ],
  },
  {
    key: "onTheWayNotifications",
    label: "On the Way Notifications",
    placeholder: "Select an option",
    icon: <Bell size={15} />,
    options: [
      { label: "True", value: "True" },
      { label: "False", value: "False" },
    ],
  },
  {
    key: "jobCompletedNotifications",
    label: "Job Completed Notifications",
    placeholder: "Select an option",
    icon: <Bell size={15} />,
    options: [
      { label: "True", value: "True" },
      { label: "False", value: "False" },
    ],
  },
  {
    key: "offScheduleNotifications",
    label: "Off Schedule Notifications",
    placeholder: "Select an option",
    icon: <Bell size={15} />,
    options: [
      { label: "True", value: "True" },
      { label: "False", value: "False" },
    ],
  },
];

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AccountSetupPage(props: any = {}) {
  const embedded = Boolean(props.embedded);
  const locationId = useLocationId();

  // UI state for each field (independent so one field can be editing while another saves)
  const [values, setValues] = useState<Record<AccountField, string>>({
    businessName: "",
    businessOwnerName: "",
    businessEmail: "",
    businessPhone: "",
    businessLogo: "",
    paymentLink: "",
    facebookPageLink: "",
    leadCampaignOffer: "",
    reengagementOffer: "",
    legalBusinessName: "",
    businessAddress: "",
    stateTwoLetterAbbrev: "",
    internalNotificationsEmail: "",
    internalNotificationsPhone: "",
    receiveNewLeadNotifications: "True",
    onTheWayNotifications: "True",
    jobCompletedNotifications: "True",
    offScheduleNotifications: "True",
    notificationChannel: "sms",
    crmSelection: "",
  });
  // Drives the conditional upload UI for the Business Logo field:
  // the file upload option appears whenever the logo custom value is
  // currently EMPTY — both on page open (when nothing has been saved yet)
  // AND when the user clears a previously saved logo and re-saves, so they
  // can always upload a replacement.
  const [storedLogo, setStoredLogo] = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);

  const [saveStatus, setSaveStatus] = useState<
    Record<AccountField, "idle" | "saving" | "saved" | "error">
  >({
    businessName: "idle",
    businessOwnerName: "idle",
    businessEmail: "idle",
    businessPhone: "idle",
    businessLogo: "idle",
    paymentLink: "idle",
    facebookPageLink: "idle",
    leadCampaignOffer: "idle",
    reengagementOffer: "idle",
    legalBusinessName: "idle",
    businessAddress: "idle",
    stateTwoLetterAbbrev: "idle",
    internalNotificationsEmail: "idle",
    internalNotificationsPhone: "idle",
    receiveNewLeadNotifications: "idle",
    onTheWayNotifications: "idle",
    jobCompletedNotifications: "idle",
    offScheduleNotifications: "idle",
    notificationChannel: "idle",
    crmSelection: "idle",
  });

  // ── Fetch latest saved values from GHL custom values on every open ──
  // staleTime: 0 keeps the data always fresh (same as the Custom Quote popup).
  const settingsQuery = trpc.accountSetup.getSettings.useQuery(
    { locationId },
    {
      enabled: !!locationId,
      staleTime: 0,
      refetchOnMount: true,
      retry: 1,
    }
  );

  // Auto-save mutation — writes ONE field (and every GHL key mapped to it)
  // immediately, with a confirmation pop-up on success.
  const saveFieldMutation = trpc.accountSetup.saveField.useMutation({
    onSuccess: data => {
      setSaveStatus(prev => ({
        ...prev,
        [data.saved.field]: "saved",
      }));
      toast.success(
        <span className="flex items-center gap-1.5">
          <CheckCircle2 size={14} />
          Saved — the value was stored in your sub-account.
        </span>
      );
      if (data.saved.field === "businessLogo") {
        setStoredLogo(data.saved.value);
        setTypedLogo(data.saved.value);
      }
      // When the cleared (empty) logo value was just saved, immediately
      // reveal the upload option instead of waiting for the refetch to finish.
      if (data.saved.field === "businessLogo" && !data.saved.value) {
        setStoredLogo("");
        setTypedLogo("");
      }
      // Re-fetch so the UI always reflects what is currently in GHL.
      settingsQuery.refetch();
    },
    onError: error => {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Error saving: ${errorMsg}`);
      setSaveStatus(prev => ({
        ...prev,
        [dataSavedFieldRef.current]: "error",
      }));
    },
  });

  // The mutation's onSuccess callback doesn't receive the input, so we
  // track the field being saved in a ref for status mapping on error.
  const dataSavedFieldRef = useRef<AccountField>("businessName");

  // ── Page-open behavior: check GHL custom values FIRST ──
  // While the initial fetch is in flight the fields stay BLANK (no
  // placeholders are auto-filled and nothing is saved yet). As soon as the
  // response arrives, each field shows the value stored in its custom
  // value; if a field has no stored value it stays blank. This effect only
  // runs on the first successful fetch (`loadedOnce` guard), so the user's
  // in-progress typing is never overwritten by a re-fetch while editing.
  const [loadedOnce, setLoadedOnce] = useState(false);
  useEffect(() => {
    if (!settingsQuery.data || loadedOnce) return;
    const s = settingsQuery.data;
    setValues({
      businessName: s.businessName,
      businessOwnerName: s.businessOwnerName,
      businessEmail: s.businessEmail,
      businessPhone: s.businessPhone,
      businessLogo: s.businessLogo,
      paymentLink: s.paymentLink,
      facebookPageLink: s.facebookPageLink,
      leadCampaignOffer: s.leadCampaignOffer,
      reengagementOffer: s.reengagementOffer,
      legalBusinessName: s.legalBusinessName,
      businessAddress: s.businessAddress,
      stateTwoLetterAbbrev: s.stateTwoLetterAbbrev,
      internalNotificationsEmail: s.internalNotificationsEmail,
      internalNotificationsPhone: s.internalNotificationsPhone,
      receiveNewLeadNotifications: s.receiveNewLeadNotifications || "True",
      onTheWayNotifications: s.onTheWayNotifications || "True",
      jobCompletedNotifications: s.jobCompletedNotifications || "True",
      offScheduleNotifications: s.offScheduleNotifications || "True",
      notificationChannel: s.notificationChannel || "sms",
      crmSelection: s.crmSelection,
    });
    setStoredLogo(s.businessLogo);
    // Keep the typed tracker in sync with what GHL currently holds so the
    // upload box (re)appears when the logo was cleared and that empty value
    // was saved.
    if (loadedOnce && !s.businessLogo) setTypedLogo("");
    setLoadedOnce(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  // When the user clears the logo field and re-saves, the upload box must
  // re-appear. Track the currently typed logo value so the visibility
  // check reflects the latest in-progress value, not just the last fetch.
  const [typedLogo, setTypedLogo] = useState<string>("");

  // ── Local editing ───────────────────────────────────────────────────
  // Values remain local until the user clicks the page Save button. This
  // prevents partially completed business-registration data from being
  // written while the client is still editing the form.
  const handleValueChange = useCallback(
    (field: AccountField, newValue: string) => {
      setValues(prev => ({ ...prev, [field]: newValue }));
      if (field === "businessLogo") {
        setTypedLogo(newValue);
        if (!newValue) setStoredLogo("");
      }
    },
    []
  );

  // Map UI field → the primary GHL key it reads from, used for the no-op skip
  // and for the manual Save button's unsaved-changes detection. Defined here
  // (before the Save hook wiring) because hoisted `const` declarations are
  // not accessible before their declaration line — placing them above any
  // `useMemo`/`useCallback` that references them avoids a runtime
  // "Cannot access before initialization" error.
  const mapFieldToGhlKey = (field: AccountField): string =>
    (
      ({
        businessName: "businessName",
        businessOwnerName: "businessOwnerName",
        businessEmail: "businessEmail",
        businessPhone: "businessPhone",
        businessLogo: "businessLogo",
        paymentLink: "paymentLink",
        facebookPageLink: "facebookPageLink",
        leadCampaignOffer: "leadCampaignOffer",
        reengagementOffer: "reengagementOffer",
        legalBusinessName: "legalBusinessName",
        businessAddress: "businessAddress",
        stateTwoLetterAbbrev: "stateTwoLetterAbbrev",
        internalNotificationsEmail: "internalNotificationsEmail",
        internalNotificationsPhone: "internalNotificationsPhone",
        receiveNewLeadNotifications: "receiveNewLeadNotifications",
        onTheWayNotifications: "onTheWayNotifications",
        jobCompletedNotifications: "jobCompletedNotifications",
        offScheduleNotifications: "offScheduleNotifications",
        notificationChannel: "notificationChannel",
        crmSelection: "crmSelection",
      }) as const
    )[field];

  // ── Manual Save button (same explicit-Save pattern as the other
  //    settings pages) ────────────────────────────────────────────────
  // A single click pushes every field whose typed value differs from the last
  // known stored value. A confirmation pop-up appears once the batch completes.
  const [isSavingAll, setIsSavingAll] = useState(false);

  const savedValues = useMemo(
    () => (settingsQuery.data as Record<string, string> | undefined) ?? null,
    [settingsQuery.data]
  );

  const handleSaveAll = useCallback(async () => {
    if (!locationId) return;
    if (saveFieldMutation.isPending || logoUploading) return;
    // Re-derive in case of rapid successive clicks.
    const toSave = savedValues
      ? FIELDS.filter(
          meta =>
            (values[meta.key] ?? "") !==
            (savedValues[mapFieldToGhlKey(meta.key)] ?? "")
        )
      : FIELDS;
    if (toSave.length === 0) {
      toast("Your settings are already up to date.");
      return;
    }

    setIsSavingAll(true);
    let savedCount = 0;
    let failedCount = 0;
    try {
      for (const meta of toSave) {
        try {
          dataSavedFieldRef.current = meta.key;
          setSaveStatus(prev => ({ ...prev, [meta.key]: "saving" }));
          const res = await saveFieldMutation.mutateAsync({
            locationId,
            field: meta.key,
            value: values[meta.key],
          });
          savedCount += 1;
          setSaveStatus(prev => ({ ...prev, [res.saved.field]: "saved" }));
          if (res.saved.field === "businessLogo") {
            setStoredLogo(res.saved.value);
            setTypedLogo(res.saved.value);
          }
        } catch {
          failedCount += 1;
          setSaveStatus(prev => ({ ...prev, [meta.key]: "error" }));
        }
      }
      if (failedCount === 0) {
        toast.success(
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={14} />
            Saved — your business details were stored in your sub-account.
          </span>
        );
      } else {
        toast.error(
          `Saved ${savedCount} field${savedCount === 1 ? "" : "s"} but ${failedCount} field${failedCount === 1 ? "" : "s"} failed — check the failed field(s) and try again.`
        );
      }
      await settingsQuery.refetch();
    } finally {
      setIsSavingAll(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, values, savedValues]);

  useOnboardingSaveHandler(embedded, handleSaveAll);

  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            Account Set Up
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
              /account-setup?locationId=YOUR_LOCATION_ID
            </code>{" "}
            URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-2 sm:p-4">
      {/* Extra bottom clearance keeps the Save action fully reachable inside the GHL iframe. */}
      <div className="w-full max-w-none sm:max-w-3xl mx-auto space-y-6 pb-20">
        {/* Header */}
        <div className="homeflow-sticky-header text-center py-2 bg-blue-100/70 rounded-lg border border-blue-200">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-lg sm:text-xl font-extrabold text-blue-800 uppercase tracking-wider">
              Account Set Up
            </h1>
            {!embedded && (
              <VideoHelpButton
                pageTitle="Account Setup"
                videos={[
                  {
                    title: "HomeFlow Assistant: Account Set Up Explanation",
                    youtubeId: "Tb-Wi8ytbbo",
                  },
                ]}
              />
            )}
            {!embedded && (
              <TopSaveButton
                onClick={() => void handleSaveAll()}
                isSaving={isSavingAll}
                label="Save"
              />
            )}
          </div>
          <p className="text-[12px] text-slate-500 mt-1 px-4">
            Fill in your business details below.
          </p>
        </div>

        {/* Loading state while the freshest GHL values are being fetched */}
        {settingsQuery.isLoading && (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500 py-8">
            <Loader2 size={14} className="animate-spin" />
            Loading your saved settings...
          </div>
        )}

        {/* Fields */}
        {FIELDS.map(meta => {
          const status = saveStatus[meta.key];
          return (
            <div key={meta.key}>
              {meta.key === "notificationChannel" && (
                <div className="mb-2 rounded-xl border border-cyan-200 bg-cyan-50/70 p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-cyan-900">
                    Customer Notifications (Sweep and Go Users Only)
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-cyan-900/80">
                    Select which notifications you&apos;d like Sweep and Go to
                    automatically send your customers. We&apos;ll configure
                    these settings for each customer we onboard on your behalf.
                    These notifications are sent directly through Sweep and Go,
                    not HomeFlow Assistant.
                  </p>
                  <p className="mt-2 text-xs font-semibold text-cyan-900">
                    Available notifications: On the Way, Job Completed, and Off
                    Schedule.
                  </p>
                </div>
              )}
              <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <Label
                    htmlFor={meta.key}
                    className="text-sm font-semibold text-slate-700 flex items-center gap-2"
                  >
                    <span className="text-blue-600">{meta.icon}</span>
                    {meta.label}
                  </Label>
                  <StatusChip status={status} />
                </div>
                {meta.help && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-[11px] text-slate-400 italic mb-1.5 cursor-help flex items-center gap-1">
                        <BadgeCheck size={11} />
                        {meta.help}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{meta.help}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {meta.options ? (
                  <select
                    id={meta.key}
                    value={values[meta.key]}
                    onChange={e => handleValueChange(meta.key, e.target.value)}
                    disabled={
                      saveFieldMutation.isPending || settingsQuery.isLoading
                    }
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{meta.placeholder}</option>
                    {meta.options.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : meta.isImage &&
                  meta.key === "businessLogo" &&
                  (!storedLogo || typedLogo === "") &&
                  !logoUploading ? (
                  /* File upload option — only visible while the custom value
                   is empty. The chosen image is uploaded to the GHL Media
                   Library first, then the hosted URL is stored in BOTH
                   homeflow_business_logo and company_logo. */
                  <LogoUploadBox
                    onUpload={async base64 => {
                      if (!locationId) return;
                      if (settingsQuery.isLoading || settingsQuery.isError) {
                        toast.error(
                          "Unable to verify your saved settings right now — please try again in a moment."
                        );
                        return;
                      }
                      setLogoUploading(true);
                      dataSavedFieldRef.current = "businessLogo";
                      setSaveStatus(prev => ({
                        ...prev,
                        businessLogo: "saving",
                      }));
                      try {
                        const res = await saveFieldMutation.mutateAsync({
                          locationId,
                          field: "businessLogo",
                          value: base64,
                        });
                        setStoredLogo(res.saved.value);
                        setSaveStatus(prev => ({
                          ...prev,
                          businessLogo: "saved",
                        }));
                        toast.success(
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 size={14} />
                            Logo uploaded and saved — it will be used by your
                            campaigns.
                          </span>
                        );
                        settingsQuery.refetch();
                      } catch (error) {
                        const errorMsg =
                          error instanceof Error
                            ? error.message
                            : "Unknown error";
                        toast.error(`Error saving logo: ${errorMsg}`);
                        setSaveStatus(prev => ({
                          ...prev,
                          businessLogo: "error",
                        }));
                      } finally {
                        setLogoUploading(false);
                      }
                    }}
                  />
                ) : (
                  <Input
                    id={meta.key}
                    type={meta.isUrl ? "url" : "text"}
                    value={values[meta.key]}
                    onChange={e => {
                      if (meta.key === "businessLogo")
                        setTypedLogo(e.target.value);
                      handleValueChange(meta.key, e.target.value);
                    }}
                    disabled={
                      saveFieldMutation.isPending ||
                      settingsQuery.isLoading ||
                      logoUploading
                    }
                    className="mt-1 h-9"
                    placeholder={meta.placeholder}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusChip({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">
        <Loader2 size={11} className="animate-spin" />
        Saving...
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-medium">
        <CheckCircle2 size={11} />
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-medium">
        Error — retry by editing
      </span>
    );
  }
  return null;
}

/**
 * Logo file upload box — shown for the Business Logo field only while the
 * custom value is empty. The selected image is converted to base64 and
 * uploaded to the GHL Media Library by the server (same workflow as the
 * Custom Quote popup); the resulting hosted URL is then written to both
 * `homeflow_business_logo` and `company_logo`.
 */
function LogoUploadBox({ onUpload }: { onUpload: (base64: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPG, WebP, GIF, SVG).");
      return;
    }
    const base64 = await fileToBase64(file);
    onUpload(base64);
    // Allow re-selecting the same file next time.
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      className="mt-1 flex flex-col items-center gap-2 border-2 border-dashed border-slate-300 rounded-lg px-4 py-6 bg-slate-50 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
      onClick={() => inputRef.current?.click()}
    >
      <ImageIcon size={22} className="text-slate-400" />
      <span className="text-xs text-slate-500 font-medium">
        Click to upload your logo
      </span>
      <span className="text-[10px] text-slate-400">
        It will be uploaded to your media library automatically
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleSelect}
      />
    </div>
  );
}
