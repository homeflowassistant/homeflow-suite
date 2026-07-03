/**
 * SingleContactForm Component
 *
 * Uses the backend tRPC proxy to create contacts via GHL OAuth tokens.
 * No manual API key configuration needed — the backend handles authentication.
 */

import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, UserPlus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  numberOfDogs: string;
  lastTimeScooped: string;
}

type ContactTagOption =
  | "lead-follow-up"
  | "reactivation-campaign"
  | "add-on-campaign"
  | "quick-send";

const TAG_OPTIONS: Array<{ value: ContactTagOption; label: string }> = [
  { value: "lead-follow-up", label: "Lead Follow-Up" },
  { value: "reactivation-campaign", label: "Reactivation Campaign" },
  { value: "add-on-campaign", label: "Add-on Campaign" },
  { value: "quick-send", label: "Quick Send" },
];

interface SingleContactFormProps {
  locationId: string;
}

export default function SingleContactForm({ locationId }: SingleContactFormProps) {
  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    streetAddress: "",
    city: "",
    state: "",
    postalCode: "",
    numberOfDogs: "",
    lastTimeScooped: "",
  });
  const [dnd, setDnd] = useState(false);
  const [tagOption, setTagOption] = useState<ContactTagOption>("lead-follow-up");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const createContactMutation = trpc.ghl.createContact.useMutation({
    onSuccess: (result) => {
      toast.success("Contact added successfully!", {
        description: result.enrolledInWorkflow
          ? "Contact has been enrolled in the Review Reactivation workflow."
          : dnd
          ? "Contact marked as Do Not Disturb — not enrolled in workflow."
          : "Contact created.",
        icon: <CheckCircle2 className="h-4 w-4 text-primary" />,
      });

      // Reset form
      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        streetAddress: "",
        city: "",
        state: "",
        postalCode: "",
        numberOfDogs: "",
        lastTimeScooped: "",
      });
      setDnd(false);
      setTagOption("lead-follow-up");
      setConsent(false);
      setErrors({});
    },
    onError: (error) => {
      toast.error("Failed to add contact", {
        description: error.message || "Unknown error occurred",
      });
    },
  });

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = "First name is required";
    }

    if (!formData.email.trim() && !formData.phone.trim()) {
      newErrors.email = "Email or phone is required";
      newErrors.phone = "Email or phone is required";
    }

    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      newErrors.email = "Invalid email format";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!validate()) return;

    if (!consent) {
      toast.error("Please confirm you have consent to message this customer");
      return;
    }

    createContactMutation.mutate({
      locationId,
      contact: {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        dnd,
        tagName: tagOption,
      },
    });
  };

  const handleChange =
    (field: keyof FormData) => (e: ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };

  const isFormValid =
    formData.firstName.trim() &&
    (formData.email.trim() || formData.phone.trim()) &&
    consent;

  const isSubmitting = createContactMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">* Required Fields</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-500">Do Not Disturb</span>
          <Switch
            checked={dnd}
            onCheckedChange={setDnd}
            className="data-[state=checked]:bg-cyan-400 h-4 w-7"
          />
        </div>
      </div>

      <div className="grid flex-1 grid-rows-[auto_auto_auto_auto_auto_auto_auto_auto_auto_1fr_auto] gap-[6px] overflow-hidden">
        {/* First Name */}
      <div className="space-y-0.5">
        <label className="text-[15px] font-extrabold text-slate-800">*First Name</label>
        <input
          type="text"
          value={formData.firstName}
          onChange={handleChange("firstName")}
          placeholder="Enter First Name"
          className={`w-full rounded-sm border border-slate-400 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400 ${
            errors.firstName ? "border-red-400" : "border-slate-300"
          }`}
        />
        {errors.firstName && (
          <p className="text-xs text-red-500">{errors.firstName}</p>
        )}
      </div>

      {/* Last Name */}
      <div className="space-y-0.5">
        <label className="text-[15px] font-bold text-slate-800">Last Name</label>
        <input
          type="text"
          value={formData.lastName}
          onChange={handleChange("lastName")}
          placeholder="Enter Last Name"
          className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
        />
      </div>

      {/* Email */}
      <div className="space-y-0.5">
        <label className="text-[15px] font-extrabold text-slate-800">*Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={handleChange("email")}
          placeholder="Enter Email"
          className={`w-full rounded-sm border bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400 ${
            errors.email ? "border-red-400" : "border-slate-300"
          }`}
        />
        {errors.email && (
          <p className="text-xs text-red-500">{errors.email}</p>
        )}
      </div>

      {/* Phone */}
      <div className="space-y-0.5">
        <label className="text-[15px] font-extrabold text-slate-800">*Phone Number</label>
        <input
          type="tel"
          value={formData.phone}
          onChange={handleChange("phone")}
          placeholder="Enter Phone Number"
          className={`w-full rounded-sm border bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400 ${
            errors.phone ? "border-red-400" : "border-slate-300"
          }`}
        />
        {errors.phone && (
          <p className="text-xs text-red-500">{errors.phone}</p>
        )}
      </div>

      <div className="space-y-0.5">
        <label className="text-[15px] font-bold text-slate-800">Street Address</label>
        <input
          type="text"
          value={formData.streetAddress}
          onChange={handleChange("streetAddress")}
          placeholder="Enter Service Address"
          className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="space-y-0.5">
          <label className="text-[15px] font-bold text-slate-700">City</label>
          <input
            type="text"
            value={formData.city}
            onChange={handleChange("city")}
            placeholder="Enter City"
            className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[15px] font-bold text-slate-700">State</label>
          <input
            type="text"
            value={formData.state}
            onChange={handleChange("state")}
            placeholder="Enter State"
            className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[15px] font-bold text-slate-700">Zip Code</label>
          <input
            type="text"
            value={formData.postalCode}
            onChange={handleChange("postalCode")}
            placeholder="Enter Zip Code"
            className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-0.5">
          <label className="text-[15px] font-bold text-slate-700">*Number of Dogs</label>
          <input
            type="text"
            value={formData.numberOfDogs}
            onChange={handleChange("numberOfDogs")}
            placeholder="Enter # of Dogs"
            className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[15px] font-bold text-slate-700">Last Time Scooped</label>
          <input
            type="text"
            value={formData.lastTimeScooped}
            onChange={handleChange("lastTimeScooped")}
            placeholder="Enter Date"
            className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs placeholder:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
      </div>

      <div className="mt-1 rounded-lg bg-transparent">
        <p className="text-sm font-bold text-slate-800 mb-1.5">Add contacts too:</p>
        <div className="grid gap-1 text-sm">
          {TAG_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 cursor-pointer transition">
              <input
                type="radio"
                name="contactTag"
                value={option.value}
                checked={tagOption === option.value}
                onChange={() => setTagOption(option.value)}
                className="h-4 w-4 text-cyan-400 focus:ring-cyan-400"
              />
              <span className="font-medium text-slate-700">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Consent Checkbox */}
      <div className="flex items-start gap-2 py-1">
        <Checkbox
          id="consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5 h-4 w-4 border-cyan-300 data-[state=checked]:bg-cyan-400 data-[state=checked]:border-cyan-400"
        />
        <label
          htmlFor="consent"
          className="text-xs text-slate-500 leading-tight cursor-pointer"
        >
          I have consent to message this customer
        </label>
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={!isFormValid || isSubmitting}
        className="mt-2 self-end h-12 min-w-[190px] rounded-xl bg-cyan-300 px-8 text-2xl font-bold text-slate-900 shadow-[4px_4px_0_0_rgba(192,132,252,0.45)] hover:bg-cyan-200"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Adding...
          </>
        ) : (
          <>
            <UserPlus className="h-5 w-5 mr-2" />
            Add Contact
          </>
        )}
      </Button>
      </div>
    </form>
  );
}
