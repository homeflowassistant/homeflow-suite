import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Search,
  Tag,
  X,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ContactWithStatus } from "../../../server/routers/contacts";

interface ManageTagsDialogProps {
  open: boolean;
  onClose: () => void;
  contact: ContactWithStatus;
  locationId: string;
  onUpdated: (updated: ContactWithStatus) => void;
  onFullRefresh: () => void;
}

export default function ManageTagsDialog({
  open,
  onClose,
  contact,
  locationId,
  onUpdated,
  onFullRefresh,
}: ManageTagsDialogProps) {
  const [contactTags, setContactTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [showAvailableTags, setShowAvailableTags] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  // Fetch all account tags when dialog opens
  const accountTagsQuery = trpc.contacts.getAccountTags.useQuery(
    { locationId },
    {
      enabled: open,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    }
  );

  const allAccountTags = accountTagsQuery.data?.tags || [];

  // Tags that are available to add (not already on the contact)
  const availableTags = useMemo(() => {
    const lowerContactTags = new Set(
      contactTags.map(t => t.toLowerCase().trim())
    );
    let filtered = allAccountTags.filter(
      t => !lowerContactTags.has(t.toLowerCase().trim())
    );
    if (tagSearch.trim()) {
      const query = tagSearch.toLowerCase().trim();
      filtered = filtered.filter(t => t.toLowerCase().includes(query));
    }
    return filtered;
  }, [allAccountTags, contactTags, tagSearch]);

  // Populate contact tags when dialog opens
  useEffect(() => {
    if (open) {
      setContactTags(contact.tags || []);
      setTagSearch("");
      setShowAvailableTags(false);
      setIsAdding(null);
      setIsRemoving(null);
    }
  }, [open, contact]);

  const addTagMutation = trpc.contacts.addTag.useMutation({
    onSuccess: data => {
      toast.success("Tag added successfully");
      setContactTags(data.contact.tags);
      onUpdated(data.contact);
      onFullRefresh();
      setIsAdding(null);
    },
    onError: err => {
      toast.error(err.message || "Failed to add tag");
      setIsAdding(null);
    },
  });

  const removeTagMutation = trpc.contacts.removeTag.useMutation({
    onSuccess: data => {
      toast.success("Tag removed successfully");
      setContactTags(data.contact.tags);
      onUpdated(data.contact);
      onFullRefresh();
      setIsRemoving(null);
    },
    onError: err => {
      toast.error(err.message || "Failed to remove tag");
      setIsRemoving(null);
    },
  });

  const handleAddTag = async (tagName: string) => {
    if (!tagName.trim()) {
      toast.error("Tag name cannot be empty");
      return;
    }

    // Prevent duplicate
    if (
      contactTags.some(
        t => t.toLowerCase().trim() === tagName.toLowerCase().trim()
      )
    ) {
      toast.error("This tag already exists on the contact");
      return;
    }

    setIsAdding(tagName);
    try {
      await addTagMutation.mutateAsync({
        locationId,
        contactId: contact.id,
        tagName: tagName.trim(),
      });
    } catch {
      // Error handled by mutation onError
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    setIsRemoving(tagName);
    try {
      await removeTagMutation.mutateAsync({
        locationId,
        contactId: contact.id,
        tagName,
      });
    } catch {
      // Error handled by mutation onError
    }
  };

  const isBusy =
    isAdding !== null || isRemoving !== null || accountTagsQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Manage Tags
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current tags on contact */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              Tags on this contact ({contactTags.length})
            </Label>
            {contactTags.length === 0 ? (
              <p className="text-sm text-slate-400 py-3 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                No tags on this contact. Select from available tags below.
              </p>
            ) : (
              <div className="max-h-[160px] overflow-y-auto space-y-1 border border-slate-200 rounded-lg p-2">
                {contactTags.map(tag => (
                  <div
                    key={tag}
                    className="flex items-center justify-between bg-slate-50 rounded-md px-3 py-2 group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Tag className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      <span className="text-sm text-slate-700 truncate">
                        {tag}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTag(tag)}
                      disabled={isBusy}
                      className="h-6 w-6 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove tag ${tag}`}
                      title="Remove this tag"
                    >
                      {isRemoving === tag ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available account tags */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-slate-700">
                Available Account Tags
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAvailableTags(!showAvailableTags)}
                className="h-6 text-xs text-slate-500 hover:text-slate-700 px-1.5"
              >
                {showAvailableTags ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-0.5" />
                    Collapse
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-0.5" />
                    Show ({availableTags.length})
                  </>
                )}
              </Button>
            </div>

            {showAvailableTags && (
              <>
                {/* Search filter for available tags */}
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                  <Search className="h-4 w-4 text-slate-400 shrink-0" />
                  <Input
                    value={tagSearch}
                    onChange={e => setTagSearch(e.target.value)}
                    placeholder="Filter tags..."
                    className="h-7 text-sm border-0 focus-visible:ring-0 px-0 py-0 shadow-none"
                    disabled={isBusy}
                  />
                </div>

                {accountTagsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400 mr-2" />
                    <span className="text-sm text-slate-400">
                      Loading tags...
                    </span>
                  </div>
                ) : availableTags.length === 0 ? (
                  <p className="text-sm text-slate-400 py-3 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                    {tagSearch
                      ? "No tags match your filter"
                      : "All tags are already applied"}
                  </p>
                ) : (
                  <div className="max-h-[200px] overflow-y-auto space-y-1 border border-slate-200 rounded-lg p-2">
                    {availableTags.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleAddTag(tag)}
                        disabled={isBusy}
                        className="w-full flex items-center justify-between bg-white hover:bg-blue-50 rounded-md px-3 py-2 transition-colors border border-slate-100 hover:border-blue-200 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Tag className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="text-sm text-slate-700 truncate">
                            {tag}
                          </span>
                        </div>
                        {isAdding === tag ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />
                        ) : (
                          <Plus className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Manual tag input fallback */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              Add Custom Tag
            </Label>
            <ManualTagInput onAdd={handleAddTag} disabled={isBusy} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manual Tag Input (fallback for creating new tags) ────────────────

function Plus(props: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

interface ManualTagInputProps {
  onAdd: (tag: string) => void;
  disabled: boolean;
}

function ManualTagInput({ onAdd, disabled }: ManualTagInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a new tag name and press Enter..."
        className="h-9 text-sm flex-1"
        disabled={disabled}
      />
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="h-9 px-3"
      >
        {disabled ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
