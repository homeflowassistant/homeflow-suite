import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Link2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./ReactivationPage.css";

// ─── Example images (place these PNGs in /public) ─────────────────────
const EXAMPLE_LITE   = "/lite.png";
const EXAMPLE_CUSTOM = "/custom.png";

// ─── Constants ────────────────────────────────────────────────────────
const REACTIVATION_OPTIONS = ["Lite", "Custom Quote & Link"] as const;
type ReactivationOption = (typeof REACTIVATION_OPTIONS)[number];

// One-Time Service Outreach Scheduling options
// Mapped to: {{custom_values.onetime_service_reactivation_scheduling}}
const ONETIME_TIMING_LABELS = [
  "Never",
  "Immediately",
  "Next Day",
  "72 Hours Later",
  "1 Week Later",
] as const;
type OnetimeTiming = (typeof ONETIME_TIMING_LABELS)[number];

// Timeline Data (Matching Follow-Up page exactly)
const TIMELINE_STEPS = [
  { day: "Day 1",  label: "Email 1\nSMS 1" },
  { day: "Day 3",  label: "Email 2\nSMS 2" },
  { day: "Day 5",  label: "Email 3\nSMS 3" },
  { day: "Day 8",  label: "Email 4\nSMS 4" },
  { day: "Day 12", label: "Email 5\nSMS 5" },
  { day: "Day 26", label: "Email 6" },
  { day: "Day 60", label: "Email 7" },
  { day: "Day 90", label: "Email 8" },
  { day: "Day 180", label: "Email 9" },
  { day: "Day 270", label: "Email 10" },
  { day: "Day 360", label: "Email 11" },
];
const FIRST_ROW  = TIMELINE_STEPS.slice(0, 6);
const SECOND_ROW = TIMELINE_STEPS.slice(6);

// ─── Helpers ──────────────────────────────────────────────────────────
function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

