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
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Header with DND toggle */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600">
            Add to DO NOT CONTACT
          </span>
          <Switch
            checked={dnd}
            onCheckedChange={setDnd}
            className="data-[state=checked]:bg-destructive h-5 w-9"
          />
        </div>
      </div>

      {/* First Name */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-900">*First Name</label>
        <input
          type="text"
          value={formData.firstName}
          onChange={handleChange("firstName")}
          placeholder="Enter first name"
          className={`w-full px-2 py-1.5 rounded-md border bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400 ${
            errors.firstName ? "border-red-400" : "border-slate-300"
          }`}
        />
        {errors.firstName && (
          <p className="text-xs text-red-500">{errors.firstName}</p>
        )}
      </div>

      {/* Last Name */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-700">Last Name</label>
        <input
          type="text"
          value={formData.lastName}
          onChange={handleChange("lastName")}
          placeholder="Enter last name"
          className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
        />
      </div>

      {/* Email */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-900">*Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={handleChange("email")}
          placeholder="Enter email"
          className={`w-full px-2 py-1.5 rounded-md border bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400 ${
            errors.email ? "border-red-400" : "border-slate-300"
          }`}
        />
        {errors.email && (
          <p className="text-xs text-red-500">{errors.email}</p>
        )}
      </div>

      {/* Phone */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-900">*Phone Number</label>
        <input
          type="tel"
          value={formData.phone}
          onChange={handleChange("phone")}
          placeholder="Enter phone"
          className={`w-full px-2 py-1.5 rounded-md border bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400 ${
            errors.phone ? "border-red-400" : "border-slate-300"
          }`}
        />
        {errors.phone && (
          <p className="text-xs text-red-500">{errors.phone}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-700">Street Address</label>
        <input
          type="text"
          value={formData.streetAddress}
          onChange={handleChange("streetAddress")}
          placeholder="Enter address"
          className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">City</label>
          <input
            type="text"
            value={formData.city}
            onChange={handleChange("city")}
            placeholder="City"
            className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">State</label>
          <input
            type="text"
            value={formData.state}
            onChange={handleChange("state")}
            placeholder="State"
            className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">Zip Code</label>
          <input
            type="text"
            value={formData.postalCode}
            onChange={handleChange("postalCode")}
            placeholder="Zip"
            className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">Number of Dogs</label>
          <input
            type="text"
            value={formData.numberOfDogs}
            onChange={handleChange("numberOfDogs")}
            placeholder="# of dogs"
            className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">Last Time Scooped</label>
          <input
            type="text"
            value={formData.lastTimeScooped}
            onChange={handleChange("lastTimeScooped")}
            placeholder="Date"
            className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
          />
        </div>
      </div>

      <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 mt-2">
        <p className="text-xs font-semibold text-slate-900 mb-2">Add contacts too:</p>
        <div className="grid gap-1.5 text-xs">
          {TAG_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-white p-2 cursor-pointer transition hover:bg-cyan-50">
              <input
                type="radio"
                name="contactTag"
                value={option.value}
                checked={tagOption === option.value}
                onChange={() => setTagOption(option.value)}
                className="h-3 w-3 text-cyan-400 focus:ring-cyan-400"
              />
              <span className="font-medium text-slate-700">◉ {option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Consent Checkbox */}
      <div className="flex items-start gap-2 pt-1">
        <Checkbox
          id="consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5 h-4 w-4 border-cyan-300 data-[state=checked]:bg-cyan-400 data-[state=checked]:border-cyan-400"
        />
        <label
          htmlFor="consent"
          className="text-xs text-slate-600 leading-tight cursor-pointer"
        >
          I have the required consent to message this customer by email or SMS
        </label>
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={!isFormValid || isSubmitting}
        className="w-full h-9 text-xs font-semibold bg-cyan-400 hover:bg-cyan-500 text-white rounded-lg mt-3"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            Adding...
          </>
        ) : (
          <>
            <UserPlus className="h-3 w-3 mr-1" />
            Add Contact
          </>
        )}
      </Button>
    </form>
  );
}
