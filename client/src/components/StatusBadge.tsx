import { cn } from "@/lib/utils";

export type BadgeVariant = "active" | "completed" | "dnd" | "none";

interface StatusBadgeProps {
  status: "Active" | "Completed" | "DND" | null;
  className?: string;
}

const variantMap: Record<NonNullable<StatusBadgeProps["status"]>, BadgeVariant> = {
  Active: "active",
  Completed: "completed",
  DND: "dnd",
};

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  if (!status) return null;

  const variant = variantMap[status];

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-0.5 text-xs font-semibold whitespace-nowrap",
        variant === "active" &&
          "bg-yellow-100 text-yellow-800 border border-yellow-200",
        variant === "completed" &&
          "bg-green-100 text-green-800 border border-green-200",
        variant === "dnd" &&
          "bg-red-100 text-red-800 border border-red-200",
        className
      )}
    >
      {status}
    </span>
  );
}
