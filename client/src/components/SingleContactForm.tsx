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
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Header with DND toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Add Single Contact</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Add to DO NOT CONTACT list
          </span>
          <Switch
            checked={dnd}
            onCheckedChange={setDnd}
            className="data-[state=checked]:bg-destructive"
          />
        </div>
      </div>

      {/* First Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">First Name</label>
        <input
          type="text"
          value={formData.firstName}
          onChange={handleChange("firstName")}
          placeholder="Enter first name"
          className={`w-full px-3 py-2.5 rounded-md border bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.firstName ? "border-destructive" : "border-input"
          }`}
        />
        {errors.firstName && (
          <p className="text-xs text-destructive">{errors.firstName}</p>
        )}
      </div>

      {/* Last Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Last Name</label>
        <input
          type="text"
          value={formData.lastName}
          onChange={handleChange("lastName")}
          placeholder="Enter last name"
          className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={handleChange("email")}
          placeholder="Enter email"
          className={`w-full px-3 py-2.5 rounded-md border bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.email ? "border-destructive" : "border-input"
          }`}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email}</p>
        )}
      </div>

      {/* Phone */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Phone Number</label>
        <input
          type="tel"
          value={formData.phone}
          onChange={handleChange("phone")}
          placeholder="Enter phone number"
          className={`w-full px-3 py-2.5 rounded-md border bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.phone ? "border-destructive" : "border-input"
          }`}
        />
        {errors.phone && (
          <p className="text-xs text-destructive">{errors.phone}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Street Address</label>
        <input
          type="text"
          value={formData.streetAddress}
          onChange={handleChange("streetAddress")}
          placeholder="Enter service address"
          className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">City</label>
          <input
            type="text"
            value={formData.city}
            onChange={handleChange("city")}
            placeholder="Enter city"
            className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">State</label>
          <input
            type="text"
            value={formData.state}
            onChange={handleChange("state")}
            placeholder="Enter state"
            className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Zip Code</label>
          <input
            type="text"
            value={formData.postalCode}
            onChange={handleChange("postalCode")}
            placeholder="Enter zip code"
            className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Number of Dogs</label>
          <input
            type="text"
            value={formData.numberOfDogs}
            onChange={handleChange("numberOfDogs")}
            placeholder="Enter # of dogs"
            className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Last Time Scooped</label>
          <input
            type="text"
            value={formData.lastTimeScooped}
            onChange={handleChange("lastTimeScooped")}
            placeholder="Enter date"
            className="w-full px-3 py-2.5 rounded-md border border-input bg-muted/30 text-sm placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-muted/70 p-4">
        <p className="text-sm font-semibold text-foreground">Add contacts too:</p>
        <div className="grid gap-2 pt-3 text-sm">
          {TAG_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-3 rounded-xl border border-input bg-background p-3 cursor-pointer transition hover:border-primary/70">
              <input
                type="radio"
                name="contactTag"
                value={option.value}
                checked={tagOption === option.value}
                onChange={() => setTagOption(option.value)}
                className="h-4 w-4 text-primary focus:ring-primary"
              />
              <span className="font-medium text-foreground">{option.label}</span>
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
          className="mt-0.5 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
        <label
          htmlFor="consent"
          className="text-sm text-muted-foreground leading-tight cursor-pointer"
        >
          I have the required consent to message this customer by email or SMS
        </label>
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={!isFormValid || isSubmitting}
        className="w-full h-11 text-sm font-medium"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Adding Contact...
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Contact
          </>
        )}
      </Button>
    </form>
  );
}
