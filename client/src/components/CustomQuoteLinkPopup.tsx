/**
 * CustomQuoteLinkPopup Component
 *
 * A split-panel popup dialog that appears on the Follow-Up (Request Scheduling) page.
 * Triggered by clicking the "Custom Quote & Link" option card.
 *
 * Left Panel:  Visual quote template preview pre-filled with reference content
 *              from pawsitivelypoopfree.com — shows a service quote with company logo,
 *              team photo, bio, pricing, images gallery, and reviews.
 *
 * Right Panel: The existing form fields from the Request Scheduling page —
 *              Company branding uploads, bio, CTA, pricing, gallery, reviews,
 *              Initial Request Scheduling slider, Follow-up Requests slider,
 *              and Save button. All fields map to the same GHL custom values
 *              via the existing saveCustomValuesSettings mutation.
 *
 * Backend:  No changes. Reuses trpc.requestScheduling.saveCustomValuesSettings.
 *           Custom fields: lead_follow_up_option, initial_request_scheduling, follow_up_limit
 *
 * Modular:  Designed to be duplicated/extended for S&G Link popup in the future.
 */

import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Upload,
  X,
  Image,
  Star,
  Quote,
  Save,
  Loader2,
  Trash2,
  Plus,
  FileText,
  Edit3,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ─── Types ───────────────────────────────────────────────────────────

interface QuoteFormData {
  // Company branding
  companyLogo: string | null;
  teamPhoto: string | null;
  // Bio section
  bioTitle: string;
  bioDescription: string;
  bioImage: string | null;
  // CTA section
  ctaText: string;
  ctaDescription: string;
  // Pricing
  pricingBio: string;
  pricingTotal: string;
  pricingSixMonths: string;
  pricingOneYear: string;
  // Images gallery
  galleryImages: string[];
  // Reviews
  reviews: ReviewEntry[];
}

interface ReviewEntry {
  reviewerName: string;
  reviewText: string;
  rating: number;
}

interface CustomQuoteLinkPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  leadFollowUpOption: "Lite" | "S&G Link" | "Custom Quote & Link";
  initialTiming: number; // 0-4 (matches 5-option slider on RequestScheduling page)
  followUpCount: number;
  onTimingChange: (value: number) => void;
  onFollowUpChange: (value: number) => void;
  onSaveSuccess: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────

const TIMING_LABELS = ["Immediately", "Next Day", "48 Hours Later", "72 Hours Later", "One Week from Now"] as const;

const FOLLOWUP_CUSTOM_VALUES: Record<number, "0" | "1" | "2" | "3"> = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
};

