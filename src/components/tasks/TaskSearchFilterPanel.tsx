import { useEffect, useMemo, useRef, useState } from "react";
import { FolderKanban, Search, User, X, ClipboardList } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { FilterSelect } from "@/components/shared/FilterSelect";
import {
  DEFAULT_TASK_SEARCH_FILTERS,
  formatActiveTaskFiltersSummary,
  TASK_PERSON_ROLE_OPTIONS,
  taskStatusSidebarOptions,
  type TaskForSearchFilter,
  type TaskPersonRoleFilter,
  type TaskSearchFilters,
  type TaskStatusSidebarFilter,
} from "@/lib/task-search-filter";
import { useTaskStatusLabels } from "@/hooks/useTaskStatusLabels";
import {
  buildSearchSuggestions,
  type SearchSuggestion,
} from "@/lib/unified-search";
import { cn } from "@/lib/utils";

interface TaskSearchFilterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: TaskSearchFilters;
  onFiltersChange: (filters: TaskSearchFilters) => void;
  onReset: () => void;
  users: Array<{ id: number; name: string | null; avatar?: string | null }>;
  projects?: Array<{ id: number; name: string }>;
  tasks?: TaskForSearchFilter[];
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  showOverdueOnly?: boolean;
  className?: string;
  onTaskSelect?: (taskId: number) => void;
}

