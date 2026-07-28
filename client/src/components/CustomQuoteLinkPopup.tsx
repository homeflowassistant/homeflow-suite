/**
 * CustomQuoteLinkPopup Component
 *
 * Split-panel popup dialog matching the Canva slide 7 design for the
 * Follow-Up (Request Scheduling) page. Triggered by clicking the
 * "Custom Quote & Link" option card.
 *
 * Layout (per Canva design):
 *   - Title: "Custom Quote & Link" with "How it works" instructions
 *   - Two tab buttons: "Template" | "Create Yours"
 *   - Left panel: Read-only quote template preview (prefilled)
 *   - Right panel: Form fields for creating the quote
 *   - Synced scrolling between left and right panels
 *
 * Backend:  No changes. Reuses trpc.requestScheduling.saveCustomValuesSettings.
 * Modular:  Designed to be duplicated/extended for S&G Link popup in the future.
 *
 * Defaults:
 *   - Logo: generic-logo.jpg
 *   - Team Photo: dog-photo.jpg
 *   - Bio Title: [service area] Highest Rated Pooper Scooper Service
 *   - Bio Description: generic service description with [company name]
 *   - Offer 1: WEEKLY | Dog Waste Removal ($19.00) - name/price fixed, description + image editable
 *   - Offer 2: 2 Weeks FREE ($0.00) - name/price fixed, description + image editable
 *   - Pricing: Subtotal + Total ($9.99)
 *   - Gallery: max 6 images, defaults with dog photos
 *   - Reviews: exactly 4 required (no add/remove)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Upload,
  X,
  Image,
  Star,
  Save,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ─── Types ───────────────────────────────────────────────────────────

interface QuoteOffer {
  name: string;          // Fixed / read-only
  price: string;         // Fixed / read-only
  description: string;   // Editable
  image: string | null;  // Editable (upload)
}

interface QuoteFormData {
  companyName: string;
  timeCompanyStarted: string;
  companyLogo: string | null;
  teamPhoto: string | null;
  bioTitle: string;
  bioDescription: string;
  offers: QuoteOffer[];    // Two offers: paid + free
  price1: string;          // Subtotal
  price2: string;          // Total
  galleryImages: string[];
  testimonialHeadshots: (string | null)[];
  testimonialNames: string[];
  testimonialScreenshots: (string | null)[];
}

interface CustomQuoteLinkPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  leadFollowUpOption: "Lite" | "S&G Link" | "Custom Quote & Link";
  initialTiming: number;
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

// ─── Default prefilled content ───────────────────────────────────────

const DEFAULT_FORM: QuoteFormData = {
  companyName: "[Your Company Name]",
  timeCompanyStarted: "2018",
  companyLogo: "/quote-preview/generic-logo.jpg",
  teamPhoto: "/quote-preview/dog-photo.jpg",
  bioTitle: "[service area] Highest Rated Pooper Scooper Service",
  bioDescription:
    "Serving dog owners across the city, our team keeps your yard clean, fresh, and hassle-free. We provide reliable pet waste removal on a schedule that works for you. Our friendly scoopers handle the dirty work so you can enjoy a clean yard, more time with your pets, and peace of mind knowing everything is sanitary. Locally operated, affordable, and backed by great customer care, [company name] is here to make life easier\u2014one yard at a time.",
  offers: [
    {
      name: "WEEKLY | Dog Waste Removal",
      price: "$19.00",
      description:
        "Experience the joy of a hassle-free yard with our weekly dog waste removal service for your furry friend! Just one visit every week is all it takes to keep your yard clean and fresh for your beloved pup. \ud83d\udc3e",
      image: "/quote-preview/offer-image-1.png",
    },
    {
      name: "2 Weeks FREE",
      price: "$0.00",
      description:
        "Experience the joy of a hassle-free yard with our weekly dog waste removal service for your furry friend! Just one visit every week is all it takes to keep your yard clean and fresh for your beloved pup. \ud83d\udc3e",
      image: "/quote-preview/offer-image-2.png",
    },
  ],
  price1: "$9.99",
  price2: "$9.99",
  galleryImages: [
    "/quote-preview/dog-photo.jpg",
    "/quote-preview/dog-photo-2.jpg",
    "/quote-preview/dog-photo-3.jpg",
    "/quote-preview/dog-photo-4.jpg",
    "/quote-preview/dog-photo-5.jpg",
    "/quote-preview/dog-photo-6.jpg",
  ],
  testimonialHeadshots: [
    null,
    "/quote-preview/review-avatar-2.jpg",
    "/quote-preview/review-avatar-3.jpg",
    null,
  ],
  testimonialNames: ["Joshua -n- Megan", "Amber K.", "Marcus L.", "Samantha P."],
  testimonialScreenshots: [null, null, null, null],
};

// Maximum number of gallery images allowed
const MAX_GALLERY_IMAGES = 6;

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
    <div className="bg-white overflow-hidden">
      {/* Header with company logo (centered, no border, matching live site) */}
      <div className="flex items-center justify-center px-5 py-4">
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

      {/* Company name (centered, matching live site) */}
      <div className="px-5 py-2 text-center">
        <h2 className="text-sm font-bold text-slate-800">
          {formData.companyName || "Your Company Name"}
        </h2>
        {formData.timeCompanyStarted && (
          <p className="text-[10px] text-slate-400">Est. {formData.timeCompanyStarted}</p>
        )}
      </div>

      {/* Hero / team photo (full width, no padding, matching live site) */}
      <div className="relative">
        {formData.teamPhoto ? (
          <img
            src={formData.teamPhoto}
            alt="Team Photo"
            className="w-full h-40 object-cover"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="w-full h-40 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <div className="text-center">
              <Image className="w-8 h-8 text-slate-300 mx-auto mb-1" />
              <span className="text-[11px] text-slate-400">
                Upload Company Photo
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bio section (left-aligned, no card, matching live site) */}
      <div className="px-5 py-4">
        <h3 className="text-base font-bold text-slate-800 mb-2">
          {formData.bioTitle || "Your Bio Title Here"}
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          {formData.bioDescription ||
            "Your bio description will appear here."}
        </p>
      </div>

      {/* Offer sections (2 offers matching reference website) */}
      <div className="px-5 pt-4">
        {formData.offers.map((offer, offerIdx) => (
          <div key={offerIdx} className="py-4">
            {/* Offer name (fixed) */}
            <h4 className="text-sm font-bold text-slate-800 mb-0.5">
              {offer.name}
            </h4>
            {/* Offer price (fixed, small) */}
            <span className="text-[11px] text-slate-500 mb-3 block">
              {offer.price}
            </span>
            {/* Description on left + Image on right (matching live site) */}
            <div className="flex gap-3 items-start mt-2">
              <p className="text-[11px] text-slate-600 leading-relaxed flex-1">
                {offer.description || "Offer description here"}
              </p>
              <div className="w-20 h-16 flex-shrink-0">
                {offer.image ? (
                  <img
                    src={offer.image}
                    alt={`Offer ${offerIdx + 1}`}
                    className="w-full h-full object-cover rounded-md"
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-100 rounded-md flex items-center justify-center">
                    <Image size={14} className="text-slate-300" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pricing table (matching reference website - QTY. | PRICE PER VISIT | TOTAL) */}
      <div className="px-5 py-4">
        {formData.offers.map((offer, offerIdx) => (
          <div key={offerIdx}>
            <div className="grid grid-cols-3 gap-4 py-1.5 text-[10px]">
              <div className="text-right text-slate-500 uppercase tracking-wide font-medium">QTY.</div>
              <div className="text-right text-slate-500 uppercase tracking-wide font-medium">PRICE PER VISIT</div>
              <div className="text-right text-slate-500 uppercase tracking-wide font-medium">TOTAL</div>
            </div>
            <div className="grid grid-cols-3 gap-4 py-1.5 text-[11px] border-b border-slate-100">
              <div className="text-right text-slate-700">1</div>
              <div className="text-right text-slate-700">{offer.price}</div>
              <div className="text-right font-medium text-slate-700">{offer.price}</div>
            </div>
          </div>
        ))}
        {/* Subtotal */}
        <div className="grid grid-cols-3 gap-4 py-1.5 text-[11px] border-b border-slate-100">
          <div className="text-left text-slate-600">Subtotal</div>
          <div></div>
          <div className="text-right font-medium text-slate-700">{formData.price1 || "$9.99"}</div>
        </div>
        {/* Total */}
        <div className="grid grid-cols-3 gap-4 py-1.5 text-[11px]">
          <div className="text-left font-bold text-slate-800">Total</div>
          <div></div>
          <div className="text-right font-bold text-slate-800">{formData.price2 || "$9.99"}</div>
        </div>
      </div>

      {/* Images gallery (single row matching live site) */}
      <div className="px-5 py-4">
        <h3 className="text-base font-bold text-slate-800 mb-3">
          Images
        </h3>
        <div className="flex gap-2 overflow-x-auto">
          {formData.galleryImages.length > 0 ? (
            formData.galleryImages.map((img, idx) => (
              <div
                key={idx}
                className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden shadow-sm"
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
                  className="w-20 h-20 flex-shrink-0 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center"
                >
                  <Image size={14} className="text-slate-300" />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Reviews section (matching live site - avatar + name on same row, stars below, no cards) */}
      <div className="px-5 py-4">
        <h3 className="text-base font-bold text-slate-800 mb-4">Reviews</h3>
        <div className="space-y-5">
          {formData.testimonialNames.map((name, idx) => (
            <div key={idx}>
              {/* Avatar + Name on same row */}
              <div className="flex items-center gap-2 mb-1">
                {formData.testimonialHeadshots[idx] ? (
                  <img
                    src={formData.testimonialHeadshots[idx]!}
                    alt={name}
                    className="w-8 h-8 rounded-full object-cover"
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                    <span className="text-[10px] text-slate-400">👤</span>
                  </div>
                )}
                <span className="text-sm font-medium text-slate-700">{name}</span>
              </div>
              {/* Star rating on its own row */}
              <div className="flex gap-0.5 mb-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} size={14} className="fill-amber-400 text-amber-400" />
                ))}
              </div>
              {/* Review text */}
              {formData.testimonialScreenshots[idx] ? (
                <img
                  src={formData.testimonialScreenshots[idx]!}
                  alt={`Testimonial ${name}`}
                  className="w-full rounded-lg border border-slate-100"
                  crossOrigin="anonymous"
                />
              ) : (
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {idx === 0 && "I thought hiring a pooper scooper was lazy... until I tried it. Now I tell all my neighbors. It's like outsourcing laundry: not glamorous, but it changes your week."}
                  {idx === 1 && "They didn't just scoop — they noticed my gate hinge was loose and mentioned it so I could fix it before the dog escaped. Small details like that make me trust them completely."}
                  {idx === 2 && "With two big labs, it used to feel like a minefield out there. Now it's just... a yard. Clean, fresh, and useable again. Pricing is fair, and honestly cheaper than the arguments I used to have with my kids about whose turn it was."}
                  {idx === 3 && "They text me before arriving, close the gate every time, and even give the dog a pat if he's out. Super reliable and respectful service. My only regret is not signing up sooner."}
                </p>
              )}
              {/* Separator */}
              {idx < formData.testimonialNames.length - 1 && (
                <div className="border-b border-slate-100 mt-4"></div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA button (centered, matching live site green pill) */}
      <div className="px-5 py-6 flex justify-center">
        <button
          type="button"
          className="px-8 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-full transition-colors"
          disabled
        >
          Quote Approved
        </button>
      </div>
    </div>
  );
}

// ─── Right Panel: Form Fields ────────────────────────────────────────

function QuoteFormFields({
  formData,
  setFormData,
  onSave,
  isSaving,
}: {
  formData: QuoteFormData;
  setFormData: (data: QuoteFormData) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const offerImageRefs = useRef<(HTMLInputElement | null)[]>([]);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const testimonialScreenshotRefs = useRef<(HTMLInputElement | null)[]>([]);
  const testimonialHeadshotRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleImageUpload = async (
    file: File | undefined,
    field: keyof QuoteFormData
  ) => {
    if (!file) return;
    const base64 = await fileToBase64(file);
    setFormData({ ...formData, [field]: base64 });
  };

  const handleGalleryUpload = async (files: FileList | null) => {
    if (!files) return;
    const remainingSlots = MAX_GALLERY_IMAGES - formData.galleryImages.length;
    if (remainingSlots <= 0) return;
    const newImages: string[] = [];
    for (let i = 0; i < Math.min(files.length, remainingSlots); i++) {
      const base64 = await fileToBase64(files[i]);
      newImages.push(base64);
    }
    setFormData({
      ...formData,
      galleryImages: [...formData.galleryImages, ...newImages].slice(0, MAX_GALLERY_IMAGES),
    });
  };

  const handleRemoveGalleryImage = (index: number) => {
    setFormData({
      ...formData,
      galleryImages: formData.galleryImages.filter((_, i) => i !== index),
    });
  };

  const updateTestimonial = (
    index: number,
    field: "testimonialHeadshots" | "testimonialNames" | "testimonialScreenshots",
    value: string | null
  ) => {
    const updated = [...formData[field]];
    updated[index] = value;
    setFormData({ ...formData, [field]: updated });
  };

  return (
    <div className="space-y-4">
      {/* ── Upload Company Logo ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium">Upload Company logo</label>
        <div className="mt-1 flex items-center gap-2">
          {formData.companyLogo ? (
            <div className="relative">
              <img
                src={formData.companyLogo}
                alt="Logo"
                className="h-8 object-contain rounded border border-slate-200"
                crossOrigin="anonymous"
              />
              <button
                onClick={() => setFormData({ ...formData, companyLogo: null })}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center"
              >
                <X size={9} />
              </button>
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center cursor-pointer hover:border-blue-400"
              onClick={() => logoInputRef.current?.click()}
            >
              <Upload size={14} className="text-slate-400" />
            </div>
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleImageUpload(e.target.files?.[0], "companyLogo")}
          />
        </div>
      </div>

      {/* ── Enter Name ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium">Enter Name</label>
        <Input
          value={formData.companyName}
          onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
          className="mt-1 text-xs h-8"
          placeholder="Company name"
        />
      </div>

      {/* ── Time Company Started ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium">Time Company Started</label>
        <Input
          value={formData.timeCompanyStarted}
          onChange={(e) => setFormData({ ...formData, timeCompanyStarted: e.target.value })}
          className="mt-1 text-xs h-8"
          placeholder="e.g. 2018"
        />
      </div>

      {/* ── Upload Company Photo (large area) ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium">Upload Company Photo</label>
        <p className="text-[10px] text-slate-400 italic mb-1">(best if there are people in it)</p>
        <div
          className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50"
          onClick={() => photoInputRef.current?.click()}
        >
          {formData.teamPhoto ? (
            <div className="relative inline-block">
              <img
                src={formData.teamPhoto}
                alt="Team Photo"
                className="h-24 object-cover rounded"
                crossOrigin="anonymous"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFormData({ ...formData, teamPhoto: null });
                }}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={24} className="text-slate-400" />
              <span className="text-xs text-slate-500 font-medium">Upload Company Photo</span>
              <span className="text-[10px] text-slate-400">(best if there are people in it)</span>
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

      {/* ── Insert Bio Here ── */}
      <div>
        <textarea
          value={formData.bioTitle + "\n\n" + formData.bioDescription}
          onChange={(e) => {
            const parts = e.target.value.split("\n\n");
            setFormData({
              ...formData,
              bioTitle: parts[0] || "",
              bioDescription: parts.slice(1).join("\n\n") || "",
            });
          }}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 min-h-[100px] resize-y"
          placeholder="Insert Bio Here"
        />
      </div>

      {/* ── Offer 1: WEEKLY | Dog Waste Removal ── */}
      <div className="space-y-2">
        <label className="text-[11px] text-slate-500 font-medium">Offer 1</label>
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          {/* Offer name (fixed/read-only) */}
          <div>
            <span className="text-[11px] text-slate-700 font-bold block">{formData.offers[0]?.name}</span>
          </div>
          {/* Offer price (fixed/read-only, small) */}
          <div>
            <span className="text-[11px] text-slate-500">{formData.offers[0]?.price}</span>
          </div>
          {/* Description + Image side by side */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-slate-400">Description</label>
              <textarea
                value={formData.offers[0]?.description || ""}
                onChange={(e) => {
                  const offers = [...formData.offers];
                  offers[0] = { ...offers[0], description: e.target.value };
                  setFormData({ ...formData, offers });
                }}
                className="w-full mt-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 min-h-[70px] resize-y"
                placeholder="Offer description"
              />
            </div>
            <div className="w-24">
              <label className="text-[10px] text-slate-400">Image</label>
              <div
                className="mt-1 border-2 border-dashed border-slate-300 rounded-md h-[70px] flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors bg-white overflow-hidden relative"
                onClick={() => offerImageRefs.current[0]?.click()}
              >
                {formData.offers[0]?.image ? (
                  <img
                    src={formData.offers[0].image}
                    alt="Offer 1 image"
                    className="w-full h-full object-cover"
                    crossOrigin="anonymous"
                  />
                ) : (
                  <Upload size={14} className="text-slate-400" />
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={(el) => { offerImageRefs.current[0] = el; }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    fileToBase64(file).then((b64) => {
                      const offers = [...formData.offers];
                      offers[0] = { ...offers[0], image: b64 };
                      setFormData({ ...formData, offers });
                    });
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Offer 2: 2 Weeks FREE ── */}
      <div className="space-y-2">
        <label className="text-[11px] text-slate-500 font-medium">Offer 2</label>
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          {/* Offer name (fixed/read-only) */}
          <div>
            <span className="text-[11px] text-slate-700 font-bold block">{formData.offers[1]?.name}</span>
          </div>
          {/* Offer price (fixed/read-only, small) */}
          <div>
            <span className="text-[11px] text-slate-500">{formData.offers[1]?.price}</span>
          </div>
          {/* Description + Image side by side */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-slate-400">Description</label>
              <textarea
                value={formData.offers[1]?.description || ""}
                onChange={(e) => {
                  const offers = [...formData.offers];
                  offers[1] = { ...offers[1], description: e.target.value };
                  setFormData({ ...formData, offers });
                }}
                className="w-full mt-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 min-h-[70px] resize-y"
                placeholder="Offer description"
              />
            </div>
            <div className="w-24">
              <label className="text-[10px] text-slate-400">Image</label>
              <div
                className="mt-1 border-2 border-dashed border-slate-300 rounded-md h-[70px] flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors bg-white overflow-hidden relative"
                onClick={() => offerImageRefs.current[1]?.click()}
              >
                {formData.offers[1]?.image ? (
                  <img
                    src={formData.offers[1].image}
                    alt="Offer 2 image"
                    className="w-full h-full object-cover"
                    crossOrigin="anonymous"
                  />
                ) : (
                  <Upload size={14} className="text-slate-400" />
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={(el) => { offerImageRefs.current[1] = el; }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    fileToBase64(file).then((b64) => {
                      const offers = [...formData.offers];
                      offers[1] = { ...offers[1], image: b64 };
                      setFormData({ ...formData, offers });
                    });
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Subtotal + Total (side by side) ── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-slate-500 font-medium">Subtotal</label>
          <Input
            value={formData.price1}
            onChange={(e) => setFormData({ ...formData, price1: e.target.value })}
            className="mt-1 text-xs h-8"
            placeholder="Subtotal"
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 font-medium">Total</label>
          <Input
            value={formData.price2}
            onChange={(e) => setFormData({ ...formData, price2: e.target.value })}
            className="mt-1 text-xs h-8"
            placeholder="Total"
          />
        </div>
      </div>

      {/* ── Upload Image (6 slots, max 6 total) ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium">Upload Image (max 6)</label>
        <div className="grid grid-cols-6 gap-2 mt-1.5">
          {Array.from({ length: MAX_GALLERY_IMAGES }).map((_, idx) => {
            const isFilled = formData.galleryImages[idx] !== undefined;
            const slotCount = formData.galleryImages.length;
            return (
              <div
                key={idx}
                className="border border-dashed border-slate-300 rounded-lg p-2 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50 flex flex-col items-center gap-1"
                onClick={() => {
                  if (slotCount >= MAX_GALLERY_IMAGES && !isFilled) {
                    toast.warning("Maximum 6 images allowed.");
                    return;
                  }
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.multiple = true;
                  input.onchange = (e) => handleGalleryUpload((e.target as HTMLInputElement).files);
                  input.click();
                }}
              >
                {isFilled ? (
                  <>
                    <img
                      src={formData.galleryImages[idx]}
                      alt={`Slot ${idx + 1}`}
                      className="w-8 h-8 object-cover rounded"
                      crossOrigin="anonymous"
                    />
                    <span className="text-[8px] text-slate-400">Replace</span>
                  </>
                ) : (
                  <>
                    <Upload size={12} className="text-slate-400" />
                    <span className="text-[9px] text-slate-400">Upload</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" />
        {formData.galleryImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {formData.galleryImages.map((img, idx) => (
              <div key={idx} className="relative w-12 h-12 rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                <img src={img} alt={`Gallery ${idx + 1}`} className="w-full h-full object-cover" crossOrigin="anonymous" />
                <button
                  onClick={() => handleRemoveGalleryImage(idx)}
                  className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-red-500 text-white rounded-full flex items-center justify-center"
                >
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Testimonials (exactly 4 required, no add/remove) ── */}
      <div className="space-y-4">
        <label className="text-[11px] text-slate-500 font-medium">Testimonials (4 required)</label>
        {formData.testimonialNames.map((name, idx) => (
          <div key={idx} className="bg-slate-50 rounded-lg p-3 border border-slate-100 space-y-2">
            {/* Headshot upload */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-16">Headshot</span>
              {formData.testimonialHeadshots[idx] ? (
                <div className="relative">
                  <img
                    src={formData.testimonialHeadshots[idx]!}
                    alt={`Headshot ${name}`}
                    className="w-8 h-8 rounded-full object-cover"
                    crossOrigin="anonymous"
                  />
                  <button
                    onClick={() => updateTestimonial(idx, "testimonialHeadshots", null)}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white rounded-full flex items-center justify-center"
                  >
                    <X size={8} />
                  </button>
                </div>
              ) : (
                <div
                  className="w-8 h-8 rounded-full border border-dashed border-slate-300 bg-white flex items-center justify-center cursor-pointer hover:border-blue-400"
                  onClick={() => testimonialHeadshotRefs.current[idx]?.click()}
                >
                  <Upload size={10} className="text-slate-400" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={(el) => {
                  testimonialHeadshotRefs.current[idx] = el;
                  if (el) {
                    el.onchange = (ev: Event) => {
                      const file = (ev.target as HTMLInputElement).files?.[0];
                      if (file) fileToBase64(file).then((b64) => updateTestimonial(idx, "testimonialHeadshots", b64));
                    };
                  }
                }}
              />
            </div>

            {/* Testimonial name */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-16">Name</span>
              <Input
                value={name}
                onChange={(e) => updateTestimonial(idx, "testimonialNames", e.target.value)}
                className="text-xs h-7 flex-1"
                placeholder="Testimonial name"
                required
              />
            </div>

            {/* Testimonial screenshot */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-16">Screenshot</span>
              {formData.testimonialScreenshots[idx] ? (
                <div className="relative flex-1">
                  <img
                    src={formData.testimonialScreenshots[idx]!}
                    alt={`Screenshot ${name}`}
                    className="w-full h-16 object-cover rounded border border-slate-200"
                    crossOrigin="anonymous"
                  />
                  <button
                    onClick={() => updateTestimonial(idx, "testimonialScreenshots", null)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center"
                  >
                    <X size={9} />
                  </button>
                </div>
              ) : (
                <div
                  className="flex-1 border border-dashed border-slate-300 rounded-lg p-3 text-center cursor-pointer hover:border-blue-400 bg-white"
                  onClick={() => testimonialScreenshotRefs.current[idx]?.click()}
                >
                  <Upload size={14} className="text-slate-400 mx-auto mb-0.5" />
                  <span className="text-[10px] text-slate-400">Upload Testimonial Screenshot</span>
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={(el) => {
                  testimonialScreenshotRefs.current[idx] = el;
                  if (el) {
                    el.onchange = (ev: Event) => {
                      const file = (ev.target as HTMLInputElement).files?.[0];
                      if (file) fileToBase64(file).then((b64) => updateTestimonial(idx, "testimonialScreenshots", b64));
                    };
                  }
                }}
              />
            </div>
          </div>
        ))}
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
  const [activeTab, setActiveTab] = useState<"template" | "create">("template");
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

  // Synced scrolling: when left panel scrolls, right panel scrolls proportionally
  useEffect(() => {
    const leftPanel = leftPanelRef.current;
    const rightPanel = rightPanelRef.current;
    if (!leftPanel || !rightPanel) return;

    const handleLeftScroll = () => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      const leftMax = leftPanel.scrollHeight - leftPanel.clientHeight;
      const rightMax = rightPanel.scrollHeight - rightPanel.clientHeight;
      if (leftMax > 0 && rightMax > 0) {
        const ratio = leftPanel.scrollTop / leftMax;
        rightPanel.scrollTop = ratio * rightMax;
      }
      requestAnimationFrame(() => {
        isSyncingScroll.current = false;
      });
    };

    const handleRightScroll = () => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      const leftMax = leftPanel.scrollHeight - leftPanel.clientHeight;
      const rightMax = rightPanel.scrollHeight - rightPanel.clientHeight;
      if (leftMax > 0 && rightMax > 0) {
        const ratio = rightPanel.scrollTop / rightMax;
        leftPanel.scrollTop = ratio * leftMax;
      }
      requestAnimationFrame(() => {
        isSyncingScroll.current = false;
      });
    };

    leftPanel.addEventListener("scroll", handleLeftScroll, { passive: true });
    rightPanel.addEventListener("scroll", handleRightScroll, { passive: true });

    return () => {
      leftPanel.removeEventListener("scroll", handleLeftScroll);
      rightPanel.removeEventListener("scroll", handleRightScroll);
    };
  }, [open]);

  const saveMutation = trpc.requestScheduling.saveCustomValuesSettings.useMutation();

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        leadFollowUpOption: leadFollowUpOption,
        initialRequestScheduling: TIMING_LABELS[initialTiming],
        followUpLimit: FOLLOWUP_CUSTOM_VALUES[followUpCount],
        // Map popup form data to the GHL custom value schema (same as Reactivation page)
        customQuoteData: {
          businessLogo: formData.companyLogo ?? undefined,
          businessName: formData.companyName || undefined,
          businessOwnerName: formData.timeCompanyStarted || undefined,
          bioText: formData.bioDescription || undefined,
          companyImage: formData.teamPhoto ?? undefined,
          discountOffer: formData.offers[0]?.name || undefined,
          offerDescription: formData.offers[0]?.description || undefined,
          offerImage: formData.offers[0]?.image ?? undefined,
          sendQuoteAutomatically: true,
          tosLink: "",
          showCardSection: true,
          image1: formData.galleryImages[0] ?? undefined,
          image2: formData.galleryImages[1] ?? undefined,
          image3: formData.galleryImages[2] ?? undefined,
          image4: formData.galleryImages[3] ?? undefined,
          image5: formData.galleryImages[4] ?? undefined,
          image6: formData.galleryImages[5] ?? undefined,
          review1: formData.testimonialScreenshots[0] ?? undefined,
          review1Photo: formData.testimonialHeadshots[0] ?? undefined,
          review1Name: formData.testimonialNames[0] || undefined,
          review2: formData.testimonialScreenshots[1] ?? undefined,
          review2Photo: formData.testimonialHeadshots[1] ?? undefined,
          review2Name: formData.testimonialNames[1] || undefined,
          review3: formData.testimonialScreenshots[2] ?? undefined,
          review3Photo: formData.testimonialHeadshots[2] ?? undefined,
          review3Name: formData.testimonialNames[2] || undefined,
          review4: formData.testimonialScreenshots[3] ?? undefined,
          review4Photo: formData.testimonialHeadshots[3] ?? undefined,
          review4Name: formData.testimonialNames[3] || undefined,
        },
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
  }, [locationId, leadFollowUpOption, initialTiming, followUpCount, formData, saveMutation, onSaveSuccess, onOpenChange]);

  const handleClose = (open: boolean) => {
    if (!open) {
      setFormData(DEFAULT_FORM);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[98vw] w-[98vw] sm:max-w-[96vw] lg:max-w-[92vw] xl:max-w-[1600px] p-0 gap-0 overflow-hidden max-h-[95vh] rounded-xl border-2 border-blue-600">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 bg-slate-50 border-b border-slate-200">
          <DialogTitle className="text-2xl font-bold text-blue-700 mb-2">
            Custom Quote & Link
          </DialogTitle>
          <div className="space-y-0.5">
            <DialogDescription className="text-sm font-bold text-slate-700">
              How it works:
            </DialogDescription>
            <div className="text-[12px] text-slate-500 space-y-0.5">
              <p>1. Upload all empty image files (example on the left)</p>
              <p>2. Fill out the editable text boxes (offer descriptions, bio)</p>
              <p>3. Replace the default images</p>
              <p>4. Add the 4 testimonials</p>
              <p>5. Click Save Settings</p>
            </div>
          </div>
        </DialogHeader>

        {/* Tab buttons */}
        <div className="flex items-center justify-center gap-3 px-6 py-3 bg-slate-50 border-b border-slate-200">
          <button
            onClick={() => setActiveTab("template")}
            className={`px-8 py-2 text-sm font-bold rounded-md transition-colors ${
              activeTab === "template"
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-blue-100 text-blue-600 hover:bg-blue-200"
            }`}
          >
            Template
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`px-8 py-2 text-sm font-bold rounded-md transition-colors ${
              activeTab === "create"
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-blue-100 text-blue-600 hover:bg-blue-200"
            }`}
          >
            Create Yours
          </button>
        </div>

        {/* Split panel body */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden" style={{ height: "calc(95vh - 220px)" }}>
          {/* Left Panel: Template Preview */}
          <div
            ref={leftPanelRef}
            className={`${
              activeTab === "template" ? "block" : "hidden lg:block"
            } bg-blue-50 border-r-2 border-blue-300 overflow-y-auto`}
            style={{ maxHeight: "100%" }}
          >
            <div className="p-4">
              <QuoteTemplatePreview formData={formData} />
            </div>
          </div>

          {/* Right Panel: Form Fields */}
          <div
            ref={rightPanelRef}
            className={`${
              activeTab === "create" ? "block" : "hidden lg:block"
            } bg-white overflow-y-auto`}
            style={{ maxHeight: "100%" }}
          >
            <div className="p-5">
              <QuoteFormFields
                formData={formData}
                setFormData={setFormData}
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
