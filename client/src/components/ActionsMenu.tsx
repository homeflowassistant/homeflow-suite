import { useState, useRef, useEffect } from "react";
import { MoreVertical, Pencil, Ban, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import EditContactDialog from "./EditContactDialog";
import type { ContactWithStatus } from "../../../server/routers/contacts";

interface ActionsMenuProps {
  contactId: string;
  contactName: string;
  contact: ContactWithStatus;
  locationId: string;
  isDnd: boolean;
  className?: string;
  onFullRefresh: () => void;
}

type ActionType = "edit" | "delete" | null;

export default function ActionsMenu({
  contactId,
  contactName,
  contact,
  locationId,
  isDnd,
  className,
  onFullRefresh,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionType>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Toggle DND mutation — refresh on success
  const toggleDndMutation = trpc.contacts.toggleDnd.useMutation({
    onSuccess: () => {
      const newDnd = !isDnd;
      const status = newDnd ? "enabled" : "disabled";
      toast.success(`DND ${status} for ${contactName}`);
      // Refresh immediately after the mutation succeeds
      onFullRefresh();
    },
    onError: err => {
      toast.error(err.message || "Failed to toggle DND");
    },
  });

  // Delete contact mutation — refresh on success
  const deleteContactMutation = trpc.contacts.deleteContact.useMutation({
    onSuccess: () => {
      toast.success(`Contact "${contactName}" deleted successfully`);
      // Refresh immediately after the mutation succeeds
      onFullRefresh();
      setShowDeleteConfirm(false);
      setActiveAction(null);
    },
    onError: err => {
      toast.error(err.message || "Failed to delete contact");
    },
  });

  const handleToggleDnd = () => {
    setOpen(false);
    toggleDndMutation.mutate({
      locationId,
      contactId,
    });
  };

  const handleEdit = () => {
    setOpen(false);
    setActiveAction("edit");
  };

  const handleDeleteClick = () => {
    setOpen(false);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    deleteContactMutation.mutate({
      locationId,
      contactId,
    });
  };

  // When the Edit dialog closes (via onClose), trigger a refresh.
  // This ensures the table shows fresh data even if the mutation callback
  // ran before the UI had time to update.
  const handleEditClose = () => {
    onFullRefresh();
    setActiveAction(null);
  };

  return (
    <>
      <div className={cn("relative inline-block", className)} ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-slate-100 transition-colors"
          aria-label={`Actions for ${contactName}`}
          aria-expanded={open}
        >
          <MoreVertical className="h-4 w-4 text-slate-500" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-slate-200 bg-white shadow-lg py-1 animate-in fade-in slide-in-from-top-1">
            <button
              type="button"
              onClick={handleEdit}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Contact
            </button>

            <button
              type="button"
              onClick={handleToggleDnd}
              disabled={toggleDndMutation.isPending}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2",
                isDnd
                  ? "text-slate-700 hover:bg-slate-50"
                  : "text-red-600 hover:bg-red-50",
                toggleDndMutation.isPending && "opacity-50 cursor-not-allowed"
              )}
            >
              {toggleDndMutation.isPending ? (
                <div className="h-3.5 w-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              ) : (
                <Ban className="h-3.5 w-3.5" />
              )}
              {isDnd ? "Disable DND" : "Enable DND"}
            </button>

            {/* Separator */}
            <div className="my-1 border-t border-slate-100" />

            <button
              type="button"
              onClick={handleDeleteClick}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Edit Contact Dialog — refresh when it closes */}
      {activeAction === "edit" && (
        <EditContactDialog
          open={true}
          onClose={handleEditClose}
          contact={contact}
          locationId={locationId}
          onUpdated={() => {}}
          onFullRefresh={onFullRefresh}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 text-center mb-2">
              Delete Contact
            </h3>
            <p className="text-sm text-slate-600 text-center mb-6">
              Are you sure you want to delete <strong>{contactName}</strong>?
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                disabled={deleteContactMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteContactMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleteContactMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