function sliderBackground(value: number, max: number) {
  const pct = (value / max) * 100;
  return `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

function onetimeTimingToIndex(value: string): number {
  const n = value.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const map: Record<string, number> = {
    never: 0,
    immediately: 1,
    "next day": 2,
    "72 hours later": 3,
    "72 hours": 3,
    "1 week later": 4,
    "one week later": 4,
    "1 week": 4,
  };
  return (
    map[n] ??
    ONETIME_TIMING_LABELS.findIndex((l) => l.toLowerCase() === n) ??
    0
  );
}

// ─── Today's date as a display string ─────────────────────────────────
function todayDisplay(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Custom Quote form state ──────────────────────────────────────────
interface CustomQuoteFormData {
  businessLogo:           string;
  businessName:           string;   // "First and Last Name"
  businessOwnerName:      string;
  // Bio maps to BOTH quote_title AND company_description
  bioText:                string;
  companyImage:           string;
  discountOffer:          string;
  offerDescription:       string;
  // Price fields are display-only ($0.00) — no editable value
  offerImage:             string;
  sendQuoteAutomatically: boolean;
  tosLink:                string;
  showCardSection:        boolean;
  image1: string;
  image2: string;
  image3: string;
  image4: string;
  image5: string;
  review1:      string;
  review1Photo: string;
  review1Name:  string;
  review2:      string;
  review2Photo: string;
  review2Name:  string;
  review3:      string;
  review3Photo: string;
  review3Name:  string;
  review4:      string;
  review4Photo: string;
  review4Name:  string;
}

const emptyQuoteForm: CustomQuoteFormData = {
  businessLogo:           "",
  businessName:           "",
  businessOwnerName:      "",
  bioText:                "",
  companyImage:           "",
  discountOffer:          "",
  offerDescription:       "",
  offerImage:             "",
  sendQuoteAutomatically: true,
  tosLink:                "",
  showCardSection:        true,
  image1: "",
  image2: "",
  image3: "",
  image4: "",
  image5: "",
  review1:      "",
  review1Photo: "",
  review1Name:  "",
  review2:      "",
  review2Photo: "",
  review2Name:  "",
  review3:      "",
  review3Photo: "",
  review3Name:  "",
  review4:      "",
  review4Photo: "",
  review4Name:  "",
};

interface QuoteFormErrors {
  businessName?: string;
}

function validateQuoteForm(data: CustomQuoteFormData): QuoteFormErrors {
  const errors: QuoteFormErrors = {};
  if (!data.businessName.trim()) errors.businessName = "Business name is required";
  return errors;
}

// ─── Image Picker Field Component ─────────────────────────────────────
function ImagePickerField({
  label,
  value,
  onChange,
  placeholder = "Upload Image",
  height = "100px",
  circle = false,
}: {
  label?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  height?: string;
  circle?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        onChange(evt.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="cq-image-picker-field">
      {label && <label className="cq-label">{label}</label>}
      {value ? (
        <div className={`cq-image-preview-box ${circle ? "cq-preview-circle" : ""}`} style={{ height }}>
          <img src={value} alt={label || "Uploaded image"} className="cq-image-preview-img" />
          <div className="cq-image-preview-overlay">
            <button
              type="button"
              className="cq-image-btn-change"
              onClick={() => fileInputRef.current?.click()}
            >
              Change
            </button>
            <button
              type="button"
              className="cq-image-btn-remove"
              onClick={() => onChange("")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`cq-image-upload-dropzone ${circle ? "cq-dropzone-circle" : ""}`}
          style={{ height }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-5 w-5 cq-upload-icon" />
          <span className="cq-upload-text">{placeholder}</span>
        </div>
      )}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}

// ─── Custom Quote Popup ───────────────────────────────────────────────
function CustomQuotePopup({
  open,
  initialData,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initialData: CustomQuoteFormData;
  onClose: () => void;
  onSubmit: (data: CustomQuoteFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<CustomQuoteFormData>(initialData);
  const [errors, setErrors] = useState<QuoteFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-fill with saved data whenever it changes
  useEffect(() => { setForm(initialData); }, [initialData]);

  const set =
    <K extends keyof CustomQuoteFormData>(field: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value =
        e.target.type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (errors[field as keyof QuoteFormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };

  const setValue = <K extends keyof CustomQuoteFormData>(field: K, val: string) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ve = validateQuoteForm(form);
    if (Object.keys(ve).length > 0) { setErrors(ve); return; }
    setIsSubmitting(true);
    try { await onSubmit(form); } finally { setIsSubmitting(false); }
  };

  if (!open) return null;

  return (
    <div className="cq-popup-overlay">
      <div className="cq-popup-modal">

        {/* Header */}
        <div className="cq-popup-header">
          <div>
            <h2 className="cq-popup-title">Custom Quote &amp; Link — Setup</h2>
            <p className="cq-popup-subtitle">
              Configure your custom quote page details.
            </p>
          </div>
          <button type="button" className="cq-popup-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="cq-popup-form">

          {/* ── 1. Top Centered Logo ── */}
          <div className="cq-logo-wrapper">
            <ImagePickerField
              label="Upload Company logo"
              value={form.businessLogo}
              onChange={(val) => setValue("businessLogo", val)}
              placeholder="Upload Company logo"
              height="90px"
            />
          </div>

          {/* ── 2. Name & Today's Date ── */}
          <div className="cq-form-grid" style={{ marginTop: 16 }}>
            <div className="cq-form-field">
              <label className="cq-label"><span className="cq-required">* </span>First and Last Name</label>
              <input
                type="text"
                value={form.businessName}
                onChange={set("businessName")}
                placeholder="First and Last Name"
                className={`cq-input${errors.businessName ? " cq-input-error" : ""}`}
              />
              {errors.businessName && <p className="cq-error">{errors.businessName}</p>}
            </div>
            <div className="cq-form-field">
              <label className="cq-label">Date</label>
              <input
                type="text"
                value={todayDisplay()}
                readOnly
                className="cq-input cq-input-readonly"
              />
            </div>
          </div>

          {/* ── 3. Company Photo ── */}
          <div className="cq-form-grid" style={{ marginTop: 16 }}>
            <div className="cq-form-field cq-full-width">
              <ImagePickerField
                label="Upload Company Photo (best if there are people in it)"
                value={form.companyImage}
                onChange={(val) => setValue("companyImage", val)}
                placeholder="Upload Company Photo"
                height="130px"
              />
            </div>
          </div>

          {/* ── 4. Bio Section ── */}
          <div className="cq-form-grid" style={{ marginTop: 16 }}>
            <div className="cq-form-field cq-full-width">
              <label className="cq-label">Insert Bio Here</label>
              <textarea
                value={form.bioText}
                onChange={set("bioText")}
                placeholder="Insert Bio Here"
                className="cq-textarea"
                rows={4}
              />
            </div>
          </div>

          {/* ── 5. Offer & Pricing ── */}
          <div className="cq-form-grid" style={{ marginTop: 16 }}>
            <div className="cq-form-field">
              <label className="cq-label">Offer</label>
              <input
                type="text"
                value={form.discountOffer}
                onChange={set("discountOffer")}
                placeholder="Offer"
                className="cq-input"
              />
            </div>
            <div className="cq-form-field">
              <ImagePickerField
                label="Upload Image"
                value={form.offerImage}
                onChange={(val) => setValue("offerImage", val)}
                placeholder="Upload Image"
                height="80px"
              />
            </div>
            <div className="cq-form-field cq-full-width">
              <label className="cq-label">Offer description</label>
              <input
                type="text"
                value={form.offerDescription}
                onChange={set("offerDescription")}
                placeholder="Offer description"
                className="cq-input"
              />
            </div>
          </div>

          {/* Pricing Row (Display-only per spec: $0.00) */}
          <div className="cq-pricing-block">
            <div className="cq-pricing-row">
              <div><span className="cq-pricing-label">QTY.</span> <strong>1</strong></div>
              <div><span className="cq-pricing-label">PRICE PER VISIT</span> <strong>$0.00</strong></div>
              <div><span className="cq-pricing-label">TOTAL</span> <strong>$0.00</strong></div>
            </div>
            <div className="cq-pricing-summary">
              <div className="cq-pricing-line"><span>Subtotal</span> <span>$0.00</span></div>
              <div className="cq-pricing-line cq-pricing-total"><span>Total</span> <span>$0.00</span></div>
            </div>
          </div>

          {/* ── 6. Images ── */}
          <div className="cq-section-title">Images</div>
          <div className="cq-form-grid cq-grid-5">
            {(["image1","image2","image3","image4","image5"] as const).map((key) => (
              <div key={key} className="cq-form-field">
                <ImagePickerField
                  label=""
                  value={form[key] as string}
                  onChange={(val) => setValue(key, val)}
                  placeholder="Upload Image"
                  height="80px"
                />
              </div>
            ))}
          </div>

          {/* ── 7. Reviews ── */}
          <div className="cq-section-title">Reviews</div>
          {([1, 2, 3, 4] as const).map((n) => (
            <div key={n} className="cq-review-row-wireframe">
              <div className="cq-form-grid">
                <div className="cq-form-field">
                  <ImagePickerField
                    label="Headshot Photo"
                    value={form[`review${n}Photo` as keyof CustomQuoteFormData] as string}
                    onChange={(val) => setValue(`review${n}Photo` as keyof CustomQuoteFormData, val)}
                    placeholder="Headshot"
                    height="70px"
                    circle
                  />
                </div>
                <div className="cq-form-field">
                  <label className="cq-label">Upload Testimonial name</label>
                  <input
                    type="text"
                    value={form[`review${n}Name` as keyof CustomQuoteFormData] as string}
                    onChange={set(`review${n}Name` as keyof CustomQuoteFormData)}
                    placeholder="Upload Testimonial name"
                    className="cq-input"
                  />
                </div>
                <div className="cq-form-field cq-full-width">
                  <ImagePickerField
                    label="Upload Testimonial Screenshot"
                    value={form[`review${n}` as keyof CustomQuoteFormData] as string}
                    onChange={(val) => setValue(`review${n}` as keyof CustomQuoteFormData, val)}
                    placeholder="Upload Testimonial Screenshot"
                    height="100px"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* ── 8. Simple Terms of Service Checkbox & Submit ── */}
          <div className="cq-tos-footer-simple">
            <div className="cq-tos-agree-row">
              <label className="cq-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.sendQuoteAutomatically}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, sendQuoteAutomatically: e.target.checked }))
                  }
                  className="cq-checkbox"
                />
                <span>
                  I agree to the Terms of Service
                </span>
              </label>
            </div>

            <div className="cq-footer-btn-centered">
              <button type="submit" className="cq-btn-approved-pill" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Quote Approved"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Reactivation Page ───────────────────────────────────────────
export default function ReactivationPage() {
  const locationId = useLocationId();

  const [selectedOption, setSelectedOption] = useState<ReactivationOption>("Lite");
  const [onetimeTiming, setOnetimeTiming]   = useState(0); // default: Never
  const [isSaving, setIsSaving]             = useState(false);
  const [showQuotePopup, setShowQuotePopup] = useState(false);
  const [quoteFormData, setQuoteFormData]   = useState<CustomQuoteFormData>(emptyQuoteForm);

  // ── Load settings ────────────────────────────────────────────────────
  const settingsQuery = trpc.reactivation.getSettings.useQuery(
    { locationId },
    { enabled: !!locationId }
  );
  const saveMutation = trpc.reactivation.saveSettings.useMutation();

  const showToast = useCallback((message: string, isError = false) => {
    toast(message, {
      style: isError
        ? { background: "var(--destructive)", color: "var(--destructive-foreground)" }
        : undefined,
    });
  }, []);

  // Populate state from GHL on load
  useEffect(() => {
    if (!settingsQuery.data) return;
    const d = settingsQuery.data;
    setSelectedOption(d.reactivationOption);
    setOnetimeTiming(d.onetimeTiming);
    setQuoteFormData({
      businessLogo:           d.customQuote.businessLogo,
      businessName:           d.customQuote.businessName,
      businessOwnerName:      d.customQuote.businessOwnerName,
      bioText:                d.customQuote.bioText,
      companyImage:           d.customQuote.companyImage,
      discountOffer:          d.customQuote.discountOffer,
      offerDescription:       "",
      offerImage:             "",
      sendQuoteAutomatically: d.customQuote.sendQuoteAutomatically,
      tosLink:                d.customQuote.tosLink,
      showCardSection:        d.customQuote.showCardSection,
      image1:  d.customQuote.image1,
      image2:  d.customQuote.image2,
      image3:  d.customQuote.image3,
      image4:  d.customQuote.image4,
      image5:  d.customQuote.image5,
      review1:      d.customQuote.review1,
      review1Photo: d.customQuote.review1Photo,
      review1Name:  d.customQuote.review1Name,
      review2:      d.customQuote.review2,
      review2Photo: d.customQuote.review2Photo,
      review2Name:  d.customQuote.review2Name,
      review3:      d.customQuote.review3,
      review3Photo: d.customQuote.review3Photo,
      review3Name:  d.customQuote.review3Name,
      review4:      d.customQuote.review4,
      review4Photo: d.customQuote.review4Photo,
      review4Name:  d.customQuote.review4Name,
    });
  }, [settingsQuery.data]);

  // ── Save handlers ────────────────────────────────────────────────────
  const handleSave = async () => {
    if (selectedOption === "Custom Quote & Link") {
      setShowQuotePopup(true);
      return;
    }
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        reactivationOption: selectedOption,
        onetimeTiming: ONETIME_TIMING_LABELS[onetimeTiming],
      });
      showToast("Reactivation settings saved successfully.");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`, true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuoteSubmit = async (data: CustomQuoteFormData) => {
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        reactivationOption: "Custom Quote & Link",
        onetimeTiming: ONETIME_TIMING_LABELS[onetimeTiming],
        customQuoteData: {
          businessLogo:           data.businessLogo,
          businessName:           data.businessName,
          businessOwnerName:      data.businessOwnerName,
          bioText:                data.bioText,
          companyImage:           data.companyImage,
          discountOffer:          data.discountOffer,
          offerDescription:       data.offerDescription,
          offerImage:             data.offerImage,
          sendQuoteAutomatically: data.sendQuoteAutomatically,
          tosLink:                data.tosLink,
          showCardSection:        data.showCardSection,
          image1: data.image1,
          image2: data.image2,
          image3: data.image3,
          image4: data.image4,
          image5: data.image5,
          review1:      data.review1,
          review1Photo: data.review1Photo,
          review1Name:  data.review1Name,
          review2:      data.review2,
          review2Photo: data.review2Photo,
          review2Name:  data.review2Name,
          review3:      data.review3,
          review3Photo: data.review3Photo,
          review3Name:  data.review3Name,
          review4:      data.review4,
          review4Photo: data.review4Photo,
          review4Name:  data.review4Name,
        },
      });
      setQuoteFormData(data);
      showToast("Custom Quote settings saved successfully.");
      setShowQuotePopup(false);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`, true);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Missing locationId guard ─────────────────────────────────────────
  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Reactivation</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
              /reactivation?locationId=YOUR_LOCATION_ID
            </code>{" "}
            URL.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="rs-main reac-page">
      <div className="rs-shell reac-shell">

        {/* ── Page Header ── */}
        <header className="rs-page-header reac-page-header">
          <div>
            <h1 className="reac-main-title">Reactivation</h1>
            <h2 className="reac-sub-title">How it works:</h2>
            <div className="rs-page-copy">
              <p className="rs-how-step">1. Add Contacts manually or a Facebook form</p>
              <p className="rs-how-step">2. We reach out with a message</p>
              <p className="rs-how-step">3. They approve a quote and schedule an scoop</p>
            </div>
          </div>
        </header>

        {/* ── Campaign Option Cards (2-column) ── */}
        <section className="rs-card rs-option-section reac-card">
          <div className="reac-option-grid">
            {REACTIVATION_OPTIONS.map((option) => {
              const isSelected = selectedOption === option;
              return (
                <div key={option} className="rs-option-card-wrapper">
                  <div
                    className={`rs-option-card reac-option-card ${isSelected ? "rs-option-selected" : ""}`}
                    onClick={() => {
                      setSelectedOption(option);
                      if (option === "Custom Quote & Link") {
                        setShowQuotePopup(true);
                      }
                    }}
                  >
                    <div className="reac-option-title">{option}</div>
                    <p className="rs-option-text">
                      {option === "Lite"
                        ? "Lite includes simple text and email follow-up to help bring past customers back without extra work. Automatic messages help remind customers about your service, rebuild trust, and keep your business top of mind so they are more likely to restart service instead of putting it off or choosing someone else. Your phone number and email are included so customers can easily reach out when they are ready."
                        : "Past customers in the Custom Quote w/Link reactivation campaign are automatically added to a text and email follow-up sequence with a personalized company page and self-onboarding link. Customers can view pricing, see your logo, photos, reviews, and company information, then restart service in just a few clicks. Automatic follow-up helps rebuild trust, keeps your business top of mind, and makes it easier for past customers to come back when the timing feels right."}
                    </p>
                    <div className="rs-example-box">
                      <div className="reac-example-label">EXAMPLE</div>
                      <div className="rs-example-content">
                        <img
                          src={option === "Lite" ? EXAMPLE_LITE : EXAMPLE_CUSTOM}
                          alt={`${option} example`}
                          className="rs-example-image"
                        />
                      </div>
                    </div>

                    {/* Centered Radio Circle at bottom center of card (matching screenshot) */}
                    <div className="reac-card-radio-bottom">
                      <div className={`reac-card-radio-circle ${isSelected ? "reac-radio-checked" : ""}`}>
                        {isSelected && <div className="reac-radio-dot" />}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── One-Time Service Outreach Scheduling ── */}
        <section className="rs-card rs-scheduling-section reac-card">
          <div className="rs-section-heading">
            <div>
              <h2 className="rs-title">One-Time Service Outreach Scheduling</h2>
              <p className="rs-subtitle">
                Choose when you want to begin reactivation outreach to one-time clients (Sweep and Go Only).
              </p>
            </div>
            <span className="rs-current-selection">{ONETIME_TIMING_LABELS[onetimeTiming]}</span>
          </div>

          <div className="rs-slider-panel">
            <input
              type="range"
              min={0}
              max={ONETIME_TIMING_LABELS.length - 1}
              step={1}
              value={onetimeTiming}
              onChange={(e) => setOnetimeTiming(Number.parseInt(e.target.value, 10))}
              style={{ background: sliderBackground(onetimeTiming, ONETIME_TIMING_LABELS.length - 1) }}
              className="rs-slider"
              aria-label="One-time service outreach timing"
            />
            <div className="rs-slider-labels rs-slider-labels-wide">
              {ONETIME_TIMING_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>

          <div className="rs-scheduling-divider" />

          <div className="rs-info-box reac-info-box">
            <div className="rs-info-header">
              <Clock3 className="h-4 w-4 text-primary" />
              <span className="rs-info-title">Important Notes:</span>
            </div>
            <ul className="rs-info-list">
              <li><strong>Messages sent during the day 8 AM to 7 PM</strong></li>
              <li><strong>Text messages are throttled, so your delivery will not be affected</strong></li>
            </ul>
          </div>
        </section>

        {/* ── Redesigned Timeline (matching Follow-Up page) ── */}
        <section className="rs-card rs-timeline-section reac-card">
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
                  stroke="var(--primary)"
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

        {/* ── Save Settings Bar ── */}
        <div className="reac-save-bar">
          <button
            type="button"
            className="reac-save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save Settings"}
          </button>
        </div>

      </div>

      {/* Custom Quote Popup */}
      <CustomQuotePopup
        open={showQuotePopup}
        initialData={quoteFormData}
        onClose={() => setShowQuotePopup(false)}
        onSubmit={handleQuoteSubmit}
      />
    </div>
  );
}


