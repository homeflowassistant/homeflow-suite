/**
 * SGLinkPopup Component
 *
 * Popup for the S&G Link option on the Follow-Up (Request Scheduling) page.
 * Shows the YouTube video with instructions for finding the base onboarding link,
 * step-by-step text instructions, and a field to enter the base link.
 *
 * Saves the base link to the GHL custom field: base_onboarding_link
 * (accessible via {{custom_values.base_onboarding_link}} in GHL automations)
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Save, Loader2, ExternalLink, Copy, Play } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface SGLinkPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  defaultBaseLink?: string;
  onSaveSuccess?: () => void;
}

const YOUTUBE_VIDEO_URL = "https://www.youtube.com/embed/Y1BzphlS07g";

const INSTRUCTIONS = [
  {
    step: 1,
    title: "Log in to WordPress",
    description: "Log in to your WordPress dashboard using your credentials.",
  },
  {
    step: 2,
    title: "Navigate to Sweep&Go Core",
    description: "In the left-hand navigation menu, locate and click on \"Sweep&Go Core\".",
  },
  {
    step: 3,
    title: "Click on Pages",
    description: "From the sub-menu under Sweep&Go Core, click on \"Pages\".",
  },
  {
    step: 4,
    title: "Find Client Onboarding",
    description: "Scroll down the list of pages until you find the one titled \"Client Onboarding\".",
  },
  {
    step: 5,
    title: "View the Page",
    description: "Hover your mouse over the \"Client Onboarding\" title and click the \"View\" link that appears below it.",
  },
  {
    step: 6,
    title: "Copy the URL",
    description: "This will open the onboarding page in a new browser tab. The base onboarding link is the URL located in the address bar. Copy the URL and paste it below.",
  },
];

export default function SGLinkPopup({
  open,
  onOpenChange,
  locationId,
  defaultBaseLink = "",
  onSaveSuccess,
}: SGLinkPopupProps) {
  const [baseLink, setBaseLink] = useState(defaultBaseLink);
  const [isSaving, setIsSaving] = useState(false);

  const saveMutation = trpc.requestScheduling.saveSgLinkSettings.useMutation();

  const handleSave = useCallback(async () => {
    if (!baseLink.trim()) {
      toast.error("Please enter the base onboarding link.");
      return;
    }
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        baseOnboardingLink: baseLink.trim(),
      });
      toast.success("Base onboarding link saved successfully.");
      if (onSaveSuccess) {
        onSaveSuccess();
      }
      onOpenChange(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Error saving: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, [locationId, baseLink, saveMutation, onSaveSuccess, onOpenChange]);

  const handleCopyLink = () => {
    if (baseLink.trim()) {
      navigator.clipboard.writeText(baseLink.trim());
      toast.success("Link copied to clipboard!");
    }
  };

  const handleOpenLink = () => {
    if (baseLink.trim()) {
      window.open(baseLink.trim(), "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) {
        setBaseLink(defaultBaseLink);
      }
      onOpenChange(newOpen);
    }}>
      <DialogContent className="max-w-[98vw] w-[98vw] sm:max-w-[96vw] lg:max-w-[92vw] xl:max-w-[1600px] p-0 gap-0 overflow-hidden max-h-[95vh] rounded-xl border-2 border-blue-600">
        <div className="px-6 pt-6 pb-4 border-b border-blue-100">
          <DialogTitle className="text-2xl font-bold text-blue-700">
            Sweep & Go Base Onboarding Link
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Watch the video below to learn how to find your base onboarding link, then paste it in the field below.
          </DialogDescription>
        </div>

        <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Left Panel: Video + Instructions */}
          <div className="space-y-5">
            {/* YouTube Video */}
            <div className="rounded-xl border border-blue-100 overflow-hidden shadow-sm">
              <div className="aspect-video w-full">
                <iframe
                  src={YOUTUBE_VIDEO_URL}
                  title="How to find your base onboarding link"
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>

            {/* Step-by-Step Instructions */}
            <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100">
              <h3 className="font-semibold text-blue-800 text-sm mb-3 flex items-center gap-2">
                <Play className="h-4 w-4" />
                How to Find Your Base Onboarding Link
              </h3>
              <ol className="space-y-3">
                {INSTRUCTIONS.map((instruction) => (
                  <li key={instruction.step} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                      {instruction.step}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{instruction.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{instruction.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Right Panel: Base Link Input */}
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-semibold text-slate-800 text-base">
                Enter Your Base Onboarding Link
              </h3>
              <p className="text-sm text-slate-500">
                Paste the URL you copied from the Client Onboarding page in WordPress.
              </p>

              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-700">
                  Base Onboarding Link
                </label>
                <div className="flex gap-2">
                  <Input
                    type="url"
                    placeholder="https://yourdomain.com/client-onboarding"
                    value={baseLink}
                    onChange={(e) => setBaseLink(e.target.value)}
                    className="flex-1"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    disabled={!baseLink.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenLink}
                    disabled={!baseLink.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Link
                  </button>
                </div>

                {/* Link preview */}
                {baseLink.trim() && (
                  <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-xs font-medium text-green-700 mb-1">Link Preview:</p>
                    <p className="text-xs text-green-600 break-all font-mono">
                      {baseLink.trim()}
                    </p>
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !baseLink.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {isSaving ? "Saving..." : "Save Base Link"}
                </button>
              </div>

              {/* GHL custom field info */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-xs text-slate-500">
                  <strong>Saved to:</strong>{" "}
                  <code className="px-1 py-0.5 bg-slate-200 rounded text-xs font-mono">
                    &#123;&#123;custom_values.base_onboarding_link&#125;&#125;
                  </code>
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
