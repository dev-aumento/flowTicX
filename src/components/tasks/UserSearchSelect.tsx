import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
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

export type UserSearchOption = {
  id: number;
  name: string | null;
  avatar?: string | null;
};

type UserSearchSelectBase = {
  users: UserSearchOption[];
  /** Extra users used only to resolve selected labels (e.g. current assignee). */
  knownUsers?: UserSearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  triggerClassName?: string;
  disabled?: boolean;
};

type UserSearchSelectSingleProps = UserSearchSelectBase & {
  mode: "single";
  value?: number | null;
  onValueChange: (id: number | undefined) => void;
  allowClear?: boolean;
  selected?: never;
  onToggle?: never;
};

type UserSearchSelectMultiProps = UserSearchSelectBase & {
  mode: "multi";
  selected: number[];
  onToggle: (id: number) => void;
  value?: never;
  onValueChange?: never;
  allowClear?: never;
};

export type UserSearchSelectProps = UserSearchSelectSingleProps | UserSearchSelectMultiProps;

export function UserSearchSelect(props: UserSearchSelectProps) {
  const {
    users,
    knownUsers,
    mode,
    placeholder = "Select people…",
    searchPlaceholder = "Search employees…",
    triggerClassName,
    disabled = false,
  } = props;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const selectedIds =
    mode === "single"
      ? props.value != null
        ? [props.value]
        : []
      : props.selected;

  const lookup = useMemo(() => {
    const map = new Map<number, UserSearchOption>();
    for (const user of knownUsers ?? []) map.set(user.id, user);
    for (const user of users) map.set(user.id, user);
    return map;
  }, [users, knownUsers]);

  const selectedUsers = useMemo(
    () =>
      selectedIds
        .map((id) => lookup.get(id))
        .filter((user): user is UserSearchOption => user != null),
    [lookup, selectedIds],
  );

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

  // Dialog RemoveScroll preventDefaults wheel outside the dialog. The popover is
  // portaled to body, so native list scrolling never happens — drive scrollTop ourselves.
  useEffect(() => {
    if (!open) return;

    const onWheel = (event: WheelEvent) => {
      const root = contentRef.current;
      const target = event.target as Node | null;
      if (!root || !target || !root.contains(target)) return;

      const list = root.querySelector<HTMLElement>("[data-slot=command-list]");
      if (!list) return;

      event.preventDefault();
      event.stopPropagation();
      list.scrollTop += event.deltaY;
    };

    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () =>
      document.removeEventListener("wheel", onWheel, { capture: true });
  }, [open]);

  const triggerLabel =
    selectedUsers.length === 0
      ? placeholder
      : mode === "single"
        ? selectedUsers[0].name || placeholder
        : selectedUsers.length === 1
          ? selectedUsers[0].name || "1 selected"
          : `${selectedUsers.length} selected`;

  return (
    <div ref={rootRef} className="space-y-2 min-w-0 w-full">
      <Popover
        modal
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
              "w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm inline-flex items-center justify-between gap-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:cursor-not-allowed disabled:opacity-60",
              triggerClassName,
            )}
            aria-label={placeholder}
            aria-expanded={open}
          >
            <span
              className={cn(
                "truncate text-left flex items-center gap-2 min-w-0",
                selectedUsers.length === 0 ? "text-gray-400" : "text-gray-800",
              )}
            >
              {mode === "single" && selectedUsers[0] ? (
                <UserAvatar
                  name={selectedUsers[0].name}
                  avatar={selectedUsers[0].avatar}
                  size={18}
                />
              ) : null}
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown size={14} className="shrink-0 text-gray-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="z-[200] w-[var(--radix-popover-trigger-width)] p-0"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const input = contentRef.current?.querySelector("input");
            input?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => setOpen(false)}
          onWheel={(event) => event.stopPropagation()}
        >
          <div ref={contentRef}>
            <Command>
              <CommandInput placeholder={searchPlaceholder} />
              <CommandList className="max-h-56 overscroll-contain">
                <CommandEmpty>No employees found.</CommandEmpty>
                <CommandGroup>
                  {mode === "single" && props.allowClear ? (
                    <CommandItem
                      value="unassigned clear"
                      onSelect={() => {
                        props.onValueChange(undefined);
                        setOpen(false);
                      }}
                      className="gap-2 cursor-pointer"
                    >
                      <Check
                        size={14}
                        className={cn(
                          "shrink-0 text-[#2563EB]",
                          selectedIds.length === 0 ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="text-gray-500">{placeholder}</span>
                    </CommandItem>
                  ) : null}
                  {users.map((user) => {
                    const isSelected = selectedIds.includes(user.id);
                    return (
                      <CommandItem
                        key={user.id}
                        value={`${user.name ?? ""} ${user.id}`}
                        onSelect={() => {
                          if (mode === "single") {
                            props.onValueChange(user.id);
                            setOpen(false);
                            return;
                          }
                          props.onToggle(user.id);
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
                        <UserAvatar name={user.name} avatar={user.avatar} size={20} />
                        <span className="truncate">{user.name || "Unnamed"}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </PopoverContent>
      </Popover>

      {mode === "multi" && selectedUsers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedUsers.map((user) => (
            <span
              key={user.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-medium text-[#2563EB]"
            >
              <UserAvatar name={user.name} avatar={user.avatar} size={16} />
              <span className="truncate">{user.name || "Unnamed"}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => props.onToggle(user.id)}
                className="shrink-0 rounded-full p-0.5 text-[#2563EB]/70 hover:bg-blue-100 hover:text-[#2563EB] disabled:opacity-50"
                aria-label={`Remove ${user.name || "user"}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