export function TaskSearchFilterPanel({
  open,
  onOpenChange,
  filters,
  onFiltersChange,
  onReset,
  users,
  projects = [],
  tasks = [],
  searchInput,
  onSearchInputChange,
  showOverdueOnly = false,
  className,
  onTaskSelect,
}: TaskSearchFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const statusLabels = useTaskStatusLabels();
  const statusSidebarOptions = useMemo(
    () => taskStatusSidebarOptions(statusLabels),
    [statusLabels],
  );
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<TaskSearchFilters>(filters);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);

  useEffect(() => {
    if (open) setDraftFilters(filters);
  }, [open, filters]);

  const searchContext = useMemo(
    () => ({ users, projects }),
    [users, projects],
  );

  const suggestions = useMemo(
    () => buildSearchSuggestions(searchInput, searchContext, tasks, 10),
    [searchInput, searchContext, tasks],
  );

  const isTyping = searchInput.trim().length > 0;
  const showFilterPanel = open && !isTyping;
  const showQuickSuggestions =
    isTyping && suggestions.length > 0 && !suggestionsDismissed;

  const closePanel = () => {
    onOpenChange(false);
    setAssigneeOpen(false);
  };

  const closeOverlays = () => {
    closePanel();
    setSuggestionsDismissed(true);
  };

  const openFilterPanel = () => {
    if (searchInput.trim()) return;
    setDraftFilters(filters);
    onOpenChange(true);
    setAssigneeOpen(false);
  };

  const handleSearchInputChange = (value: string) => {
    setSuggestionsDismissed(false);
    onSearchInputChange(value);
    if (value.trim()) {
      onOpenChange(false);
    }
  };

  useEffect(() => {
    if (!open && !showQuickSuggestions) {
      setAssigneeOpen(false);
      return;
    }

    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      closeOverlays();
    };

    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, showQuickSuggestions]);

  const selectedPerson = users.find((u) => u.id === filters.personUserId);
  const selectedProject = projects.find((p) => p.id === filters.projectId);
  const draftPerson = users.find((u) => u.id === draftFilters.personUserId);

  const filterSummary = formatActiveTaskFiltersSummary(filters, {
    showOverdueOnly,
    personName: selectedPerson?.name,
    projectName: selectedProject?.name,
    statusLabels,
  });

  const hasActiveState = Boolean(filterSummary || searchInput.trim());

  const handleStatusSidebarClick = (status: TaskStatusSidebarFilter) => {
    const nextStatus = filters.statusSidebar === status ? null : status;
    const nextFilters = { ...filters, statusSidebar: nextStatus, text: "" };
    onFiltersChange(nextFilters);
    setDraftFilters((prev) => ({ ...prev, statusSidebar: nextStatus }));
  };

  const handlePersonRoleChange = (personRole: TaskPersonRoleFilter) => {
    setDraftFilters((prev) => ({ ...prev, personRole }));
  };

  const handlePersonSelect = (userId: number | null) => {
    setDraftFilters((prev) => ({ ...prev, personUserId: userId }));
    setAssigneeOpen(false);
  };

  const handleApplySearch = () => {
    onFiltersChange({ ...draftFilters, text: "" });
    onSearchInputChange("");
    closePanel();
  };

  const handleSearchSubmit = () => {
    if (open && !isTyping) {
      handleApplySearch();
      return;
    }

    const query = searchInput.trim();
    if (query) {
      onSearchInputChange(query);
    }
    setSuggestionsDismissed(true);
    closePanel();
  };

  const handleReset = () => {
    setDraftFilters(DEFAULT_TASK_SEARCH_FILTERS);
    closePanel();
    onReset();
  };

  const handleSuggestionSelect = (suggestion: SearchSuggestion) => {
    setSuggestionsDismissed(true);
    if (suggestion.kind === "task") {
      onSearchInputChange(suggestion.label);
      onTaskSelect?.(suggestion.id);
      closePanel();
      return;
    }
    if (suggestion.kind === "user") {
      onFiltersChange({
        ...filters,
        personUserId: suggestion.id,
        personRole: filters.personRole === "all" ? "all" : filters.personRole,
        projectId: null,
        text: "",
      });
      onSearchInputChange("");
    } else {
      onFiltersChange({
        ...filters,
        projectId: suggestion.id,
        personUserId: null,
        text: "",
      });
      onSearchInputChange("");
    }
    closePanel();
  };

  const inputValue =
    filterSummary &&
    ((filters.personUserId != null &&
      searchInput.trim() === (selectedPerson?.name ?? "").trim()) ||
      (filters.projectId != null &&
        searchInput.trim() === (selectedProject?.name ?? "").trim()))
      ? ""
      : searchInput;

  return (
    <div ref={panelRef} className={cn("relative flex-1 min-w-[200px] max-w-md", className)}>
      <div className="relative flex items-center w-full h-9 pl-3 pr-9 bg-white border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-[#2563EB]/20 focus-within:border-[#2563EB]">
        {filterSummary && (
          <span className="text-sm text-[#1F2937] shrink-0 pointer-events-none select-none">
            {filterSummary}
            {inputValue ? <span className="text-gray-400"> · </span> : null}
          </span>
        )}
        <input
          type="text"
          placeholder={filterSummary ? "" : "Filter and search"}
          value={inputValue}
          onChange={(e) => handleSearchInputChange(e.target.value)}
          onFocus={openFilterPanel}
          onClick={() => {
            if (searchInput.trim()) onOpenChange(false);
            else openFilterPanel();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearchSubmit();
            }
            if (e.key === "Escape") closeOverlays();
          }}
          className="flex-1 min-w-0 h-full bg-transparent border-0 text-sm focus:outline-none cursor-pointer"
        />
      </div>
      {hasActiveState ? (
        <button
          type="button"
          onClick={handleReset}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Clear filters"
        >
          <X size={15} />
        </button>
      ) : (
        <button
          type="button"
          onClick={openFilterPanel}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#2563EB]"
          aria-label="Open filters"
        >
          <Search size={15} />
        </button>
      )}

      {showQuickSuggestions && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {suggestions.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSuggestionSelect(item)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50 text-left"
            >
              {item.kind === "user" && (
                <>
                  <UserAvatar name={item.label} avatar={item.avatar} size={22} />
                  <span className="truncate">{item.label}</span>
                </>
              )}
              {item.kind === "project" && (
                <>
                  <FolderKanban size={16} className="text-[#2563EB] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </>
              )}
              {item.kind === "task" && (
                <>
                  <ClipboardList size={16} className="text-gray-400 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {showFilterPanel && (
        <div
          className="absolute left-0 top-full mt-2 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden w-[min(520px,calc(100vw-2rem))]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex min-h-[300px]">
            <div className="w-[140px] shrink-0 border-r border-gray-100 bg-gray-50/80 flex flex-col">
              <div className="p-3 flex-1 space-y-1">
                {statusSidebarOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleStatusSidebarClick(option.id)}
                    className={`w-full text-left text-sm px-2 py-2 rounded-lg transition-colors ${
                      filters.statusSidebar === option.id
                        ? "bg-white text-[#2563EB] font-semibold shadow-sm"
                        : "text-gray-700 hover:bg-white/80 dark:hover:bg-[#ffffff0d]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 p-4 flex flex-col min-w-0">
              <div className="space-y-4 flex-1">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Role</label>
                  <FilterSelect
                    value={draftFilters.personRole}
                    onChange={(value) => handlePersonRoleChange(value as TaskPersonRoleFilter)}
                    options={TASK_PERSON_ROLE_OPTIONS.map((o) => ({
                      value: o.id,
                      label: o.label,
                    }))}
                    aria-label="Filter person role"
                    triggerClassName="h-9 w-full"
                    className="w-full"
                  />
                </div>

                <div className="relative">
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Assignee</label>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setAssigneeOpen((v) => !v)}
                    className="w-full h-9 text-sm border border-gray-200 rounded-lg px-3 bg-white text-left flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                  >
                    {draftPerson ? (
                      <>
                        <UserAvatar name={draftPerson.name} avatar={draftPerson.avatar} size={20} />
                        <span className="truncate text-gray-800">{draftPerson.name}</span>
                      </>
                    ) : (
                      <span className="text-gray-400">&nbsp;</span>
                    )}
                  </button>

                  {assigneeOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handlePersonSelect(null)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
                      >
                        <User size={16} className="text-gray-300" />
                        Any person
                      </button>
                      {users.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handlePersonSelect(u.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 ${
                            draftFilters.personUserId === u.id
                              ? "bg-blue-50 text-[#2563EB]"
                              : "text-gray-800"
                          }`}
                        >
                          <UserAvatar name={u.name} avatar={u.avatar} size={22} />
                          <span className="truncate">{u.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-sm text-gray-500 hover:text-gray-800"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleApplySearch}
                  className="h-9 px-4 bg-[#2563EB] text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[#1D4ED8]"
                >
                  <Search size={15} />
                  Search
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { DEFAULT_TASK_SEARCH_FILTERS };