// Default prefilled content from pawsitivelypoopfree.com/quote/new-quote-title/
const DEFAULT_FORM: QuoteFormData = {
  companyLogo: "/quote-preview/company-logo.svg",
  teamPhoto: "/quote-preview/team-photo.jpg",
  bioTitle: "Utah's Highest Rated Pooper Scooper Service",
  bioDescription:
    "Serving dog owners across the Wasatch Front, our Utah team keeps your yard clean, fresh, and hassle-free. Whether you\u2019re in Salt Lake, Utah County, Davis, or the surrounding areas, we provide reliable pet waste removal on a schedule that works for you. Our friendly scoopers handle the dirty work so you can enjoy a clean yard, more time with your pets, and peace of mind knowing everything is sanitary. Locally operated, affordable, and backed by great customer care, Rocky Mountain Pooper Scoopers is here to make life easier\u2014one yard at a time.",
  bioImage: null,
  ctaText: "Quote Approved",
  ctaDescription: "Click to approve this quote and schedule your service.",
  pricingBio: "$19.00",
  pricingTotal: "$9.99",
  pricingSixMonths: "$0.00",
  pricingOneYear: "$0.00",
  galleryImages: [
    "/quote-preview/gallery-1.jpg",
    "/quote-preview/gallery-2.jpg",
    "/quote-preview/gallery-3.jpg",
    "/quote-preview/gallery-4.jpg",
    "/quote-preview/gallery-5.jpg",
    "/quote-preview/gallery-6.jpg",
  ],
  reviews: [
    {
      reviewerName: "Joshua & Megan",
      reviewText:
        "I thought hiring a pooper scooper was lazy\u2026 until I tried it. Now I tell all my neighbors. It\u2019s like outsourcing laundry: not glamorous, but it changes your week.",
      rating: 5,
    },
    {
      reviewerName: "Amber K.",
      reviewText:
        "They didn\u2019t just scoop \u2014 they noticed my gate hinge was loose and mentioned it so I could fix it before the dog escaped. Small details like that make me trust them completely.",
      rating: 5,
    },
    {
      reviewerName: "Marcus L.",
      reviewText:
        "With two big labs, it used to feel like a minefield out there. Now it\u2019s just\u2026 a yard. Clean, fresh, and useable again. Pricing is fair, and honestly cheaper than the arguments I used to have with my kids about whose turn it was.",
      rating: 5,
    },
    {
      reviewerName: "Samantha P.",
      reviewText:
        "They text me before arriving, close the gate every time, and even give the dog a pat if he\u2019s out. Super reliable and respectful service. My only regret is not signing up sooner.",
      rating: 5,
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function sliderBackground(value: number, max: number = 3) {
  const pct = (value / max) * 100;
  const fill = "#2563eb";
  const empty = "var(--border)";
  return `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, ${empty} ${pct}%, ${empty} 100%)`;
}

// ─── Star Rating Component ───────────────────────────────────────────

function StarRating({ rating, onRate, readonly }: { rating: number; onRate?: (r: number) => void; readonly?: boolean }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onRate?.(star)}
          disabled={readonly}
          className={`p-0 border-none bg-transparent cursor-pointer ${readonly ? "cursor-default" : ""}`}
        >
          <Star
            size={14}
            className={
              star <= rating
                ? "fill-amber-400 text-amber-400"
                : "text-slate-300"
            }
          />
        </button>
      ))}
    </div>
  );
}

// ─── Left Panel: Quote Template Preview ──────────────────────────────

