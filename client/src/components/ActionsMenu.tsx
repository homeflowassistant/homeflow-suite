import { useState, useRef, useEffect } from "react";
import { MoreVertical, Pencil, Ban, Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import EditContactDialog from "./EditContactDialog";
import ManageTagsDialog from "./ManageTagsDialog";
import type { ContactWithStatus } from "../../../server/routers/contacts";

interface ActionsMenuProps {
  contactId: string;
  contactName: string;
  contact: ContactWithStatus;
  locationId: string;
  isDnd: boolean;
  className?: string;
  onContactUpdated: (updated: ContactWithStatus) => void;
}

type ActionType = "edit" | "tags" | null;

export default function ActionsMenu({
  contactId,
  contactName,
  contact,
  locationId,
  isDnd,
  className,
  onContactUpdated,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionType>(null);
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

  // Toggle DND mutation
  const toggleDndMutation = trpc.contacts.toggleDnd.useMutation({
    onSuccess: (data) => {
      const status = data.dndEnabled ? "enabled" : "disabled";
      toast.success(`DND ${status} for ${contactName}`);
      onContactUpdated(data.contact);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to toggle DND");
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

  const handleTags = () => {
    setOpen(false);
    setActiveAction("tags");
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
              onClick={handleTags}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <Tags className="h-3.5 w-3.5" />
              Manage Tags
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
          </div>
        )}
      </div>

      {/* Edit Contact Dialog */}
      {activeAction === "edit" && (
        <EditContactDialog
          open={true}
          onClose={() => setActiveAction(null)}
          contact={contact}
          locationId={locationId}
          onUpdated={(updated) => {
            onContactUpdated(updated);
            setActiveAction(null);
          }}
        />
      )}

      {/* Manage Tags Dialog */}
      {activeAction === "tags" && (
        <ManageTagsDialog
          open={true}
          onClose={() => setActiveAction(null)}
          contact={contact}
          locationId={locationId}
          onUpdated={(updated) => {
            onContactUpdated(updated);
            setActiveAction(null);
          }}
        />
      )}
    </>
  );
}
