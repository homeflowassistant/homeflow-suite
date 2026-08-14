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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ContactWithStatus } from "../../../server/routers/contacts";

interface EditContactDialogProps {
  open: boolean;
  onClose: () => void;
  contact: ContactWithStatus;
  locationId: string;
  onUpdated: (updated: ContactWithStatus) => void;
  onFullRefresh: () => void;
}

export default function EditContactDialog({
  open,
  onClose,
  contact,
  locationId,
  onUpdated,
  onFullRefresh,
}: EditContactDialogProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Populate form when dialog opens
  useEffect(() => {
    if (open) {
      setFirstName(contact.firstName || "");
      setLastName(contact.lastName || "");
      setEmail(contact.email || "");
      setPhone(contact.phone || "");
    }
  }, [open, contact]);

  const updateContactMutation = trpc.contacts.updateContact.useMutation({
    onSuccess: data => {
      toast.success("Contact updated successfully");
      onUpdated(data.contact);
      onFullRefresh();
      onClose();
    },
    onError: err => {
      toast.error(err.message || "Failed to update contact");
    },
  });

  const handleSave = async () => {
    if (!firstName.trim()) {
      toast.error("First name is required");
      return;
    }

    setIsSaving(true);
    try {
      await updateContactMutation.mutateAsync({
        locationId,
        contactId: contact.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Edit Contact
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-first-name"
                className="text-sm font-medium text-slate-700"
              >
                First Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-first-name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="First name"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-last-name"
                className="text-sm font-medium text-slate-700"
              >
                Last Name
              </Label>
              <Input
                id="edit-last-name"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Last name"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="edit-email"
              className="text-sm font-medium text-slate-700"
            >
              Email
            </Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="edit-phone"
              className="text-sm font-medium text-slate-700"
            >
              Phone
            </Label>
            <Input
              id="edit-phone"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="h-9 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !firstName.trim()}
            className="min-w-[80px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