function QuoteTemplatePreview({ formData }: { formData: QuoteFormData }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-full">
      {/* Header with logo */}
      <div className="flex items-center justify-center px-5 py-4 border-b border-slate-100">
        {formData.companyLogo ? (
          <img
            src={formData.companyLogo}
            alt="Company Logo"
            className="h-12 object-contain"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="h-10 w-32 bg-slate-100 rounded flex items-center justify-center text-[11px] text-slate-400">
            Your Logo
          </div>
        )}
      </div>

      {/* Hero image */}
      <div className="relative">
        {formData.teamPhoto ? (
          <img
            src={formData.teamPhoto}
            alt="Team Photo"
            className="w-full h-44 object-cover"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="w-full h-44 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <div className="text-center">
              <Image className="w-10 h-10 text-slate-300 mx-auto mb-1" />
              <span className="text-[11px] text-slate-400">
                Upload Company Photo
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bio section */}
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 mb-1.5">
          {formData.bioTitle || "Your Bio Title Here"}
        </h3>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          {formData.bioDescription ||
            "Your bio description will appear here. Explain your service, what makes you different, and why customers should choose you."}
        </p>
      </div>

      {/* Pricing section */}
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-800">
            {formData.pricingBio || "Free Trial"}
          </span>
          <span className="bg-red-500 text-white text-[9px] font-bold px-2.5 py-0.5 rounded-full">
            FREE
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center">
            <span className="block text-[10px] text-slate-500">Total</span>
            <span className="block text-[11px] font-bold text-slate-700">
              {formData.pricingTotal || "$0.00"}
            </span>
          </div>
          <div className="text-center">
            <span className="block text-[10px] text-slate-500">Monthly</span>
            <span className="block text-[11px] font-bold text-slate-700">
              {formData.pricingBio || "$0.00"}
            </span>
          </div>
          <div className="text-center">
            <span className="block text-[10px] text-slate-500">6 Months</span>
            <span className="block text-[11px] font-bold text-slate-700">
              {formData.pricingSixMonths || "$0.00"}
            </span>
          </div>
          <div className="text-center">
            <span className="block text-[10px] text-slate-500">1 Year</span>
            <span className="block text-[11px] font-bold text-slate-700">
              {formData.pricingOneYear || "$0.00"}
            </span>
          </div>
        </div>
      </div>

      {/* CTA section */}
      <div className="px-5 py-4 border-b border-slate-100">
        <p className="text-xs font-semibold text-blue-700 mb-0.5">
          {formData.ctaText || "CTA text here"}
        </p>
        <p className="text-[11px] text-slate-500">
          {formData.ctaDescription || "CTA description here"}
        </p>
      </div>

      {/* Images gallery */}
      <div className="px-5 py-4 border-b border-slate-100">
        <h4 className="text-[11px] font-bold text-slate-700 mb-2.5">
          Images
        </h4>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {formData.galleryImages.length > 0 ? (
            formData.galleryImages.map((img, idx) => (
              <div
                key={idx}
                className="w-16 h-16 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 shadow-sm"
              >
                <img
                  src={img}
                  alt={`Gallery ${idx + 1}`}
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                />
              </div>
            ))
          ) : (
            <>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="w-16 h-16 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center flex-shrink-0"
                >
                  <Image size={14} className="text-slate-300" />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Reviews section */}
      <div className="px-5 py-4">
        <h4 className="text-[11px] font-bold text-slate-700 mb-3">Reviews</h4>
        {formData.reviews.length > 0 ? (
          <div className="space-y-3 max-h-40 overflow-y-auto">
            {formData.reviews.map((review, idx) => (
              <div key={idx} className="bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <StarRating rating={review.rating} readonly />
                  <span className="text-[11px] font-semibold text-slate-700">
                    {review.reviewerName}
                  </span>
                </div>
                <p className="text-[10px] text-slate-600 leading-relaxed">
                  {review.reviewText}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 italic">
            No reviews added yet.
          </p>
        )}
      </div>

      {/* Bottom CTA button */}
      <div className="px-5 py-4 border-t border-slate-100 flex justify-center">
        <button
          type="button"
          className="px-8 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors"
          disabled
        >
          {formData.ctaText || "Quote Approved"}
        </button>
      </div>
    </div>
  );
}

// ─── Right Panel: Form Fields ────────────────────────────────────────

function QuoteFormFields({
  formData,
  setFormData,
  initialTiming,
  followUpCount,
  onTimingChange,
  onFollowUpChange,
  onSave,
  isSaving,
}: {
  formData: QuoteFormData;
  setFormData: (data: QuoteFormData) => void;
  initialTiming: number;
  followUpCount: number;
  onTimingChange: (v: number) => void;
  onFollowUpChange: (v: number) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const bioImageInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (
    file: File | undefined,
    field: "companyLogo" | "teamPhoto" | "bioImage"
  ) => {
    if (!file) return;
    const base64 = await fileToBase64(file);
    setFormData({ ...formData, [field]: base64 });
  };

  const handleGalleryUpload = async (files: FileList | null) => {
    if (!files) return;
    const newImages: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const base64 = await fileToBase64(files[i]);
      newImages.push(base64);
    }
    setFormData({
      ...formData,
      galleryImages: [...formData.galleryImages, ...newImages],
    });
  };

  const handleRemoveGalleryImage = (index: number) => {
    setFormData({
      ...formData,
      galleryImages: formData.galleryImages.filter((_, i) => i !== index),
    });
  };

  const addReview = () => {
    setFormData({
      ...formData,
      reviews: [...formData.reviews, { reviewerName: "", reviewText: "", rating: 5 }],
    });
  };

  const updateReview = (index: number, updates: Partial<ReviewEntry>) => {
    const updated = [...formData.reviews];
    updated[index] = { ...updated[index], ...updates };
    setFormData({ ...formData, reviews: updated });
  };

  const removeReview = (index: number) => {
    setFormData({
      ...formData,
      reviews: formData.reviews.filter((_, i) => i !== index),
    });
  };

  const updateField = (field: keyof QuoteFormData, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <div className="space-y-5">
      {/* ── Company Branding Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <Image size={14} className="text-blue-500" />
          Company Branding
        </h4>
        <div className="space-y-3">
          {/* Company Logo */}
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              Upload Company Logo
            </Label>
            <div
              className="mt-1.5 border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
              onClick={() => logoInputRef.current?.click()}
            >
              {formData.companyLogo ? (
                <div className="flex items-center justify-between">
                  <img
                    src={formData.companyLogo}
                    alt="Logo"
                    className="h-8 object-contain"
                    crossOrigin="anonymous"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, companyLogo: null });
                    }}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <Upload size={18} className="text-slate-400" />
                  <span className="text-[11px] text-slate-500">
                    Upload Logo
                  </span>
                </div>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleImageUpload(e.target.files?.[0], "companyLogo")}
            />
          </div>

          {/* Team Photo */}
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              Team Photo
            </Label>
            <p className="text-[10px] text-slate-400 mb-1">
              Best if there are people in it
            </p>
            <div
              className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
              onClick={() => photoInputRef.current?.click()}
            >
              {formData.teamPhoto ? (
                <div className="flex items-center justify-between">
                  <img
                    src={formData.teamPhoto}
                    alt="Team Photo"
                    className="h-10 object-cover rounded"
                    crossOrigin="anonymous"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, teamPhoto: null });
                    }}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <Upload size={18} className="text-slate-400" />
                  <span className="text-[11px] text-slate-500">
                    Upload Company Photo
                  </span>
                </div>
              )}
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleImageUpload(e.target.files?.[0], "teamPhoto")}
            />
          </div>
        </div>
      </div>

      {/* ── Bio Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <Edit3 size={13} className="text-blue-500" />
          Bio Section
        </h4>
        <div className="space-y-3">
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              Bio Title
            </Label>
            <Input
              value={formData.bioTitle}
              onChange={(e) => updateField("bioTitle", e.target.value)}
              className="mt-1 text-xs h-9"
              placeholder="e.g. Utah's Highest Rated Pooper Scooper Service"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              Bio Description
            </Label>
            <textarea
              value={formData.bioDescription}
              onChange={(e) => updateField("bioDescription", e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[80px]"
              placeholder="Describe your service..."
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              Bio Image
            </Label>
            <div
              className="mt-1.5 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
              onClick={() => bioImageInputRef.current?.click()}
            >
              {formData.bioImage ? (
                <div className="flex items-center justify-between">
                  <img
                    src={formData.bioImage}
                    alt="Bio Image"
                    className="h-10 object-cover rounded"
                    crossOrigin="anonymous"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, bioImage: null });
                    }}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <Upload size={16} className="text-slate-400" />
                  <span className="text-[11px] text-slate-500">Upload Image</span>
                </div>
              )}
            </div>
            <input
              ref={bioImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleImageUpload(e.target.files?.[0], "bioImage")}
            />
          </div>
        </div>
      </div>

      {/* ── CTA Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <Quote size={13} className="text-blue-500" />
          CTA Section
        </h4>
        <div className="space-y-3">
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              CTA Text
            </Label>
            <Input
              value={formData.ctaText}
              onChange={(e) => updateField("ctaText", e.target.value)}
              className="mt-1 text-xs h-9"
              placeholder="e.g. Quote Approved"
              maxLength={15}
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              CTA Description
            </Label>
            <textarea
              value={formData.ctaDescription}
              onChange={(e) => updateField("ctaDescription", e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px]"
              placeholder="Brief CTA description..."
            />
          </div>
        </div>
      </div>

      {/* ── Pricing Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <Save size={13} className="text-blue-500" />
          Pricing
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">Total</Label>
            <Input
              value={formData.pricingTotal}
              onChange={(e) => updateField("pricingTotal", e.target.value)}
              className="mt-1 text-xs h-9"
              placeholder="$0.00"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              Monthly
            </Label>
            <Input
              value={formData.pricingBio}
              onChange={(e) => updateField("pricingBio", e.target.value)}
              className="mt-1 text-xs h-9"
              placeholder="$0.00"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              6 Months
            </Label>
            <Input
              value={formData.pricingSixMonths}
              onChange={(e) => updateField("pricingSixMonths", e.target.value)}
              className="mt-1 text-xs h-9"
              placeholder="$0.00"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600 font-medium">
              1 Year
            </Label>
            <Input
              value={formData.pricingOneYear}
              onChange={(e) => updateField("pricingOneYear", e.target.value)}
              className="mt-1 text-xs h-9"
              placeholder="$0.00"
            />
          </div>
        </div>
      </div>

      {/* ── Images Gallery ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <Image size={13} className="text-blue-500" />
          Images Gallery
        </h4>
        <div
          className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.multiple = true;
            input.onchange = (e) => handleGalleryUpload((e.target as HTMLInputElement).files);
            input.click();
          }}
        >
          <Upload size={18} className="text-slate-400 mx-auto mb-1" />
          <span className="text-[11px] text-slate-500">Upload Images</span>
        </div>
        {formData.galleryImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {formData.galleryImages.map((img, idx) => (
              <div
                key={idx}
                className="relative w-16 h-16 rounded-lg border border-slate-200 overflow-hidden shadow-sm"
              >
                <img
                  src={img}
                  alt={`Gallery ${idx + 1}`}
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                />
                <button
                  onClick={() => handleRemoveGalleryImage(idx)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Reviews Section ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Star size={13} className="text-blue-500" />
            Reviews
          </h4>
          <button
            type="button"
            onClick={addReview}
            className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus size={12} />
            Add Review
          </button>
        </div>
        {formData.reviews.map((review, idx) => (
          <div key={idx} className="bg-slate-50 rounded-lg p-3 mb-2 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <StarRating
                  rating={review.rating}
                  onRate={(r) => updateReview(idx, { rating: r })}
                />
                <input
                  type="text"
                  value={review.reviewerName}
                  onChange={(e) =>
                    updateReview(idx, { reviewerName: e.target.value })
                  }
                  placeholder="Reviewer name"
                  className="text-[11px] bg-transparent border-none outline-none font-semibold text-slate-700 w-28"
                />
              </div>
              <button
                onClick={() => removeReview(idx)}
                className="text-slate-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <textarea
              value={review.reviewText}
              onChange={(e) => updateReview(idx, { reviewText: e.target.value })}
              placeholder="Review text..."
              className="w-full text-[10px] bg-white border border-slate-200 rounded px-2 py-1.5 outline-none focus:border-blue-300 min-h-[40px] resize-none"
            />
          </div>
        ))}
      </div>

      {/* ── Scheduling Sliders ── */}
      <div className="border-t border-slate-200 pt-4">
        <h4 className="text-xs font-bold text-slate-700 mb-4 flex items-center gap-1.5">
          <FileText size={13} className="text-blue-500" />
          Follow-Up Scheduling
        </h4>

        {/* Initial Request Scheduling */}
        <div className="mb-4">
          <Label className="text-[11px] text-slate-600 font-medium">
            Initial Request Scheduling
          </Label>
          <div className="mt-2">
            <input
              type="range"
              min={0}
              max={4}
              step={1}
              value={initialTiming}
              onChange={(event) =>
                onTimingChange(Number.parseInt(event.target.value, 10))
              }
              style={{ background: sliderBackground(initialTiming, 4) }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              aria-label="Initial outreach timing"
            />
            <div className="flex justify-between mt-1">
              {TIMING_LABELS.map((label) => (
                <span
                  key={label}
                  className="text-[9px] text-slate-500 text-center flex-1"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Follow-up Requests */}
        <div className="mb-4">
          <Label className="text-[11px] text-slate-600 font-medium">
            Follow-up Requests
          </Label>
          <div className="mt-2">
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={followUpCount}
              onChange={(event) =>
                onFollowUpChange(Number.parseInt(event.target.value, 10))
              }
              style={{ background: sliderBackground(followUpCount, 3) }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              aria-label="Follow-up count"
            />
            <div className="flex justify-between mt-1">
              {["0", "1", "2", "3"].map((val) => (
                <span
                  key={val}
                  className="text-[9px] text-slate-500 text-center flex-1"
                >
                  {val}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Save Button ── */}
      <div className="border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save size={14} />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main Popup Component ────────────────────────────────────────────

export default function CustomQuoteLinkPopup({
  open,
  onOpenChange,
  locationId,
  leadFollowUpOption,
  initialTiming,
  followUpCount,
  onTimingChange,
  onFollowUpChange,
  onSaveSuccess,
}: CustomQuoteLinkPopupProps) {
  const [formData, setFormData] = useState<QuoteFormData>(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "form">("preview");

  const saveMutation = trpc.requestScheduling.saveCustomValuesSettings.useMutation();

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        leadFollowUpOption: leadFollowUpOption,
        initialRequestScheduling: TIMING_LABELS[initialTiming],
        followUpLimit: FOLLOWUP_CUSTOM_VALUES[followUpCount],
      });
      toast.success("Settings saved successfully.");
      onSaveSuccess();
      onOpenChange(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Error saving settings: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, [locationId, leadFollowUpOption, initialTiming, followUpCount, saveMutation, onSaveSuccess, onOpenChange]);

  const handleClose = (open: boolean) => {
    if (!open) {
      // Reset form when closing
      setFormData(DEFAULT_FORM);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[92vw] w-[92vw] sm:max-w-[90vw] lg:max-w-[88vw] p-0 gap-0 overflow-hidden max-h-[92vh] rounded-xl">
        <DialogHeader className="px-7 pt-5 pb-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-bold text-slate-800">
                Custom Quote & Link
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-0.5">
                Design your quote template and configure follow-up scheduling.
              </DialogDescription>
            </div>
            {/* Tab switcher for mobile */}
            <div className="flex lg:hidden items-center gap-1 bg-slate-200 rounded-lg p-0.5">
              <button
                onClick={() => setActiveTab("preview")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "preview"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600"
                }`}
              >
                Template
              </button>
              <button
                onClick={() => setActiveTab("form")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "form"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600"
                }`}
              >
                Create Yours
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Split panel body */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden">
          {/* Left Panel: Template Preview */}
          <div
            className={`${
              activeTab === "preview" ? "block" : "hidden lg:block"
            } bg-white border-r border-slate-200 overflow-y-auto`}
            style={{ maxHeight: "calc(92vh - 60px)" }}
          >
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-blue-600 flex items-center gap-1.5">
                  Template
                </h3>
                <span className="text-[10px] text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full">
                  Preview
                </span>
              </div>
              <QuoteTemplatePreview formData={formData} />
            </div>
          </div>

          {/* Right Panel: Form Fields */}
          <div
            className={`${
              activeTab === "form" ? "block" : "hidden lg:block"
            } overflow-y-auto bg-slate-50`}
            style={{ maxHeight: "calc(92vh - 60px)" }}
          >
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-blue-600 flex items-center gap-1.5">
                  Create Yours
                </h3>
                <span className="text-[10px] text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full">
                  Form Fields
                </span>
              </div>
              <QuoteFormFields
                formData={formData}
                setFormData={setFormData}
                initialTiming={initialTiming}
                followUpCount={followUpCount}
                onTimingChange={onTimingChange}
                onFollowUpChange={onFollowUpChange}
                onSave={handleSave}
                isSaving={isSaving}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
