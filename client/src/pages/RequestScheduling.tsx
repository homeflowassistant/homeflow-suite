import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, Clock3, Sparkles, X, ArrowRight, Star } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
// Example images served from /public via Vite
const EXAMPLE_EMAIL = "/lite.png";
const EXAMPLE_SG_ONBOARDING = "/S&G.png";
const EXAMPLE_CUSTOM_QUOTE = "/custom.png";
import "./RequestScheduling.css";

// Swap positions: "Custom Quote & Link" and "S&G Link" are swapped.
// New order: Lite → S&G Link → Custom Quote & Link
const LEAD_FOLLOW_UP_OPTIONS = ["Lite", "S&G Link", "Custom Quote & Link"] as const;
const TIMING_LABELS = ["Immediately", "Next Day", "48 Hours Later", "72 Hours Later", "One Week from Now"] as const;
const TIMING_CUSTOM_VALUES = ["Immediately", "Next Day", "48 Hours Later", "72 Hours Later", "One Week from Now"] as const;

const FOLLOWUP_CUSTOM_VALUES: Record<number, "0" | "1" | "2" | "3"> = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
};

function normalizeTimingValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function useLocationAndParams() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      locationId: params.get("locationId") || "",
      leadFollowUpOption: params.get("lead_follow_up_option") || "",
      initialRequestScheduling: params.get("initial_request_scheduling") || "",
      followUpLimit: params.get("follow_up_limit") || "",
    };
  }, []);
}

function sliderBackground(value: number) {
  const pct = (value / (TIMING_LABELS.length - 1)) * 100;
  return `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${pct}%, hsl(var(--border)) ${pct}%, hsl(var(--border)) 100%)`;
}

function timingCustomValueToIndex(value: string): number {
  const normalized = normalizeTimingValue(value);
  const lookup: Record<string, number> = {
    immediately: 0,
    "next day": 1,
    "24 hours": 1,
    "24h": 1,
    "48 hours later": 2,
    "48 hours": 2,
    "48h": 2,
    "72 hours later": 3,
    "72 hours": 3,
    "1 week from now": 4,
    "one week from now": 4,
    "1 week": 4,
    "one week": 4,
  };

  return lookup[normalized] ?? TIMING_CUSTOM_VALUES.findIndex((label) => normalizeTimingValue(label) === normalized) ?? 0;
}

// ─── S&G Link Form Data ──────────────────────────────────────────────

interface SgLinkFormData {
  zipCode: string;
  numberOfDogs: string;
  cleanUpFrequency: string;
  lastTimeYardCleaned: string;
  firstName: string;
  lastName: string;
  cellPhone: string;
  email: string;
  marketingAllowed: boolean;
}

const emptySgForm: SgLinkFormData = {
  zipCode: "",
  numberOfDogs: "",
  cleanUpFrequency: "",
  lastTimeYardCleaned: "",
  firstName: "",
  lastName: "",
  cellPhone: "",
  email: "",
  marketingAllowed: true,
};

function validateSgForm(data: SgLinkFormData): Partial<Record<keyof SgLinkFormData, string>> {
  const errors: Partial<Record<keyof SgLinkFormData, string>> = {};

  if (!data.zipCode.trim()) errors.zipCode = "Zip code is required";
  if (!data.numberOfDogs.trim()) errors.numberOfDogs = "Number of dogs is required";
  if (!data.cleanUpFrequency.trim()) errors.cleanUpFrequency = "Clean up frequency is required";
  if (!data.lastTimeYardCleaned.trim()) errors.lastTimeYardCleaned = "Last time the yard was cleaned is required";
  if (!data.firstName.trim()) errors.firstName = "First name is required";
  if (!data.cellPhone.trim()) errors.cellPhone = "Cell phone number is required";
  if (!data.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    errors.email = "Invalid email format";
  }

  return errors;
}

// ─── S&G Link Popup Component ────────────────────────────────────────

