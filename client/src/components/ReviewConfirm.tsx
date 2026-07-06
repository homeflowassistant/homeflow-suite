/**
 * ReviewConfirm Component
 *
 * Uses the backend tRPC proxy for batch contact processing.
 * No manual API key configuration needed.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, Upload, Ban, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { type ParsedCSV, type ColumnMapping, applyMappings } from "@/lib/csv-parser";
import { trpc } from "@/lib/trpc";

interface ReviewConfirmProps {
  parsedCSV: ParsedCSV;
  mapping: ColumnMapping;
  locationId: string;
  tagName: "lead-follow-up" | "reactivation-campaign" | "add-on-campaign" | "quick-send";
  onBack: () => void;
  onComplete: () => void;
}

export default function ReviewConfirm({
  parsedCSV,
  mapping,
  locationId,
  tagName,
  onBack,
  onComplete,
}: ReviewConfirmProps) {
  const [dnd, setDnd] = useState(false);
  const [consent, setConsent] = useState(false);
  const [tagOption, setTagOption] = useState(tagName);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const processBatchMutation = trpc.ghl.processBatch.useMutation();

  // Get mapped column names for summary
  const mappedColumns: string[] = [];
  if (mapping.email) mappedColumns.push("email");
  if (mapping.phone) mappedColumns.push("number");
  if (mapping.fullName) mappedColumns.push("full name");
  if (mapping.firstName) mappedColumns.push("first name");
  if (mapping.lastName) mappedColumns.push("last name");
  if (mapping.address1) mappedColumns.push("street address");
  if (mapping.city) mappedColumns.push("city");
  if (mapping.state) mappedColumns.push("state");
  if (mapping.postalCode) mappedColumns.push("zip code");
  if (mapping.numberOfDogs) mappedColumns.push("number of dogs");
  if (mapping.lastTimeScooped) mappedColumns.push("last time scooped");
  if (mapping.frequency) mappedColumns.push("frequency");

  const handleUpload = async () => {
    setIsUploading(true);
    setProgress(0);

    try {
      // Apply mappings to get contact data
      const mappedContacts = applyMappings(parsedCSV, mapping);

      // Process in batches of 50 to avoid timeout
      const BATCH_SIZE = 50;
      let totalSuccessful = 0;
      let totalFailed = 0;
      let totalEnrolled = 0;
      const allErrors: Array<{ index: number; name: string; error: string }> = [];

      for (let i = 0; i < mappedContacts.length; i += BATCH_SIZE) {
        const batch = mappedContacts.slice(i, i + BATCH_SIZE);
        const contacts = batch.map((c) => ({
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          address1: c.address1,
          city: c.city,
          state: c.state,
          postalCode: c.postalCode,
          customFields: [
            { fieldKey: "number_of_dogs", field_value: c.numberOfDogs },
            { fieldKey: "last_time_scooped", field_value: c.lastTimeScooped },
            { fieldKey: "frequency", field_value: c.frequency },
          ].filter((field) => String(field.field_value ?? "").trim() !== ""),
        }));

        const result = await processBatchMutation.mutateAsync({
          locationId,
          contacts,
          dnd,
          tagName,
        });

        totalSuccessful += result.successful;
        totalFailed += result.failed;
        totalEnrolled += result.enrolled;
        allErrors.push(...result.errors);

        setProgress(
          Math.round(
            (Math.min(i + BATCH_SIZE, mappedContacts.length) /
              mappedContacts.length) *
              100
          )
        );
      }

      // Show results
      if (totalFailed === 0) {
        toast.success(
          `All ${totalSuccessful} contacts uploaded successfully!`,
          {
            description:
              totalEnrolled > 0
                ? `${totalEnrolled} contacts enrolled in Review Reactivation workflow.`
                : dnd
                ? "Contacts marked as DND — not enrolled in workflow."
                : undefined,
            icon: <CheckCircle2 className="h-4 w-4 text-primary" />,
          }
        );
      } else {
        toast.warning(`Upload completed with some errors`, {
          description: `${totalSuccessful} succeeded, ${totalFailed} failed. ${totalEnrolled} enrolled in workflow.`,
          icon: <AlertCircle className="h-4 w-4" />,
        });
      }

      onComplete();
    } catch (error) {
      toast.error("Upload failed", {
        description:
          error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          Review & Confirm
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Review your settings before uploading
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-muted/50 border rounded-lg p-4">
        <h4 className="text-sm font-semibold text-foreground mb-1">Summary</h4>
        <p className="text-sm text-muted-foreground">
          Ready to upload contacts from{" "}
          <span className="font-medium text-foreground">
            {parsedCSV.fileName}
          </span>
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Columns mapped: {mappedColumns.join(", ")}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Total contacts:{" "}
          <span className="font-medium text-foreground">
            {parsedCSV.totalRows}
          </span>
        </p>
      </div>

      <div className="rounded-3xl border border-border bg-muted/70 p-4">
        <p className="text-sm font-semibold text-foreground">Add contacts too:</p>
        <div className="grid gap-2 pt-3 text-sm">
          {[
            { value: "lead-follow-up", label: "Lead Follow-Up" },
            { value: "reactivation-campaign", label: "Reactivation Campaign" },
            { value: "add-on-campaign", label: "Add-on Campaign" },
            { value: "quick-send", label: "Quick Send" },
          ].map((option) => (
            <label key={option.value} className="flex items-center gap-3 rounded-xl border border-input bg-background p-3 cursor-pointer transition hover:border-primary/70">
              <input
                type="radio"
                name="batchTag"
                value={option.value}
                checked={tagOption === option.value}
                onChange={() => setTagOption(option.value as typeof tagOption)}
                className="h-4 w-4 text-primary focus:ring-primary"
              />
              <span className="font-medium text-foreground">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* DND Toggle */}
      <div className="border rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <Ban className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-foreground">
              Add to Do Not Contact List
            </h4>
            <p className="text-xs text-muted-foreground">
              Toggle on if you want to block these contacts from receiving
              messages
            </p>
          </div>
        </div>
        <Switch
          checked={dnd}
          onCheckedChange={setDnd}
          className="data-[state=checked]:bg-destructive"
        />
      </div>

      {/* Consent Checkbox */}
      <div className="border rounded-lg p-4 flex items-start gap-3 bg-primary/5 border-primary/20">
        <Checkbox
          id="bulk-consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
        <label
          htmlFor="bulk-consent"
          className="text-sm text-foreground leading-tight cursor-pointer"
        >
          I have the required consent to message these customers by email or
          SMS. Review requests will be sent during business hours.
        </label>
      </div>

      {/* Progress Bar (visible during upload) */}
      {isUploading && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Processing contacts...</span>
            <span>{progress}%</span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isUploading}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={handleUpload}
          disabled={!consent || isUploading}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          {isUploading ? `Uploading... ${progress}%` : "Upload Contacts"}
        </Button>
      </div>
    </div>
  );
}
