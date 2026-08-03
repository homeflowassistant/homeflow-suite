/**
 * CustomQuoteLinkPopup Component
 *
 * Split-panel popup dialog matching the Canva slide 7 design for the
 * Follow-Up (Request Scheduling) page. Triggered by clicking the
 * "Custom Quote & Link" option card.
 */

import { useState, useCallback, useRef } from "react";
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
  name: string;          // Offer title / name (editable for Offer 2)
  price: string;         // Static price display ($XX.XX)
  description: string;   // Editable description
  image: string | null;  // Editable image
}

interface QuoteFormData {
  companyLogo: string | null;
  teamPhoto: string | null;
  bioTitle: string;
  bioDescription: string;
  offers: QuoteOffer[];    // Two offers: paid + free
  price1: string;          // Subtotal ($XX.XX)
  price2: string;          // Total ($XX.XX)
  galleryImages: string[];
  testimonialHeadshots: (string | null)[];
  testimonialNames: string[];
  testimonialTexts: string[];
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

const DEFAULT_SCOOPING_LOGO = "/scooping-r-us-logo.png";
const DEFAULT_AVATAR = "/default-avatar.jpg";
const DEFAULT_DOG_PHOTO = "/dog-photo.webp";

// ─── Default prefilled content ───────────────────────────────────────

const DEFAULT_FORM: QuoteFormData = {
  companyLogo: DEFAULT_SCOOPING_LOGO,
  teamPhoto: DEFAULT_DOG_PHOTO,
  bioTitle: "[service area]'s Highest Rated Pooper Scooper Service",
  bioDescription:
    "Serving dog owners across the city, our team keeps your yard clean, fresh, and hassle-free. We provide reliable pet waste removal on a schedule that works for you. Our friendly scoopers handle the dirty work so you can enjoy a clean yard, more time with your pets, and peace of mind knowing everything is sanitary. Locally operated, affordable, and backed by great customer care, [company name] is here to make life easier—one yard at a time.",
  offers: [
    {
      name: "[FREQUENCY] | Dog Waste Removal",
      price: "$XX.XX",
      description:
        "Experience the joy of a hassle-free yard with our weekly dog waste removal service for your furry friend! Just one visit every week is all it takes to keep your yard clean and fresh for your beloved pup. 🐾",
      image: DEFAULT_DOG_PHOTO,
    },
    {
      name: "2 Weeks FREE",
      price: "$XX.XX",
      description:
        "Experience the joy of a hassle-free yard with our weekly dog waste removal service for your furry friend! Just one visit every week is all it takes to keep your yard clean and fresh for your beloved pup. 🐾",
      image: DEFAULT_DOG_PHOTO,
    },
  ],
  price1: "$XX.XX",
  price2: "$XX.XX",
  galleryImages: [
    DEFAULT_DOG_PHOTO,
    DEFAULT_DOG_PHOTO,
    DEFAULT_DOG_PHOTO,
    DEFAULT_DOG_PHOTO,
    DEFAULT_DOG_PHOTO,
    DEFAULT_DOG_PHOTO,
  ],
  testimonialHeadshots: [
    DEFAULT_AVATAR,
    DEFAULT_AVATAR,
    DEFAULT_AVATAR,
    DEFAULT_AVATAR,
  ],
  testimonialNames: ["Joshua -n- Megan", "Amber K.", "Marcus L.", "Samantha P."],
  testimonialTexts: [
    "Default testimonial text will appear here.",
    "Default testimonial text will appear here.",
    "Default testimonial text will appear here.",
    "Default testimonial text will appear here.",
  ],
  testimonialScreenshots: [null, null, null, null],
};

const MAX_GALLERY_IMAGES = 6;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Left Panel: Quote Template Preview ──────────────────────────────

function QuoteTemplatePreview({ formData }: { formData: QuoteFormData }) {
  return (
    <div className="space-y-4">
      {/* ── Centered Column Heading ── */}
      <div className="text-center py-2 bg-blue-100/70 rounded-lg border border-blue-200 mb-3">
        <h3 className="text-sm font-extrabold text-blue-800 uppercase tracking-wider">
          Template Preview
        </h3>
      </div>

      {/* ── Company Logo ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">Company Logo</label>
        {formData.companyLogo ? (
          <div className="flex items-center justify-center py-3 bg-white/80 rounded-xl border border-slate-200 shadow-sm p-3">
            <img
              src={formData.companyLogo}
              alt="Company Logo"
              className="h-28 sm:h-32 max-w-full object-contain"
              crossOrigin="anonymous"
            />
          </div>
        ) : (
          <div className="h-16 w-44 bg-slate-100 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400 font-medium">
            No Logo Uploaded
          </div>
        )}
      </div>

      {/* ── Company Photo ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">Company Photo</label>
        {formData.teamPhoto ? (
          <div className="relative">
            <img
              src={formData.teamPhoto}
              alt="Team Photo"
              className="w-full h-40 object-cover rounded-lg"
              crossOrigin="anonymous"
            />
          </div>
        ) : (
          <div className="w-full h-40 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Image className="w-8 h-8 text-slate-300 mx-auto mb-1" />
              <span className="text-[11px] text-slate-400">No Photo Uploaded</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Bio / Quote Title & Description ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">Bio &amp; Quote Title</label>
        <div className="bg-slate-50 rounded-lg p-3">
          <h3 className="text-sm font-bold text-slate-800 mb-1">
            {formData.bioTitle || "[service area]'s Highest Rated Pooper Scooper Service"}
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            {formData.bioDescription || "Your company description will appear here."}
          </p>
        </div>
      </div>

      {/* ── Offer 1 ── */}
      <div className="space-y-2">
        <label className="text-[11px] text-slate-500 font-medium">Offer 1</label>
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <span className="text-[11px] text-slate-700 font-bold block">{formData.offers[0]?.name}</span>
          <span className="text-[11px] text-slate-500 block">{formData.offers[0]?.price}</span>
          <div className="flex gap-3 items-start">
            <p className="text-[11px] text-slate-600 leading-relaxed flex-1">
              {formData.offers[0]?.description || "Offer description here"}
            </p>
            <div className="w-20 h-16 flex-shrink-0">
              {formData.offers[0]?.image ? (
                <img
                  src={formData.offers[0].image}
                  alt="Offer 1"
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
      </div>

      {/* ── Offer 2 ── */}
      <div className="space-y-2">
        <label className="text-[11px] text-slate-500 font-medium">Offer 2 (Free Offer)</label>
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <span className="text-[11px] text-slate-700 font-bold block">{formData.offers[1]?.name}</span>
          <span className="text-[11px] text-slate-500 block">{formData.offers[1]?.price}</span>
          <div className="flex gap-3 items-start">
            <p className="text-[11px] text-slate-600 leading-relaxed flex-1">
              {formData.offers[1]?.description || "Offer description here"}
            </p>
            <div className="w-20 h-16 flex-shrink-0">
              {formData.offers[1]?.image ? (
                <img
                  src={formData.offers[1].image}
                  alt="Offer 2"
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
      </div>

      {/* ── Pricing: Subtotal + Total (Static $XX.XX) ── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-slate-500 font-medium block mb-1">Subtotal</label>
          <p className="text-sm font-medium text-slate-700 bg-slate-50 rounded px-2 py-1.5">$XX.XX</p>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 font-medium block mb-1">Total</label>
          <p className="text-sm font-bold text-slate-800 bg-slate-50 rounded px-2 py-1.5">$XX.XX</p>
        </div>
      </div>

      {/* ── Gallery Images ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">Gallery Images (max 6)</label>
        <div className="grid grid-cols-6 gap-2 mt-1.5">
          {Array.from({ length: MAX_GALLERY_IMAGES }).map((_, idx) => (
            <div
              key={idx}
              className={`border ${formData.galleryImages[idx] ? "border-slate-200" : "border-dashed border-slate-300"} rounded-lg p-2 flex flex-col items-center gap-1 bg-slate-50`}
            >
              {formData.galleryImages[idx] ? (
                <img
                  src={formData.galleryImages[idx]}
                  alt={`Gallery ${idx + 1}`}
                  className="w-8 h-8 object-cover rounded"
                  crossOrigin="anonymous"
                />
              ) : (
                <>
                  <Image size={12} className="text-slate-300" />
                  <span className="text-[8px] text-slate-400">Empty</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Testimonials (4 required) ── */}
      <div className="space-y-4">
        <label className="text-[11px] text-slate-500 font-medium block">Testimonials (4 required)</label>
        {formData.testimonialNames.map((name, idx) => (
          <div key={idx} className="bg-slate-50 rounded-lg p-3 border border-slate-100 space-y-2">
            <div className="flex items-center gap-2">
              <img
                src={formData.testimonialHeadshots[idx] || DEFAULT_AVATAR}
                alt={name}
                className="w-9 h-9 rounded-full object-cover border border-slate-200 shadow-sm"
                crossOrigin="anonymous"
              />
              <span className="text-sm font-medium text-slate-700">{name}</span>
            </div>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star key={star} size={14} className="fill-amber-400 text-amber-400" />
              ))}
            </div>
            <div className="border border-dashed border-slate-300 rounded-lg p-3 bg-white">
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {formData.testimonialTexts[idx] || "Default testimonial text will appear here."}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── CTA Preview ── */}
      <div className="border-t border-slate-200 pt-4">
        <button
          type="button"
          className="px-8 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-full"
          disabled
        >
          Approve Quote
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
  const testimonialHeadshotRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleImageUpload = async (
    file: File | undefined,
    field: keyof QuoteFormData
  ) => {
    if (!file) return;
    const base64 = await fileToBase64(file);
    setFormData({ ...formData, [field]: base64 });
  };

  const handleGalleryUpload = async (files: FileList | null, replaceIndex?: number) => {
    if (!files) return;
    const newImages: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const base64 = await fileToBase64(files[i]);
      newImages.push(base64);
    }
    if (replaceIndex !== undefined) {
      // Replace the specific slot
      const updated = [...formData.galleryImages];
      updated[replaceIndex] = newImages[0];
      setFormData({ ...formData, galleryImages: updated });
    } else {
      // Append to fill empty slots
      const updated = [...formData.galleryImages];
      let slotIdx = 0;
      for (let i = 0; i < newImages.length && slotIdx < MAX_GALLERY_IMAGES; i++) {
        if (updated[slotIdx] === undefined || updated[slotIdx] === null) {
          updated[slotIdx] = newImages[i];
        }
        slotIdx++;
      }
      setFormData({ ...formData, galleryImages: updated });
    }
  };

  const handleRemoveGalleryImage = (index: number) => {
    setFormData({
      ...formData,
      galleryImages: formData.galleryImages.filter((_, i) => i !== index),
    });
  };

  const updateTestimonial = (
    index: number,
    field: "testimonialHeadshots" | "testimonialNames" | "testimonialTexts",
    value: string | null
  ) => {
    const updated = [...formData[field]];
    updated[index] = value as any;
    setFormData({ ...formData, [field]: updated });
  };

  return (
    <div className="space-y-4">
      {/* ── Centered Column Heading ── */}
      <div className="text-center py-2 bg-blue-100/70 rounded-lg border border-blue-200 mb-3">
        <h3 className="text-sm font-extrabold text-blue-800 uppercase tracking-wider">
          Configure Your Custom Quote
        </h3>
      </div>

      {/* ── Company Logo ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">Company Logo</label>
        <div className="mt-1 flex items-center gap-3">
          {formData.companyLogo ? (
            <div className="relative group inline-block">
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl shadow-sm">
                <img
                  src={formData.companyLogo}
                  alt="Logo"
                  className="h-24 sm:h-28 max-w-[240px] object-contain rounded"
                  crossOrigin="anonymous"
                />
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, companyLogo: null })}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-transform hover:scale-110"
                title="Remove logo"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div
              className="w-40 h-24 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-colors"
              onClick={() => logoInputRef.current?.click()}
            >
              <Upload size={18} className="text-slate-400 mb-1" />
              <span className="text-xs text-slate-500 font-medium">Upload Logo</span>
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

      {/* ── Company Photo ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">Company Photo</label>
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

      {/* ── Quote Title Field ── */}
      <div className="px-2">
        <label className="text-[11px] text-slate-500 font-medium block mb-1">
          Quote Title
        </label>
        <Input
          value={formData.bioTitle}
          onChange={(e) => setFormData({ ...formData, bioTitle: e.target.value })}
          className="mt-1 text-xs h-8"
          placeholder="[service area]'s Highest Rated Pooper Scooper Service"
        />
      </div>

      {/* ── Company Description Field ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">
          Company Description
        </label>
        <textarea
          value={formData.bioDescription}
          onChange={(e) => setFormData({ ...formData, bioDescription: e.target.value })}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 min-h-[100px] resize-y"
          placeholder="Insert Company Description Here"
        />
      </div>

      {/* ── Offer 1 ── */}
      <div className="space-y-2">
        <label className="text-[11px] text-slate-500 font-medium">Offer 1</label>
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <div>
            <span className="text-[11px] text-slate-700 font-bold block">{formData.offers[0]?.name}</span>
          </div>
          <div>
            <span className="text-[11px] text-slate-500">{formData.offers[0]?.price}</span>
          </div>
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
                className="w-full mt-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs min-h-[70px] resize-y"
                placeholder="Offer description"
              />
            </div>
            <div className="w-24">
              <label className="text-[10px] text-slate-400">Image</label>
              <div
                className="mt-1 border-2 border-dashed border-slate-300 rounded-md h-[70px] flex items-center justify-center cursor-pointer hover:border-blue-400 bg-white overflow-hidden"
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

      {/* ── Offer 2 (Editable Free Offer Title) ── */}
      <div className="space-y-2">
        <label className="text-[11px] text-slate-500 font-medium">Free Sign Up Offer</label>
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <div>
            <label className="text-[10px] text-slate-400">Offer Title</label>
            <Input
              value={formData.offers[1]?.name || "2 Weeks FREE"}
              onChange={(e) => {
                const offers = [...formData.offers];
                offers[1] = { ...offers[1], name: e.target.value };
                setFormData({ ...formData, offers });
              }}
              className="mt-1 text-xs h-8"
              placeholder="e.g. 2 Weeks FREE"
            />
          </div>
          <div>
            <span className="text-[11px] text-slate-500">{formData.offers[1]?.price}</span>
          </div>
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
                className="w-full mt-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs min-h-[70px] resize-y"
                placeholder="Offer description"
              />
            </div>
            <div className="w-24">
              <label className="text-[10px] text-slate-400">Image</label>
              <div
                className="mt-1 border-2 border-dashed border-slate-300 rounded-md h-[70px] flex items-center justify-center cursor-pointer hover:border-blue-400 bg-white overflow-hidden"
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

      {/* ── Pricing: Subtotal + Total (Static $XX.XX) ── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-slate-500 font-medium block mb-1">Subtotal</label>
          <div className="mt-1 text-xs h-8 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-100 text-slate-600 font-semibold">
            $XX.XX
          </div>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 font-medium block mb-1">Total</label>
          <div className="mt-1 text-xs h-8 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-100 text-slate-700 font-bold">
            $XX.XX
          </div>
        </div>
      </div>

      {/* ── Gallery Images ── */}
      <div>
        <label className="text-[11px] text-slate-500 font-medium block mb-1">Gallery Images (max 6)</label>
        <div className="grid grid-cols-6 gap-2 mt-1.5">
          {Array.from({ length: MAX_GALLERY_IMAGES }).map((_, idx) => {
            const isFilled = formData.galleryImages[idx] !== undefined;
            const slotCount = formData.galleryImages.length;
            return (
              <div
                key={idx}
                className="border border-dashed border-slate-300 rounded-lg p-2 text-center cursor-pointer hover:border-blue-400 transition-colors bg-slate-50 flex flex-col items-center gap-1"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = (e) => handleGalleryUpload((e.target as HTMLInputElement).files, isFilled ? idx : undefined);
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
      </div>

      {/* ── Testimonials (Copy & Paste Text Areas) ── */}
      <div className="space-y-4">
        <label className="text-[11px] text-slate-500 font-medium block">Testimonials (4 required)</label>
        {formData.testimonialNames.map((name, idx) => (
          <div key={idx} className="bg-slate-50 rounded-lg p-3 border border-slate-100 space-y-2">
            {/* Headshot upload */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-16">Headshot</span>
              {formData.testimonialHeadshots[idx] ? (
                <div className="relative group">
                  <img
                    src={formData.testimonialHeadshots[idx]!}
                    alt={`Headshot ${name}`}
                    className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-sm cursor-pointer hover:opacity-80"
                    crossOrigin="anonymous"
                    onClick={() => testimonialHeadshotRefs.current[idx]?.click()}
                    title="Click to change headshot"
                  />
                  <button
                    onClick={() => updateTestimonial(idx, "testimonialHeadshots", null)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center shadow"
                    title="Remove headshot"
                  >
                    <X size={9} />
                  </button>
                </div>
              ) : (
                <div
                  className="w-10 h-10 rounded-full border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center cursor-pointer hover:border-blue-400 overflow-hidden relative"
                  onClick={() => testimonialHeadshotRefs.current[idx]?.click()}
                  title="Upload headshot"
                >
                  <img
                    src={DEFAULT_AVATAR}
                    alt="Default Headshot"
                    className="w-full h-full object-cover opacity-70 hover:opacity-100 transition-opacity"
                  />
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

            {/* Google Review Textarea */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Google Review Text</label>
              <textarea
                value={formData.testimonialTexts[idx] || ""}
                onChange={(e) => updateTestimonial(idx, "testimonialTexts", e.target.value)}
                placeholder="Default testimonial text will appear here (copy/paste Google Review text)"
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs min-h-[60px] resize-y"
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── Save Settings Button ── */}
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const saveMutation = trpc.requestScheduling.saveCustomValuesSettings.useMutation();

  const handleSave = useCallback(async () => {
    if (!formData.companyLogo) {
      toast.error("Company logo must be uploaded/replaced.");
      return;
    }

    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        leadFollowUpOption: leadFollowUpOption,
        initialRequestScheduling: TIMING_LABELS[initialTiming],
        followUpLimit: FOLLOWUP_CUSTOM_VALUES[followUpCount],
        customQuoteData: {
          businessLogo: formData.companyLogo ?? undefined,
          quoteTitle: formData.bioTitle || undefined,
          bioText: formData.bioDescription || undefined,
          companyImage: formData.teamPhoto ?? undefined,
          discountOffer: formData.offers[1]?.name || formData.offers[0]?.name || undefined,
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
          review1: formData.testimonialTexts[0] ?? undefined,
          review1Photo: formData.testimonialHeadshots[0] ?? undefined,
          review1Name: formData.testimonialNames[0] || undefined,
          review2: formData.testimonialTexts[1] ?? undefined,
          review2Photo: formData.testimonialHeadshots[1] ?? undefined,
          review2Name: formData.testimonialNames[1] || undefined,
          review3: formData.testimonialTexts[2] ?? undefined,
          review3Photo: formData.testimonialHeadshots[2] ?? undefined,
          review3Name: formData.testimonialNames[2] || undefined,
          review4: formData.testimonialTexts[3] ?? undefined,
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
      <DialogContent className="max-w-[98vw] w-[98vw] sm:max-w-[96vw] lg:max-w-[92vw] xl:max-w-[1600px] p-0 gap-0 max-h-[95vh] rounded-xl border-2 border-blue-600 flex flex-col">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 bg-slate-50 border-b border-slate-200 flex-shrink-0">
          <DialogTitle className="text-2xl font-bold text-blue-700 mb-2">
            Custom Quote &amp; Link
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

        {/* Split panel body - scrollable */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
            {/* Left Panel: Template Preview */}
            <div className="bg-blue-50 border-r-2 border-blue-300 p-4">
              <QuoteTemplatePreview formData={formData} />
            </div>

            {/* Right Panel: Form Fields */}
            <div className="bg-white p-5">
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
