/**
 * Account Set Up Page
 *
 * New GHL sidebar item that lets clients fill in their business profile and
 * auto-saves every field directly to the sub-account's GHL custom values.
 *
 * Field → GHL custom value key mapping (order as specified by the client):
 *   Business Name            → {{custom_values.homeflow_business_name}}
 *                              + {{custom_values.company_name}} (both updated)
 *   Business Owner Name      → {{custom_values.homeflow_business_owner_name}}
 *   Business Logo            → {{custom_values.homeflow_business_logo}}
 *                              + {{custom_values.company_logo}} (both updated)
 *   Payment Link             → {{custom_values.add_payment_link}}
 *   Facebook Page Link       → {{custom_values.facebook_page_link}}
 *   Lead Campaign Offer      → {{custom_values.discountfree_offer_for_lead_campaigns}}
 *   Reengagement Offer       → {{custom_values.discountfree_offer_for_reengagement_campaigns}}
 *
 * Behavior (as requested in the account setup spec):
 *   - Fields are shown in the order listed above.
 *   - Auto-save on input (debounced): no manual Save button.
 *   - A confirmation pop-up (toast) appears whenever a value is saved.
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

type AccountField =
  | "businessName"
  | "businessOwnerName"
  | "businessLogo"
  | "paymentLink"
  | "facebookPageLink"
  | "leadCampaignOffer"
  | "reengagementOffer";

interface FieldMeta {
  key: AccountField;
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  isUrl?: boolean;
  isImage?: boolean;
  help?: string;
}

// Display order matches the order given by the client.
const FIELDS: FieldMeta[] = [
  {
    key: "businessName",
    label: "Business Name",
    placeholder: "e.g. Scooping R Us",
    icon: <Building2 size={15} />,
    help: "Updates both homeflow_business_name and company_name.",
  },
  {
    key: "businessOwnerName",
    label: "Business Owner Name",
    placeholder: "e.g. Jane Doe",
    icon: <UserRound size={15} />,
  },
  {
    key: "businessLogo",
    label: "Business Logo",
    placeholder: "https://... (paste your logo URL)",
    icon: <ImageIcon size={15} />,
    isUrl: true,
    isImage: true,
    help: "Updates both homeflow_business_logo and company_logo.",
  },
  {
    key: "paymentLink",
    label: "Payment Link",
    placeholder: "https://... (Stripe, PayPal, etc.)",
    icon: <CreditCard size={15} />,
    isUrl: true,
  },
  {
    key: "facebookPageLink",
    label: "Facebook Page Link",
    placeholder: "https://www.facebook.com/yourpage",
    icon: <Facebook size={15} />,
    isUrl: true,
  },
  {
    key: "leadCampaignOffer",
    label: "Discount / Free Offer for Lead Campaigns",
    placeholder: "Your offer is: ...",
    icon: <Tag size={15} />,
    help: "Texts/emails only — appended after \u201cYour offer is:\u201d in lead campaigns.",
  },
  {
    key: "reengagementOffer",
    label: "Discount / Free Offer for Reengagement Campaigns",
    placeholder: "Your offer is: ...",
    icon: <Tag size={15} />,
    help: "Texts/emails only — appended after \u201cYour offer is:\u201d in reengagement campaigns.",
  },
];

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

const DEBOUNCE_MS = 700;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AccountSetupPage() {
  const locationId = useLocationId();

  // UI state for each field (independent so one field can be editing while another saves)
  const [values, setValues] = useState<Record<AccountField, string>>({
    businessName: "",
    businessOwnerName: "",
    businessLogo: "",
    paymentLink: "",
    facebookPageLink: "",
    leadCampaignOffer: "",
    reengagementOffer: "",
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
    businessLogo: "idle",
    paymentLink: "idle",
    facebookPageLink: "idle",
    leadCampaignOffer: "idle",
    reengagementOffer: "idle",
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
      businessLogo: s.businessLogo,
      paymentLink: s.paymentLink,
      facebookPageLink: s.facebookPageLink,
      leadCampaignOffer: s.leadCampaignOffer,
      reengagementOffer: s.reengagementOffer,
    });
    setStoredLogo(s.businessLogo);
    // Keep the typed tracker in sync with what GHL currently holds.
    if (!s.businessLogo) setTypedLogo("");
    setLoadedOnce(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  // When the user clears the logo field and re-saves, the upload box must
  // re-appear. Track the currently typed logo value so the visibility
  // check reflects the latest in-progress value, not just the last fetch.
  const [typedLogo, setTypedLogo] = useState<string>("");

  // ── Auto-save on input with debounce ────────────────────────────────
  // Each keystroke restarts a timer; when the user pauses for 700ms the
  // value is pushed to GHL and a confirmation pop-up appears. No-op
  // updates are skipped, and saves wait until GHL has finished loading so
  // the freshly fetched value always wins on page open.
  const debounceTimers = useRef<Record<AccountField, ReturnType<typeof setTimeout> | null>>({
    businessName: null,
    businessOwnerName: null,
    businessLogo: null,
    paymentLink: null,
    facebookPageLink: null,
    leadCampaignOffer: null,
    reengagementOffer: null,
  });

  const handleValueChange = useCallback(
    (field: AccountField, newValue: string) => {
      setValues(prev => ({ ...prev, [field]: newValue }));

      if (debounceTimers.current[field]) {
        clearTimeout(debounceTimers.current[field]!);
      }

      debounceTimers.current[field] = setTimeout(() => {
        if (!locationId) return;
        // Skip no-op saves (value unchanged from what GHL already has).
        const stored = (settingsQuery.data as Record<string, string> | undefined)?.[mapFieldToGhlKey(field)] ?? "";
        if (
          stored === newValue &&
          !saveFieldMutation.isPending &&
          !saveFieldMutation.isError
        ) {
          return;
        }
        // Wait for the initial GHL load so a fetch failure can't overwrite
        // the stored value with an empty default, and so the page-open
        // fetch (which fills the fields first) always wins on open.
        if (settingsQuery.isLoading || settingsQuery.isError) return;

        setSaveStatus(prev => ({ ...prev, [field]: "saving" }));
        dataSavedFieldRef.current = field;
        saveFieldMutation.mutate({ locationId, field, value: newValue });
      }, DEBOUNCE_MS);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [locationId]
  );

  // Clean up timers on unmount
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const t of Object.values(timers)) {
        if (t) clearTimeout(t);
      }
    };
  }, []);

  // Map UI field → the primary GHL key it reads from, used for the no-op skip.
  const mapFieldToGhlKey = (field: AccountField): string =>
    ({
      businessName: "businessName",
      businessOwnerName: "businessOwnerName",
      businessLogo: "businessLogo",
      paymentLink: "paymentLink",
      facebookPageLink: "facebookPageLink",
      leadCampaignOffer: "leadCampaignOffer",
      reengagementOffer: "reengagementOffer",
    } as const)[field];

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
      <div className="w-full max-w-none sm:max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center py-2 bg-blue-100/70 rounded-lg border border-blue-200">
          <h1 className="text-lg sm:text-xl font-extrabold text-blue-800 uppercase tracking-wider">
            Account Set Up
          </h1>
          <p className="text-[12px] text-slate-500 mt-1 px-4">
            Fill in your business details below — each field is saved
            automatically as you type and synced to your sub-account's custom
            values.
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
            <div
              key={meta.key}
              className="bg-card rounded-xl border border-border p-4 shadow-sm"
            >
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
              {meta.isImage &&
              meta.key === "businessLogo" &&
              !storedLogo &&
              typedLogo === "" &&
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
                    setSaveStatus(prev => ({ ...prev, businessLogo: "saving" }));
                    try {
                      const res = await saveFieldMutation.mutateAsync({
                        locationId,
                        field: "businessLogo",
                        value: base64,
                      });
                      setStoredLogo(res.saved.value);
                      setSaveStatus(prev => ({ ...prev, businessLogo: "saved" }));
                      toast.success(
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 size={14} />
                          Logo uploaded and saved — it will be used by your campaigns.
                        </span>
                      );
                      settingsQuery.refetch();
                    } catch (error) {
                      const errorMsg =
                        error instanceof Error ? error.message : "Unknown error";
                      toast.error(`Error saving logo: ${errorMsg}`);
                      setSaveStatus(prev => ({ ...prev, businessLogo: "error" }));
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
                    if (meta.key === "businessLogo") setTypedLogo(e.target.value);
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
          );
        })}

        {/* Footer note */}
        <p className="text-center text-[11px] text-slate-400 pb-4">
          All values sync to your GHL sub-account as custom values and are
          used by your lead, reengagement, and quote campaigns.
        </p>
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
function LogoUploadBox({
  onUpload,
}: {
  onUpload: (base64: string) => void;
}) {
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
