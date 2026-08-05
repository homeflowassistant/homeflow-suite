import { useState, useEffect } from "react";
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
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ContactWithStatus } from "../../../server/routers/contacts";

interface ManageTagsDialogProps {
  open: boolean;
  onClose: () => void;
  contact: ContactWithStatus;
  locationId: string;
  onUpdated: (updated: ContactWithStatus) => void;
}

export default function ManageTagsDialog({
  open,
  onClose,
  contact,
  locationId,
  onUpdated,
}: ManageTagsDialogProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  // Populate tags when dialog opens
  useEffect(() => {
    if (open) {
      setTags(contact.tags || []);
      setNewTag("");
    }
  }, [open, contact]);

  const addTagMutation = trpc.contacts.addTag.useMutation({
    onSuccess: (data) => {
      toast.success(`Tag "${data.contact.id}" updated`);
      setTags(data.contact.tags);
      onUpdated(data.contact);
      setIsAdding(null);
      setNewTag("");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add tag");
      setIsAdding(null);
    },
  });

  const removeTagMutation = trpc.contacts.removeTag.useMutation({
    onSuccess: (data) => {
      toast.success("Tag removed successfully");
      setTags(data.contact.tags);
      onUpdated(data.contact);
      setIsRemoving(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to remove tag");
      setIsRemoving(null);
    },
  });

  const handleAddTag = async () => {
    const tagName = newTag.trim();
    if (!tagName) {
      toast.error("Tag name cannot be empty");
      return;
    }

    // Prevent duplicate
    if (tags.some((t) => t.toLowerCase().trim() === tagName.toLowerCase().trim())) {
      toast.error("This tag already exists on the contact");
      return;
    }

    setIsAdding(tagName);
    try {
      await addTagMutation.mutateAsync({
        locationId,
        contactId: contact.id,
        tagName,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newTag.trim()) {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Manage Tags
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Add new tag */}
          <div className="space-y-1.5">
            <Label htmlFor="new-tag" className="text-sm font-medium text-slate-700">
              Add Tag
            </Label>
            <div className="flex gap-2">
              <Input
                id="new-tag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter tag name..."
                className="h-9 text-sm flex-1"
                disabled={isAdding !== null || isRemoving !== null}
              />
              <Button
                size="sm"
                onClick={handleAddTag}
                disabled={isAdding !== null || isRemoving !== null || !newTag.trim()}
                className="h-9 px-3"
              >
                {isAdding !== null ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Existing tags list */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              Current Tags ({tags.length})
            </Label>
            {tags.length === 0 ? (
              <p className="text-sm text-slate-400 py-2 text-center">No tags on this contact</p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto space-y-1.5 border border-slate-200 rounded-lg p-2">
                {tags.map((tag) => (
                  <div
                    key={tag}
                    className="flex items-center justify-between bg-slate-50 rounded-md px-3 py-2 group"
                  >
                    <span className="text-sm text-slate-700 truncate mr-2">{tag}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTag(tag)}
                      disabled={isAdding !== null || isRemoving !== null}
                      className="h-6 w-6 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove tag ${tag}`}
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
