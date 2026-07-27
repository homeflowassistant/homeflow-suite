/**
 * CustomQuoteLinkPopup Component
 *
 * A split-panel popup dialog that appears on the Follow-Up (Request Scheduling) page.
 *
 * Left Panel:  Visual quote template preview matching the reference design from
 *              pawsitivelypoopfree.com — shows a service quote with company logo,
 *              team photo, bio, pricing, images gallery, and reviews.
 *
 * Right Panel: The existing form fields from the Request Scheduling page —
 *              Initial Request Scheduling slider, Follow-up Requests slider,
 *              and Save button. All fields map to the same GHL custom values
 *              via the existing saveCustomValuesSettings mutation.
 *
 * Backend:  No changes. Reuses trpc.requestScheduling.saveCustomValuesSettings.
 *           Custom fields: initial_request_scheduling, follow_up_limit
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
  ChevronLeft,
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

const DEFAULT_FORM: QuoteFormData = {
  companyLogo: null,
  teamPhoto: null,
  bioTitle: "",
  bioDescription: "",
  bioImage: null,
  ctaText: "",
  ctaDescription: "",
  pricingBio: "",
  pricingTotal: "",
  pricingSixMonths: "",
  pricingOneYear: "",
  galleryImages: [],
  reviews: [],
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
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden h-full">
      {/* Header with logo */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        {formData.companyLogo ? (
          <img
            src={formData.companyLogo}
            alt="Company Logo"
            className="h-8 object-contain"
          />
        ) : (
          <div className="h-8 w-24 bg-slate-100 rounded flex items-center justify-center text-[10px] text-slate-400">
            Your Logo
          </div>
        )}
        <span className="text-[10px] text-slate-400 font-medium">
          Quote of {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>

      {/* Hero image */}
      <div className="relative">
        {formData.teamPhoto ? (
          <img
            src={formData.teamPhoto}
            alt="Team Photo"
            className="w-full h-36 object-cover"
          />
        ) : (
          <div className="w-full h-36 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <div className="text-center">
              <Image className="w-8 h-8 text-slate-300 mx-auto mb-1" />
              <span className="text-[10px] text-slate-400">Upload Company Photo</span>
            </div>
          </div>
        )}
      </div>

      {/* Bio section */}
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-xs font-bold text-slate-800 mb-1">
          {formData.bioTitle || "Why I signed... and how it's the..."}
        </h3>
        <p className="text-[10px] text-slate-600 leading-relaxed">
          {formData.bioDescription || "Your bio description will appear here. Explain your service, what makes you different, and why customers should choose you."}
        </p>
      </div>

      {/* Pricing section */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-xs font-bold text-slate-800">
              {formData.pricingBio || "Free Trial"}
            </span>
          </div>
          <span className="bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded">
            FREE
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <div className="text-center">
            <span className="block text-[9px] text-slate-500">Total</span>
            <span className="block text-[10px] font-bold text-slate-700">{formData.pricingTotal || "$0.00"}</span>
          </div>
          <div className="text-center">
            <span className="block text-[9px] text-slate-500">Monthly</span>
            <span className="block text-[10px] font-bold text-slate-700">{formData.pricingBio || "$0.00"}</span>
          </div>
          <div className="text-center">
            <span className="block text-[9px] text-slate-500">6 Months</span>
            <span className="block text-[10px] font-bold text-slate-700">{formData.pricingSixMonths || "$0.00"}</span>
          </div>
          <div className="text-center">
            <span className="block text-[9px] text-slate-500">1 Year</span>
            <span className="block text-[10px] font-bold text-slate-700">{formData.pricingOneYear || "$0.00"}</span>
          </div>
        </div>
      </div>

      {/* CTA section */}
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-xs font-semibold text-blue-700 mb-0.5">
          {formData.ctaText || "CTA text here"}
        </p>
        <p className="text-[10px] text-slate-500">
          {formData.ctaDescription || "CTA bio description here"}
        </p>
      </div>

      {/* Images gallery */}
      <div className="px-4 py-3 border-b border-slate-100">
        <h4 className="text-[10px] font-bold text-slate-700 mb-2">Images</h4>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {formData.galleryImages.length > 0 ? (
            formData.galleryImages.map((img, idx) => (
              <div
                key={idx}
                className="w-14 h-14 rounded border border-slate-200 overflow-hidden flex-shrink-0"
              >
                <img src={img} alt={`Gallery ${idx + 1}`} className="w-full h-full object-cover" />
              </div>
            ))
          ) : (
            <>
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="w-14 h-14 rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center flex-shrink-0"
                >
                  <Image size={12} className="text-slate-300" />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Reviews section */}
      <div className="px-4 py-3">
        <h4 className="text-[10px] font-bold text-slate-700 mb-2">Reviews</h4>
        {formData.reviews.length > 0 ? (
          <div className="space-y-2 max-h-28 overflow-y-auto">
            {formData.reviews.map((review, idx) => (
              <div key={idx} className="bg-slate-50 rounded p-2">
                <div className="flex items-center gap-1 mb-0.5">
                  <StarRating rating={review.rating} readonly />
                  <span className="text-[10px] font-semibold text-slate-700">{review.reviewerName}</span>
                </div>
                <p className="text-[9px] text-slate-600 leading-relaxed">{review.reviewText}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-slate-400 italic">No reviews added yet.</p>
        )}
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
    setFormData({ ...formData, galleryImages: [...formData.galleryImages, ...newImages] });
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
      reviews: [
        ...formData.reviews,
        { reviewerName: "", reviewText: "", rating: 5 },
      ],
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
    <div className="space-y-4">
      {/* ── Company Branding Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <Image size={13} className="text-blue-500" />
          Company Branding
        </h4>
        <div className="space-y-3">
          {/* Company Logo */}
          <div>
            <Label className="text-[11px] text-slate-600">Upload Company Logo</Label>
            <div
              className="mt-1 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
              onClick={() => logoInputRef.current?.click()}
            >
              {formData.companyLogo ? (
                <div className="flex items-center justify-between">
                  <img src={formData.companyLogo} alt="Logo" className="h-8 object-contain" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, companyLogo: null });
                    }}
                    className="text-red-400 hover:text-red-600"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <Upload size={16} className="text-slate-400" />
                  <span className="text-[10px] text-slate-500">Upload Company Logo</span>
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
            <Label className="text-[11px] text-slate-600">Team Photo</Label>
            <div
              className="mt-1 border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
              onClick={() => photoInputRef.current?.click()}
            >
              {formData.teamPhoto ? (
                <div className="flex items-center justify-between">
                  <img src={formData.teamPhoto} alt="Team" className="h-20 object-cover rounded mx-auto" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, teamPhoto: null });
                    }}
                    className="absolute text-red-400 hover:text-red-600"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <Upload size={18} className="text-slate-400" />
                  <span className="text-[10px] text-slate-500">Upload Company Photo</span>
                  <span className="text-[9px] text-slate-400">Best if there are people in it</span>
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
        <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <Quote size={13} className="text-blue-500" />
          Bio Section
        </h4>
        <div className="space-y-2">
          <div>
            <Label className="text-[11px] text-slate-600">Bio Title</Label>
            <Input
              value={formData.bioTitle}
              onChange={(e) => updateField("bioTitle", e.target.value)}
              placeholder="Insert Bio Here"
              className="h-8 text-xs mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600">Bio Description</Label>
            <textarea
              value={formData.bioDescription}
              onChange={(e) => updateField("bioDescription", e.target.value)}
              placeholder="Enter bio description here..."
              rows={3}
              className="w-full mt-1 text-xs border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600">Bio Image</Label>
            <div
              className="mt-1 border-2 border-dashed border-slate-300 rounded-lg p-3 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
              onClick={() => bioImageInputRef.current?.click()}
            >
              {formData.bioImage ? (
                <div className="flex items-center justify-between">
                  <img src={formData.bioImage} alt="Bio" className="h-12 object-cover rounded" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, bioImage: null });
                    }}
                    className="text-red-400 hover:text-red-600"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1">
                  <Upload size={14} className="text-slate-400" />
                  <span className="text-[10px] text-slate-500">Upload Image</span>
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
        <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <ChevronLeft size={13} className="text-blue-500" />
          CTA Section
        </h4>
        <div className="space-y-2">
          <div>
            <Label className="text-[11px] text-slate-600">CTA Text (max 15 chars)</Label>
            <Input
              value={formData.ctaText}
              onChange={(e) => updateField("ctaText", e.target.value.slice(0, 15))}
              placeholder="CTA text"
              className="h-8 text-xs mt-1"
              maxLength={15}
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600">CTA Description</Label>
            <Input
              value={formData.ctaDescription}
              onChange={(e) => updateField("ctaDescription", e.target.value)}
              placeholder="CTA bio description"
              className="h-8 text-xs mt-1"
            />
          </div>
        </div>
      </div>

      {/* ── Pricing Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <span className="text-blue-500">$</span>
          Pricing
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[11px] text-slate-600">Total</Label>
            <Input
              value={formData.pricingTotal}
              onChange={(e) => updateField("pricingTotal", e.target.value)}
              placeholder="$0.00"
              className="h-8 text-xs mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600">Bio / Monthly</Label>
            <Input
              value={formData.pricingBio}
              onChange={(e) => updateField("pricingBio", e.target.value)}
              placeholder="$0.00"
              className="h-8 text-xs mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600">6 Months</Label>
            <Input
              value={formData.pricingSixMonths}
              onChange={(e) => updateField("pricingSixMonths", e.target.value)}
              placeholder="$0.00"
              className="h-8 text-xs mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px] text-slate-600">1 Year</Label>
            <Input
              value={formData.pricingOneYear}
              onChange={(e) => updateField("pricingOneYear", e.target.value)}
              placeholder="$0.00"
              className="h-8 text-xs mt-1"
            />
          </div>
        </div>
      </div>

      {/* ── Images Gallery Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <Image size={13} className="text-blue-500" />
          Images
        </h4>
        <div className="flex flex-wrap gap-2">
          {formData.galleryImages.map((img, idx) => (
            <div
              key={idx}
              className="relative w-16 h-16 rounded border border-slate-200 overflow-hidden group"
            >
              <img src={img} alt={`Gallery ${idx + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => handleRemoveGalleryImage(idx)}
                className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <label className="w-16 h-16 rounded border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:border-blue-400 bg-slate-50">
            <div className="flex flex-col items-center gap-0.5">
              <Plus size={14} className="text-slate-400" />
              <span className="text-[8px] text-slate-400">Upload</span>
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleGalleryUpload(e.target.files)}
            />
          </label>
        </div>
      </div>

      {/* ── Reviews Section ── */}
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
          <Star size={13} className="text-blue-500" />
          Reviews
        </h4>
        <div className="space-y-2">
          {formData.reviews.map((review, idx) => (
            <div key={idx} className="bg-slate-50 rounded-lg p-2 border border-slate-200">
              <div className="flex items-center gap-2 mb-1">
                <StarRating
                  rating={review.rating}
                  onRate={(r) => updateReview(idx, { rating: r })}
                />
                <button
                  onClick={() => removeReview(idx)}
                  className="text-red-400 hover:text-red-600 ml-auto"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <Input
                value={review.reviewerName}
                onChange={(e) => updateReview(idx, { reviewerName: e.target.value })}
                placeholder="Reviewer name"
                className="h-7 text-xs mb-1"
              />
              <textarea
                value={review.reviewText}
                onChange={(e) => updateReview(idx, { reviewText: e.target.value })}
                placeholder="Review text..."
                rows={2}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
          ))}
          <button
            onClick={addReview}
            className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-[10px] text-slate-500 hover:border-blue-400 hover:text-blue-500 transition-colors flex items-center justify-center gap-1"
          >
            <Plus size={12} />
            Upload Testimonial/Review
          </button>
        </div>
      </div>

      {/* ── Request Scheduling Fields (Existing) ── */}
      <div className="border-t border-slate-200 pt-4">
        <h4 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <Save size={13} className="text-blue-500" />
          Request Scheduling
        </h4>

        {/* Initial Request Scheduling */}
        <div className="mb-4">
          <Label className="text-[11px] text-slate-600 block mb-1">Initial Request Scheduling</Label>
          <p className="text-[10px] text-slate-400 mb-2">
            Choose when to send review requests to your contacts.
          </p>
          <div className="text-center text-lg font-bold text-blue-600 mb-2">
            {TIMING_LABELS[initialTiming]}
          </div>
          <div className="mb-1">
            <input
              type="range"
              min={0}
              max={4}
              step={1}
              value={initialTiming}
              onChange={(e) => onTimingChange(Number.parseInt(e.target.value, 10))}
              style={{ background: sliderBackground(initialTiming, 4) }}
              className="w-full h-2 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
              aria-label="Initial request timing"
            />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-slate-500">Immediately</span>
              <span className="text-[9px] text-slate-500">Next Day</span>
              <span className="text-[9px] text-slate-500">48h Later</span>
              <span className="text-[9px] text-slate-500">72h Later</span>
              <span className="text-[9px] text-slate-500">1 Week</span>
            </div>
          </div>
          <div className="bg-blue-50 rounded px-2 py-1 text-[10px] text-blue-600 mt-1">
            Stored in <code className="font-mono">{"{{custom_values.initial_request_scheduling}}"}</code>
          </div>
        </div>

        {/* Follow-up Requests */}
        <div className="mb-4">
          <Label className="text-[11px] text-slate-600 block mb-1">Follow-up Requests</Label>
          <p className="text-[10px] text-slate-400 mb-2">
            Select the number of follow-up requests to send if no response is received.
          </p>
          <div className="text-center text-lg font-bold text-blue-600 mb-2">
            {followUpCount === 0 ? "No Follow-ups" : `${followUpCount} Follow-up${followUpCount > 1 ? "s" : ""}`}
          </div>
          <div className="mb-1">
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={followUpCount}
              onChange={(e) => onFollowUpChange(Number.parseInt(e.target.value, 10))}
              style={{ background: sliderBackground(followUpCount) }}
              className="w-full h-2 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
              aria-label="Number of follow-up requests"
            />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-slate-500">0</span>
              <span className="text-[9px] text-slate-500">1</span>
              <span className="text-[9px] text-slate-500">2</span>
              <span className="text-[9px] text-slate-500">3</span>
            </div>
          </div>
          <div className="bg-blue-50 rounded px-2 py-1 text-[10px] text-blue-600 mt-1">
            Stored in <code className="font-mono">{"{{custom_values.follow_up_limit}}"}</code>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={onSave}
          disabled={isSaving}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
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
      <DialogContent className="max-w-5xl w-[95vw] p-0 gap-0 overflow-hidden max-h-[90vh]">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-slate-200 bg-slate-50">
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
            style={{ maxHeight: "calc(90vh - 60px)" }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-blue-600 flex items-center gap-1.5">
                  Template
                </h3>
                <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
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
            style={{ maxHeight: "calc(90vh - 60px)" }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-blue-600 flex items-center gap-1.5">
                  Create Yours
                </h3>
                <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
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
