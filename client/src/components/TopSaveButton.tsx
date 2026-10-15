import { Save } from "lucide-react";

type TopSaveButtonProps = {
  onClick: () => void;
  isSaving?: boolean;
  disabled?: boolean;
  label?: string;
};

export default function TopSaveButton({
  onClick,
  isSaving = false,
  disabled = false,
  label = "Save",
}: TopSaveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isSaving}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={isSaving ? "Saving changes" : label}
    >
      <Save className="h-4 w-4" aria-hidden="true" />
      {isSaving ? "Saving..." : label}
    </button>
  );
}
