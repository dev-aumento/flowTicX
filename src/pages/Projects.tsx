import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/lib/permissions";
import { canCreateProject } from "@/lib/create-project-permission";
import { isClientPortalUser } from "@/lib/client-portal";
import { ProjectFunnelTable } from "@/components/projects/ProjectFunnelTable";
import { ProjectFormFields } from "@/components/projects/ProjectFormFields";
import { ListPaginationControls } from "@/components/shared/ListPaginationControls";
import { FilterSelect } from "@/components/shared/FilterSelect";
import { LIST_PAGE_SIZE, paginateItems } from "@/lib/list-pagination";
import {
  applyProjectListFilters,
  loadProjectsListState,
  PROJECT_SEARCH_FIELD_OPTIONS,
  PROJECT_SORT_OPTIONS,
  saveProjectsListState,
  type ProjectSearchField,
  type ProjectSortOption,
} from "@/lib/project-list-filters";
import {
  collectClientNameSuggestions,
  EMPTY_PROJECT_FORM,
  type ProjectFormValues,
} from "@/lib/project-appearance";
import { Plus, X, Loader2, Search, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router";
import { ModalBackdrop } from "@/components/shared/ModalBackdrop";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Projects() {
  return <ProjectsWebPage />;
}

function ProjectsWebPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [listState] = useState(() => loadProjectsListState());
  const [search, setSearch] = useState(listState.search);
  const [searchField, setSearchField] = useState<ProjectSearchField>(listState.searchField);
  const [sortBy, setSortBy] = useState<ProjectSortOption>(listState.sortBy);
  const [agencyFilter, setAgencyFilter] = useState(listState.agencyFilter);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formData, setFormData] = useState<ProjectFormValues>(EMPTY_PROJECT_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [page, setPage] = useState(listState.page);
  const skipPageResetOnMount = useRef(true);

  const { data: projects, isLoading } = trpc.project.list.useQuery();
  const utils = trpc.useUtils();

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (project) => {
      utils.project.list.invalidate();
      utils.project.listForPicker.invalidate();
      setShowCreate(false);
      setCreateError(null);
      setFormData(EMPTY_PROJECT_FORM);
      if (project?.id) navigate(`/projects/${project.id}`);
    },
    onError: (error) => {
      setCreateError(error.message || "Could not create project.");
    },
  });

  const deleteProjectMutation = trpc.project.delete.useMutation();

  const canCreate = canCreateProject(user);
  const canDelete = hasPermission(user, "projects.manage");

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;

    if (canCreate) {
      setCreateError(null);
      setFormData(EMPTY_PROJECT_FORM);
      setShowCreate(true);
    }

    setSearchParams(
      (prev) => {
        if (!prev.has("create")) return prev;
        const next = new URLSearchParams(prev);
        next.delete("create");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, canCreate, setSearchParams]);
  const clientPortal = isClientPortalUser(user);

  useEffect(() => {
    if (!clientPortal) return;
    if (searchField === "client") setSearchField("name");
    if (sortBy.startsWith("client-")) setSortBy("name-asc");
    if (agencyFilter) setAgencyFilter("");
  }, [agencyFilter, clientPortal, searchField, sortBy]);

  const clientNameSuggestions = useMemo(
    () => collectClientNameSuggestions(projects ?? []),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    return applyProjectListFilters(projects, {
      search,
      searchField,
      sort: sortBy,
      agencyFilter,
    });
  }, [projects, search, searchField, sortBy, agencyFilter]);

  const projectPagination = useMemo(
    () => paginateItems(filteredProjects, page, LIST_PAGE_SIZE),
    [filteredProjects, page],
  );

  useEffect(() => {
    if (skipPageResetOnMount.current) {
      skipPageResetOnMount.current = false;
      return;
    }
    setPage(1);
  }, [search, searchField, sortBy, agencyFilter]);

  useEffect(() => {
    if (page > projectPagination.totalPages) {
      setPage(projectPagination.totalPages);
    }
  }, [page, projectPagination.totalPages]);

  useEffect(() => {
    saveProjectsListState({
      search,
      searchField,
      sortBy,
      agencyFilter,
      page,
    });
  }, [search, searchField, sortBy, agencyFilter, page]);

  const paginatedProjects = projectPagination.items;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!paginatedProjects.length) return;
    const allSelected = paginatedProjects.every((p) => selectedIds.has(p.id));
    setSelectedIds(allSelected ? new Set() : new Set(paginatedProjects.map((p) => p.id)));
  };

  const selectedProjects = useMemo(
    () => filteredProjects.filter((p) => selectedIds.has(p.id)),
    [filteredProjects, selectedIds],
  );

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      for (const id of selectedIds) {
        await deleteProjectMutation.mutateAsync({ id });
      }
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      await utils.project.list.invalidate();
      await utils.task.list.invalidate();
    } catch (error) {
      console.error("Failed to delete projects:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const searchPlaceholder =
    PROJECT_SEARCH_FIELD_OPTIONS.find((option) => option.value === searchField)?.placeholder ??
    "Search projects...";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      {isClientPortalUser(user) ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-[#1E1F21] dark:text-white">
              Projects
            </h1>
            <p className="text-sm text-[#6D6E6F] mt-1">
              {filteredProjects.length} project{filteredProjects.length === 1 ? "" : "s"}
              {filteredProjects.length > LIST_PAGE_SIZE
                ? ` · page ${projectPagination.page} of ${projectPagination.totalPages}`
                : ""}
            </p>
          </div>
          {canCreate ? (
            <button
              type="button"
              onClick={() => {
                setCreateError(null);
                setShowCreate(true);
              }}
              className="h-9 px-3.5 bg-[#F06A6A] text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[#E45C5C]"
            >
              <Plus size={16} /> New project
            </button>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl portal-slate-gradient px-6 py-5 text-white shadow-md overflow-hidden relative">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_white,_transparent_55%)]" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-4 items-center">
              <h1 className="text-2xl font-bold">Projects</h1>
              <p className="text-sm text-blue-100 mt-1">
                {filteredProjects.length} project{filteredProjects.length === 1 ? "" : "s"}
                {filteredProjects.length > LIST_PAGE_SIZE
                  ? ` · page ${projectPagination.page} of ${projectPagination.totalPages}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null);
                    setShowCreate(true);
                  }}
                  className="h-10 px-4 bg-white text-[#2563EB] rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-blue-50 transition-colors"
                >
                  <Plus size={16} /> Create
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-[#2563EB]/20 focus-within:border-[#2563EB]">
            <FilterSelect
              value={searchField}
              onChange={(value) => setSearchField(value as ProjectSearchField)}
              options={(clientPortal
                ? PROJECT_SEARCH_FIELD_OPTIONS.filter((option) => option.value !== "client")
                : PROJECT_SEARCH_FIELD_OPTIONS
              ).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              aria-label="Search field"
              triggerClassName="h-10 shrink-0 rounded-none border-0 border-r border-gray-200 bg-gray-50 px-3 focus:ring-0 focus:border-gray-200 hover:bg-gray-100 min-w-[7.5rem]"
              contentClassName="min-w-[10rem]"
            />
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full h-10 pl-9 pr-4 bg-white border-0 text-sm focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={sortBy}
              onChange={(value) => setSortBy(value as ProjectSortOption)}
              options={(clientPortal
                ? PROJECT_SORT_OPTIONS.filter((option) => !option.value.startsWith("client-"))
                : PROJECT_SORT_OPTIONS
              ).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              aria-label="Sort Projects"
              className="min-w-[10.5rem]"
            />

            {clientPortal ? null : (
            <FilterSelect value={agencyFilter} onChange={setAgencyFilter}
              options={[
                { value: "", label: "All Clients / Agencies" },
                ...clientNameSuggestions.map((name) => ({ value: name, label: name })),
              ]} aria-label="Filter by client or agency" className="min-w-[11.5rem]" align="end"/>
            )}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500">
              {selectedIds.size} selected
            </span>
            {canDelete ? (
              <button type="button" onClick={() => setShowDeleteConfirm(true)} disabled={isDeleting} className="h-9 px-3 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                <Trash2 size={14} />
                Delete
              </button>
            ) : null}
            <button type="button" onClick={() => setSelectedIds(new Set())} disabled={isDeleting} className="h-9 px-3 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50">
              Clear
            </button>
          </div>
        )}
      </div>

      <ProjectFunnelTable
        projects={paginatedProjects}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onProjectClick={(id) => navigate(`/projects/${id}`)}
        hideClientAgency={clientPortal}
      />

      <ListPaginationControls
        page={projectPagination.page}
        totalPages={projectPagination.totalPages}
        totalItems={projectPagination.totalItems}
        startIndex={projectPagination.startIndex}
        endIndex={projectPagination.endIndex}
        onPageChange={setPage}
      />

      <ModalBackdrop
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setCreateError(null);
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-[#1F2937]">Create Project</h2>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setCreateError(null);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!formData.name.trim()) return;
              setCreateError(null);
              createMutation.mutate({
                name: formData.name,
                description: formData.description || undefined,
                clientName: clientPortal ? undefined : formData.clientName || undefined,
                color: formData.color,
                icon: formData.icon,
              });
            }}
            className="p-5 space-y-4"
          >
            {createError ? (
              <p className="text-sm text-red-500">{createError}</p>
            ) : null}
            <ProjectFormFields
              value={formData}
              onChange={setFormData}
              clientNameSuggestions={clientNameSuggestions}
              idPrefix="create-project"
              hideClientAgency={clientPortal}
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setCreateError(null);
                }}
                className="h-10 px-4 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="h-10 px-4 bg-[#2563EB] text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Create Project
              </button>
            </div>
          </form>
        </motion.div>
      </ModalBackdrop>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} project{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              {selectedProjects.length === 1
                ? `"${selectedProjects[0]?.name}"`
                : `${selectedProjects.length} projects`}
              {" "}and all of their tasks. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteSelected();
              }}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
