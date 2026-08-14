import { format } from "date-fns";
import StatusBadge from "./StatusBadge";
import ActionsMenu from "./ActionsMenu";
import type { ContactWithStatus } from "../../../server/routers/contacts";

interface ContactRowProps {
  contact: ContactWithStatus;
  index: number;
  locationId: string;
  onFullRefresh: () => void;
}

function capitalizeName(name: string): string {
  return name.replace(/\S+/g, word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

function formatDisplayName(contact: ContactWithStatus): string {
  const first = contact.firstName?.trim();
  const last = contact.lastName?.trim();
  if (first && last) return capitalizeName(`${first} ${last}`);
  if (first) return capitalizeName(first);
  if (last) return capitalizeName(last);
  return contact.name ? capitalizeName(contact.name) : "Unknown";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    return format(date, "MMM d, yyyy");
  } catch {
    return "";
  }
}

export default function ContactRow({
  contact,
  index,
  locationId,
  onFullRefresh,
}: ContactRowProps) {
  return (
    <tr
      className={index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
      style={{ borderBottom: "1px solid #e2e8f0" }}
    >
      {/* Name */}
      <td className="px-3 py-2.5 text-sm text-slate-800 font-medium whitespace-nowrap">
        {formatDisplayName(contact)}
      </td>

      {/* Phone */}
      <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">
        {contact.phone || <span className="text-slate-300">—</span>}
      </td>

      {/* Email */}
      <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap max-w-[180px] truncate">
        {contact.email || <span className="text-slate-300">—</span>}
      </td>

      {/* Lead Follow-Up */}
      <td className="px-3 py-2.5 text-center">
        <StatusBadge status={contact.leadFollowUpStatus} />
      </td>

      {/* Reactivation */}
      <td className="px-3 py-2.5 text-center">
        <StatusBadge status={contact.reactivationStatus} />
      </td>

      {/* Add-On */}
      <td className="px-3 py-2.5 text-center">
        <StatusBadge status={contact.addOnStatus} />
      </td>

      {/* Date Added */}
      <td className="px-3 py-2.5 text-sm text-slate-500 whitespace-nowrap">
        {formatDate(contact.dateAdded) || (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-2.5 text-right">
        <ActionsMenu
          contactId={contact.id}
          contactName={formatDisplayName(contact)}
          contact={contact}
          locationId={locationId}
          isDnd={contact.dnd}
          onFullRefresh={onFullRefresh}
        />
      </td>
    </tr>
  );
}
