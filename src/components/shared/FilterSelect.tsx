import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterSelectOption = {
  value: string;
  label: string;
};

type FilterSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: FilterSelectOption[];
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
};

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  "aria-label": ariaLabel,
  className,
  triggerClassName,
  contentClassName,
  align = "start",
}: FilterSelectProps) {
  const selected = options.find((option) => option.value === value);
  const label = selected?.label ?? placeholder;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 inline-flex items-center gap-2 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]",
            triggerClassName,
            className,
          )}
        >
          <span className="truncate text-left flex-1">{label}</span>
          <ChevronDown size={14} className="shrink-0 text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        collisionPadding={16}
        className={cn(
          "min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(20rem,calc(100vw-2rem))] max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg",
          contentClassName,
        )}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <DropdownMenuItem
              key={option.value || "__empty__"}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer",
                isSelected
                  ? "bg-[#2563EB]/10 text-[#1D4ED8] font-medium focus:bg-[#2563EB]/10 focus:text-[#1D4ED8]"
                  : "text-gray-700",
              )}
            >
              <span className="truncate">{option.label}</span>
              {isSelected ? <Check size={14} className="shrink-0 text-[#2563EB]" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