function SgLinkPopup({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SgLinkFormData) => void;
}) {
  const [formData, setFormData] = useState<SgLinkFormData>(emptySgForm);
  const [errors, setErrors] = useState<Partial<Record<keyof SgLinkFormData, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field: keyof SgLinkFormData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = field === "marketingAllowed" ? (e.target as HTMLInputElement).checked : e.target.value;
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleCheckboxChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, marketingAllowed: checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = validateSgForm(formData);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      setFormData(emptySgForm);
      setErrors({});
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="sg-popup-overlay">
      <div className="sg-popup-modal">
        <div className="sg-popup-header">
          <div>
            <h2 className="sg-popup-title">S&G Link — Lead Information</h2>
            <p className="sg-popup-subtitle">
              Enter the lead details to submit to the Sweep & Go Link campaign.
            </p>
          </div>
          <button
            type="button"
            className="sg-popup-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="sg-popup-form">
          <div className="sg-form-grid">
            <div className="sg-form-field">
              <label className="sg-label">
                <span className="sg-required">*</span> Zip Code
              </label>
              <input
                type="text"
                value={formData.zipCode}
                onChange={handleChange("zipCode")}
                placeholder="Enter zip code"
                className={`sg-input ${errors.zipCode ? "sg-input-error" : ""}`}
              />
              {errors.zipCode && <p className="sg-error">{errors.zipCode}</p>}
            </div>

            <div className="sg-form-field">
              <label className="sg-label">
                <span className="sg-required">*</span> Number of Dogs
              </label>
              <input
                type="text"
                value={formData.numberOfDogs}
                onChange={handleChange("numberOfDogs")}
                placeholder="Enter number of dogs"
                className={`sg-input ${errors.numberOfDogs ? "sg-input-error" : ""}`}
              />
              {errors.numberOfDogs && <p className="sg-error">{errors.numberOfDogs}</p>}
            </div>

            <div className="sg-form-field">
              <label className="sg-label">
                <span className="sg-required">*</span> Clean Up Frequency
              </label>
              <input
                type="text"
                value={formData.cleanUpFrequency}
                onChange={handleChange("cleanUpFrequency")}
                placeholder="e.g. Weekly, Bi-weekly, Monthly"
                className={`sg-input ${errors.cleanUpFrequency ? "sg-input-error" : ""}`}
              />
              {errors.cleanUpFrequency && <p className="sg-error">{errors.cleanUpFrequency}</p>}
            </div>

            <div className="sg-form-field">
              <label className="sg-label">
                <span className="sg-required">*</span> Last Time The Yard Was Cleaned
              </label>
              <input
                type="text"
                value={formData.lastTimeYardCleaned}
                onChange={handleChange("lastTimeYardCleaned")}
                placeholder="e.g. 2 weeks ago, 06/15/2026"
                className={`sg-input ${errors.lastTimeYardCleaned ? "sg-input-error" : ""}`}
              />
              {errors.lastTimeYardCleaned && <p className="sg-error">{errors.lastTimeYardCleaned}</p>}
            </div>

            <div className="sg-form-field">
              <label className="sg-label">
                <span className="sg-required">*</span> First Name
              </label>
              <input
                type="text"
                value={formData.firstName}
                onChange={handleChange("firstName")}
                placeholder="Enter first name"
                className={`sg-input ${errors.firstName ? "sg-input-error" : ""}`}
              />
              {errors.firstName && <p className="sg-error">{errors.firstName}</p>}
            </div>

            <div className="sg-form-field">
              <label className="sg-label">Last Name</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={handleChange("lastName")}
                placeholder="Enter last name"
                className="sg-input"
              />
            </div>

            <div className="sg-form-field">
              <label className="sg-label">
                <span className="sg-required">*</span> Cell Phone Number
              </label>
              <input
                type="tel"
                value={formData.cellPhone}
                onChange={handleChange("cellPhone")}
                placeholder="Enter cell phone number"
                className={`sg-input ${errors.cellPhone ? "sg-input-error" : ""}`}
              />
              {errors.cellPhone && <p className="sg-error">{errors.cellPhone}</p>}
            </div>

            <div className="sg-form-field">
              <label className="sg-label">
                <span className="sg-required">*</span> Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={handleChange("email")}
                placeholder="Enter email address"
                className={`sg-input ${errors.email ? "sg-input-error" : ""}`}
              />
              {errors.email && <p className="sg-error">{errors.email}</p>}
            </div>

            <div className="sg-form-field sg-full-width">
              <label className="sg-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.marketingAllowed}
                  onChange={(e) => handleCheckboxChange(e.target.checked)}
                  className="sg-checkbox"
                />
                <span>Marketing Allowed (defaults to Yes if empty)</span>
              </label>
            </div>
          </div>

          <div className="sg-form-actions">
            <button
              type="button"
              className="sg-btn-cancel"
              onClick={() => {
                setFormData(emptySgForm);
                setErrors({});
                onClose();
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="sg-btn-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Submit & Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Timeline Data ───────────────────────────────────────────────────

const TIMELINE_STEPS = [
  { day: "Day 1", label: "Email 1\nSMS 1" },
  { day: "Day 3", label: "Email 2\nSMS 2" },
  { day: "Day 5", label: "Email 3\nSMS 3" },
  { day: "Day 8", label: "Email 4\nSMS 4" },
  { day: "Day 12", label: "Email 5\nSMS 5" },
  { day: "Day 26", label: "Email 6" },
  { day: "Day 60", label: "Email 7" },
  { day: "Day 90", label: "Email 8" },
  { day: "Day 180", label: "Email 9" },
  { day: "Day 270", label: "Email 10" },
  { day: "Day 360", label: "Email 11" },
];

// First row: indices 0–5 (Day 1 through Day 26)
// Second row: indices 6–10 (Day 60 through Day 360)
const FIRST_ROW = TIMELINE_STEPS.slice(0, 6);
const SECOND_ROW = TIMELINE_STEPS.slice(6);

// ─── Main RequestScheduling Page ─────────────────────────────────────

export default function RequestScheduling() {
  const { locationId, leadFollowUpOption, initialRequestScheduling, followUpLimit } = useLocationAndParams();
  const [selectedOption, setSelectedOption] = useState<(typeof LEAD_FOLLOW_UP_OPTIONS)[number]>("Lite");
  const [initialTiming, setInitialTiming] = useState(3);
  const [followUpCount, setFollowUpCount] = useState(3);
  const [isSaving, setIsSaving] = useState(false);
  const [showSgPopup, setShowSgPopup] = useState(false);

  const settingsQuery = trpc.requestScheduling.getSettings.useQuery(
    { locationId },
    { enabled: !!locationId }
  );

  const saveCustomValuesMutation = trpc.requestScheduling.saveCustomValuesSettings.useMutation();

  const showToast = useCallback((message: string, isError = false) => {
    toast(message, { style: isError ? { background: "hsl(var(--destructive))", color: "hsl(var(--destructive-foreground))" } : undefined });
  }, []);

  useEffect(() => {
    if (leadFollowUpOption && LEAD_FOLLOW_UP_OPTIONS.includes(leadFollowUpOption as any)) {
      setSelectedOption(leadFollowUpOption as (typeof LEAD_FOLLOW_UP_OPTIONS)[number]);
    }

    if (initialRequestScheduling) {
      setInitialTiming(timingCustomValueToIndex(initialRequestScheduling));
    }

    if (followUpLimit) {
      const val = parseInt(followUpLimit, 10);
      if (!isNaN(val) && val >= 0 && val <= 3) setFollowUpCount(val);
    }
  }, [leadFollowUpOption, initialRequestScheduling, followUpLimit]);

  useEffect(() => {
    if (leadFollowUpOption || initialRequestScheduling || followUpLimit) {
      return;
    }

    if (settingsQuery.data) {
      setSelectedOption(settingsQuery.data.leadFollowUpOption);
      setInitialTiming(settingsQuery.data.initialTiming);
      setFollowUpCount(settingsQuery.data.followUpCount);
    }
  }, [leadFollowUpOption, initialRequestScheduling, followUpLimit, settingsQuery.data]);

  const handleSave = async () => {
    // If S&G Link is selected, open the popup for data entry
    if (selectedOption === "S&G Link") {
      setShowSgPopup(true);
      return;
    }

    // For "Lite" or "Custom Quote & Link", save directly without popup
    setIsSaving(true);
    try {
      await saveCustomValuesMutation.mutateAsync({
        locationId,
        leadFollowUpOption: selectedOption,
        initialRequestScheduling: TIMING_LABELS[initialTiming],
        followUpLimit: FOLLOWUP_CUSTOM_VALUES[followUpCount],
      });
      showToast("Settings saved successfully.");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      showToast(`Error saving settings: ${errorMsg}`, true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSgSubmit = async (sgData: SgLinkFormData) => {
    setIsSaving(true);
    try {
      const result = await saveCustomValuesMutation.mutateAsync({
        locationId,
        leadFollowUpOption: selectedOption,
        initialRequestScheduling: TIMING_LABELS[initialTiming],
        followUpLimit: FOLLOWUP_CUSTOM_VALUES[followUpCount],
        sgLinkData: sgData,
      });

      // Show webhook status in the toast
      if (result.webhookSent) {
        showToast("S&G Link settings saved and webhook sent successfully.");
      } else if (result.webhookError) {
        showToast(`Settings saved, but webhook failed: ${result.webhookError}`);
      } else {
        showToast("Settings saved (webhook was not configured).");
      }
      setShowSgPopup(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      showToast(`Error saving settings: ${errorMsg}`, true);
    } finally {
      setIsSaving(false);
    }
  };

  // Redirect handlers for Email / SMS template buttons
  const handleGoToEmailTemplates = () => {
    window.open(
      `https://app.royalreview.io/v2/location/${locationId}/marketing/emails/all?pageNumber=1`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleGoToSmsTemplates = () => {
    window.open(
      `https://app.royalreview.io/v2/location/${locationId}/marketing/templates`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Request Scheduling</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">/request-scheduling?locationId=YOUR_LOCATION_ID</code> URL.
          </p>
        </div>
      </div>
    );
  }

  // Example images map for each campaign option
  const exampleImages: Record<string, string> = {
    "Lite": EXAMPLE_EMAIL,
    "S&G Link": EXAMPLE_SG_ONBOARDING,
    "Custom Quote & Link": EXAMPLE_CUSTOM_QUOTE,
  };

  return (
    <div className="rs-main">
      <div className="rs-shell">
        <header className="rs-page-header">
          <div>
            <p className="rs-page-label">Lead Follow-Up Options</p>
            <h1 className="rs-page-title">How it works</h1>
            <div className="rs-page-copy">
              <p className="rs-how-step">1. Add Contacts manually or via Facebook form.</p>
              <p className="rs-how-step">2. We reach out with a message.</p>
              <p className="rs-how-step">3. They approve a quote and you schedule a scope.</p>
            </div>
          </div>
          <div className="rs-page-icon">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
        </header>

        <section className="rs-card rs-option-section">
          <div className="rs-option-grid">
            {LEAD_FOLLOW_UP_OPTIONS.map((option, idx) => {
              const isSelected = selectedOption === option;
              return (
                <div key={option} className="rs-option-card-wrapper">
                  <button
                    type="button"
                    className={`rs-option-card ${isSelected ? "rs-option-selected" : ""}`}
                    onClick={() => setSelectedOption(option)}
                  >
                    {/* "Most Popular" badge on S&G Link tile */}
                    {option === "S&G Link" && (
                      <div className="rs-popular-badge">
                        <Star className="rs-popular-badge-icon" />
                        <span>Most Popular</span>
                      </div>
                    )}
                    <div className="rs-option-card-header">
                      <span className="rs-option-name">{option.toUpperCase()}</span>
                      <span className="rs-option-pill">{option === "Lite" ? "Simple follow-up" : option === "Custom Quote & Link" ? "Custom quote + link" : "Self-onboarding campaign"}</span>
                    </div>
                    <p className="rs-option-text">
                      {option === "Lite"
                        ? "Lite includes simple text and email follow-up for new leads so you stay connected without extra work. When someone reaches out, automatic messages help build trust, answer questions, and keep your business top of mind."
                        : option === "Custom Quote & Link"
                        ? "Custom Quote & Link lets you send a personalized quote with a scheduling link. Customers receive your custom quote, click the link to approve services, and schedule themselves — combining personalization with self-service convenience."
                        : "Leads in the Sweep & Go Link campaign are automatically added to a text and email follow-up sequence with a self-onboarding link. Customers can simply click the link to view pricing, approve services, and schedule themselves, eliminating 90% of the back and forth."}
                    </p>
                    <p className="rs-option-text">
                      {option === "Lite"
                        ? "If you'd rather get distracted, or choose someone else, your phone number and email are included so customers feel comfortable reaching out when they are ready."
                        : option === "Custom Quote & Link"
                        ? "Send custom quotes, keep your business top of mind, and let customers approve and schedule on their own time. No back-and-forth needed."
                        : "Automate follow-up, keep your business top of mind, build trust over time, and help more leads sign up before they forget, get busy, or choose someone else."}
                    </p>
                    <div className="rs-example-box">
                      <div className="rs-example-label">Example</div>
                      <div className="rs-example-content">
                        <img
                          src={exampleImages[option]}
                          alt={`${option} example`}
                          className="rs-example-image"
                        />
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rs-card rs-scheduling-section">
          <div className="rs-section-heading">
            <div>
              <h2 className="rs-title">Initial Outreach Scheduling</h2>
              <p className="rs-subtitle">Choose when you want to start your initial outreach for Lead Follow-Ups.</p>
            </div>
            <span className="rs-current-selection">{TIMING_LABELS[initialTiming]}</span>
          </div>

          <div className="rs-slider-panel">
            <input
              type="range"
              min={0}
              max={TIMING_LABELS.length - 1}
              step={1}
              value={initialTiming}
              onChange={(event) => setInitialTiming(Number.parseInt(event.target.value, 10))}
              style={{ background: sliderBackground(initialTiming) }}
              className="rs-slider"
              aria-label="Initial outreach timing"
            />
            <div className="rs-slider-labels rs-slider-labels-wide">
              {TIMING_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>

          {/* Subtle faded blue horizontal divider */}
          <div className="rs-scheduling-divider" />

          <div className="rs-info-box">
            <div className="rs-info-header">
              <Clock3 className="h-4 w-4 text-primary" />
              <span className="rs-info-title">Important Notes</span>
            </div>
            <ul className="rs-info-list">
              <li><strong>8:00 AM – 9:00 PM (Local Time)</strong><br /><em>Please reach out to customer support if you need to reschedule outside this outreach window.</em></li>
              <li><strong>Texts are sent at a controlled rate, ensuring reliable delivery.</strong></li>
            </ul>
          </div>
        </section>

        {/* ─── Redesigned Timeline with two rows and dashed blue arrows ─── */}
        <section className="rs-card rs-timeline-section">
          <h2 className="rs-title">Timeline</h2>
          <div className="rs-timeline-redesigned">
            {/* First row: Day 1 → Day 3 → Day 5 → Day 8 → Day 12 → Day 26 */}
            <div className="rs-timeline-row">
              {FIRST_ROW.map((step, idx) => (
                <div key={step.day} className="rs-timeline-row-inner">
                  <div className="rs-timeline-step">
                    <span className="rs-timeline-step-day">{step.day}</span>
                    <span className="rs-timeline-step-label">{step.label}</span>
                  </div>
                  {idx < FIRST_ROW.length - 1 && (
                    <ArrowRight className="rs-timeline-dashed-arrow" />
                  )}
                </div>
              ))}
            </div>

            {/* Curved connector from Day 26 (end of row 1) to Day 60 (start of row 2) */}
            <div className="rs-timeline-curve-connector">
              <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="rs-timeline-curve-svg">
                <path
                  d="M 0 0 C 30 0, 70 60, 100 60"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
              </svg>
            </div>

            {/* Second row: Day 60 → Day 90 → Day 180 → Day 270 → Day 360 */}
            <div className="rs-timeline-row">
              {SECOND_ROW.map((step, idx) => (
                <div key={step.day} className="rs-timeline-row-inner">
                  <div className="rs-timeline-step">
                    <span className="rs-timeline-step-day">{step.day}</span>
                    <span className="rs-timeline-step-label">{step.label}</span>
                  </div>
                  {idx < SECOND_ROW.length - 1 && (
                    <ArrowRight className="rs-timeline-dashed-arrow" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Workflow Templates Block ─── */}
        <section className="rs-card rs-templates-section">
          <div className="rs-templates-content">
            <p className="rs-templates-text">
              Would you like to view your workflow templates?<br />
              You will be redirected to a new page. Please save any changes on this page before continuing.
            </p>
            <div className="rs-templates-buttons">
              <button
                type="button"
                className="rs-templates-btn rs-templates-btn-email"
                onClick={handleGoToEmailTemplates}
              >
                Email Templates
              </button>
              <button
                type="button"
                className="rs-templates-btn rs-templates-btn-sms"
                onClick={handleGoToSmsTemplates}
              >
                SMS Templates
              </button>
            </div>
          </div>
        </section>

        <div className="rs-save-bar">
          <button type="button" className="rs-save-btn" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </div>

      {/* S&G Link Popup */}
      <SgLinkPopup
        open={showSgPopup}
        onClose={() => setShowSgPopup(false)}
        onSubmit={handleSgSubmit}
      />
    </div>
  );
}
