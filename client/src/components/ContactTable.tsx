import { Loader2, Inbox, AlertCircle } from "lucide-react";
import ContactRow from "./ContactRow";
import type { ContactWithStatus } from "../../../server/routers/contacts";

interface ContactTableProps {
  contacts: ContactWithStatus[];
  loading: boolean;
  error: string | null;
  locationId: string;
  onFullRefresh: () => void;
}

export default function ContactTable({
  contacts,
  loading,
  error,
  locationId,
  onFullRefresh,
}: ContactTableProps) {
  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <AlertCircle className="h-7 w-7 text-red-500" />
        </div>
        <p className="text-sm font-medium text-slate-800 mb-1">
          Failed to load contacts
        </p>
        <p className="text-xs text-slate-500 text-center max-w-sm">{error}</p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <Loader2 className="h-8 w-8 text-cyan-500 animate-spin mb-4" />
        <p className="text-sm text-slate-600">Loading contacts...</p>
      </div>
    );
  }

  // Empty state
  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Inbox className="h-7 w-7 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-700 mb-1">
          No contacts found
        </p>
        <p className="text-xs text-slate-500 text-center max-w-sm">
          Add contacts to your GoHighLevel account or try a different search.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-blue-600 text-white">
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Name
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Phone
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Email
            </th>
            <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Lead Follow-Up
            </th>
            <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Reactivation
            </th>
            <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Add-On
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Date Added
            </th>
            <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact, index) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              index={index}
              locationId={locationId}
              onFullRefresh={onFullRefresh}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
