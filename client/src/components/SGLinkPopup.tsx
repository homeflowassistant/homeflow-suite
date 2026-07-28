import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Play, Copy, ExternalLink, Save, Loader2 } from "lucide-react";

const YOUTUBE_VIDEO_URL = "https://www.youtube.com/embed/Y1BzphlS07g";

const INSTRUCTIONS = [
  {
    step: 1,
    title: "Log in to WordPress",
    description: "Go to your WordPress admin dashboard at yourdomain.com/wp-admin and log in with your credentials.",
  },
  {
    step: 2,
    title: "Navigate to Sweep&Go Core",
    description: "In the left sidebar, find and click on 'Sweep&Go Core' to expand the menu.",
  },
  {
    step: 3,
    title: "Click on Pages",
    description: "Under the Sweep&Go Core menu, click on 'Pages' to view all available pages.",
  },
  {
    step: 4,
    title: "Find Client Onboarding",
    description: "Look for the 'Client Onboarding' page in the list of pages.",
  },
  {
    step: 5,
    title: "View the Page",
    description: "Hover over 'Client Onboarding' and click 'View' to open the page in your browser.",
  },
  {
    step: 6,
    title: "Copy the URL",
    description: "Copy the full URL from your browser's address bar. This is your base onboarding link.",
  },
];

interface SGLinkPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
}

export default function SGLinkPopup({ open, onOpenChange, locationId }: SGLinkPopupProps) {
  const [baseLink, setBaseLink] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const saveMutation = trpc.requestScheduling.saveSgLinkSettings.useMutation();

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

  const handleSave = async () => {
    if (!baseLink.trim()) return;
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        baseOnboardingLink: baseLink.trim(),
      });
      toast.success("Base onboarding link saved successfully!");
    } catch (error) {
      toast.error("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) {
        setBaseLink("");
      }
      onOpenChange(newOpen);
    }}>
      <DialogContent className="max-w-[98vw] w-[98vw] sm:max-w-[96vw] lg:max-w-[92vw] xl:max-w-[1600px] p-0 gap-0 max-h-[95vh] rounded-xl border-2 border-blue-600 flex flex-col">
        {/* Fixed Header */}
        <div className="px-6 pt-6 pb-4 border-b border-blue-100 flex-shrink-0">
          <DialogTitle className="text-2xl font-bold text-blue-700">
            Sweep & Go Base Onboarding Link
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Watch the video below to learn how to find your base onboarding link, then paste it in the field below.
          </DialogDescription>
        </div>

        {/* Scrollable Content Area */}
        <div className="overflow-y-auto flex-1 p-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
