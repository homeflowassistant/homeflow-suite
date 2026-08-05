import { useState, useRef, useEffect } from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionsMenuProps {
  contactId: string;
  contactName: string;
  isDnd: boolean;
  className?: string;
}

interface MenuItem {
  label: string;
  variant?: "default" | "destructive";
  onClick?: () => void;
  disabled?: boolean;
}

export default function ActionsMenu({
  contactId,
  contactName,
  isDnd,
  className,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
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

  const menuItems: MenuItem[] = [
    {
      label: "View Contact",
      onClick: () => {
        // Placeholder: Open contact detail view
        console.log(`View contact ${contactId}`);
      },
    },
    {
      label: "Edit Contact",
      onClick: () => {
        // Placeholder: Open edit modal
        console.log(`Edit contact ${contactId}`);
      },
    },
    {
      label: "Send Message",
      onClick: () => {
        // Placeholder: Open send message modal
        console.log(`Send message to ${contactId}`);
      },
    },
    {
      label: "Tag Contact",
      onClick: () => {
        // Placeholder: Open tag management
        console.log(`Tag contact ${contactId}`);
      },
    },
    ...(isDnd
      ? []
      : [
          {
            label: "Set DND",
            onClick: () => {
              // Placeholder: Toggle DND
              console.log(`Set DND for ${contactId}`);
            },
          },
        ]),
    {
      label: "Remove",
      variant: "destructive",
      onClick: () => {
        // Placeholder: Confirm removal
        console.log(`Remove contact ${contactId}`);
      },
    },
  ];

  return (
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
          {menuItems.map((item, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                item.onClick?.();
                setOpen(false);
              }}
              disabled={item.disabled}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors",
                item.variant === "destructive"
                  ? "text-red-600 hover:bg-red-50"
                  : "text-slate-700 hover:bg-slate-50",
                item.disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
