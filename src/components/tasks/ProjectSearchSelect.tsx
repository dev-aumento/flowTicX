import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type ProjectSearchOption = {
  id: number;
  name: string;
  color?: string | null;
};

type ProjectSearchSelectProps = {
  projects: ProjectSearchOption[];
  /** Used to label the current value even if it is missing from `projects`. */
  knownProject?: ProjectSearchOption | null;
  value?: number | null;
  onValueChange: (projectId: number | undefined) => void;
  placeholder?: string;
  /** Label for the clear / unassign option. Defaults to `placeholder`. */
  clearLabel?: string;
  searchPlaceholder?: string;
  triggerClassName?: string;
  containerClassName?: string;
  disabled?: boolean;
  allowClear?: boolean;
};

export function ProjectSearchSelect({
  projects,
  knownProject = null,
  value,
  onValueChange,
  placeholder = "No project",
  clearLabel,
  searchPlaceholder = "Search projects…",
  triggerClassName,
  containerClassName,
  disabled = false,
  allowClear = true,
}: ProjectSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const clearOptionLabel = clearLabel ?? placeholder;

  const projectOptions = useMemo(() => {
    const byId = new Map<number, ProjectSearchOption>();
    for (const project of projects) {
      if (project?.id == null || !project.name) continue;
      byId.set(project.id, project);
    }
    if (knownProject?.id != null && knownProject.name && !byId.has(knownProject.id)) {
      byId.set(knownProject.id, knownProject);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, knownProject]);

  const selected = useMemo(() => {
    if (value == null) return null;
    return projectOptions.find((project) => project.id === value) ?? knownProject ?? null;
  }, [projectOptions, value, knownProject]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("min-w-0 w-full max-w-[240px]", containerClassName)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return;
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "h-9 w-full max-w-[240px] px-3 rounded-lg border border-gray-200 bg-white text-sm inline-flex items-center justify-between gap-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:cursor-not-allowed disabled:opacity-60",
              triggerClassName,
            )}
            aria-label={placeholder}
            aria-expanded={open}
          >
            <span
              className={cn(
                "truncate text-left flex items-center gap-2 min-w-0",
                selected ? "text-gray-800" : "text-gray-400",
              )}
            >
              {selected ? (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: selected.color ?? "#2563EB" }}
                />
              ) : null}
              <span className="truncate">{selected?.name || placeholder}</span>
            </span>
            <ChevronDown size={14} className="shrink-0 text-gray-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="z-[200] w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const input = contentRef.current?.querySelector("input");
            input?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => setOpen(false)}
        >
          <div ref={contentRef}>
            <Command>
              <CommandInput placeholder={searchPlaceholder} />
              <CommandList className="max-h-56 overflow-y-auto overscroll-contain">
                <CommandEmpty>No projects found.</CommandEmpty>
                <CommandGroup>
                  {allowClear ? (
                    <CommandItem
                      value={`${clearOptionLabel} clear`}
                      onSelect={() => {
                        onValueChange(undefined);
                        setOpen(false);
                      }}
                      className="gap-2 cursor-pointer"
                    >
                      <Check
                        size={14}
                        className={cn(
                          "shrink-0 text-[#2563EB]",
                          selected ? "opacity-0" : "opacity-100",
                        )}
                      />
                      <span className="text-gray-500">{clearOptionLabel}</span>
                    </CommandItem>
                  ) : null}
                  {projectOptions.map((project) => {
                    const isSelected = selected?.id === project.id;
                    return (
                      <CommandItem
                        key={project.id}
                        value={project.name}
                        onSelect={() => {
                          onValueChange(project.id);
                          setOpen(false);
                        }}
                        className="gap-2 cursor-pointer"
                      >
                        <Check
                          size={14}
                          className={cn(
                            "shrink-0 text-[#2563EB]",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: project.color ?? "#2563EB" }}
                        />
                        <span className="truncate">{project.name}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
