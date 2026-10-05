import { useState } from "react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { formatProjectActiveDate } from "@/lib/project-funnel";
import { FolderKanban, Loader2, Users } from "lucide-react";
import { resolveProjectIcon } from "@/lib/project-appearance";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, roleConfig } from "@/lib/utils";

export type ProjectFunnelMember = {
  id: number;
  name: string | null;
  avatar?: string | null;
  department?: string | null;
  position?: string | null;
  role?: string | null;
};

export type ProjectFunnelRow = {
  id: number;
  number?: number | null;
  name: string;
  color?: string | null;
  icon?: string | null;
  clientName?: string | null;
  status: string;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  taskCount: number;
  completedCount: number;
  performance?: number;
  lastActiveAt?: string | Date | null;
  members?: ProjectFunnelMember[];
  creator?: {
    id: number;
    name: string | null;
    avatar?: string | null;
    department?: string | null;
    position?: string | null;
  } | null;
  privacyType?: string;
};

function memberPositionLabel(member: ProjectFunnelMember) {
  const position = member.position?.trim();
  if (position) return position;
  const department = member.department?.trim();
  if (department) return department;
  const role = String(member.role ?? "").trim().toLowerCase();
  if (role && role in roleConfig) return roleConfig[role as keyof typeof roleConfig].label;
  return "—";
}

interface ProjectFunnelTableProps {
  projects: ProjectFunnelRow[];
  isLoading?: boolean;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onProjectClick: (id: number) => void;
  hideClientAgency?: boolean;
}

function ProjectIcon({
  color,
  icon,
}: {
  color?: string | null;
  icon?: string | null;
}) {
  const Icon = resolveProjectIcon(icon);
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
      style={{ backgroundColor: color ?? "#2563EB" }}
    >
      <Icon size={16} />
    </span>
  );
}

export function ProjectFunnelTable({
  projects,
  isLoading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onProjectClick,
  hideClientAgency = false,
}: ProjectFunnelTableProps) {
  const [membersProject, setMembersProject] = useState<ProjectFunnelRow | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 bg-white border border-gray-200 rounded-xl">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const allSelected = projects.length > 0 && projects.every((p) => selectedIds.has(p.id));

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/90 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-[#1a2336] dark:text-gray-300 dark:border-[#2d3a4f]">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]/30"
                  aria-label="Select all projects"
                />
              </th>
              <th className="px-3 py-3 w-16">ID</th>
              <th className="px-3 py-3 min-w-[280px]">Name</th>
              <th className="px-3 py-3 min-w-[120px]">Created by</th>
              <th className="px-3 py-3 min-w-[200px]">Active</th>
              <th className="px-3 py-3 min-w-[140px]">Joined Members</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, index) => (
                <motion.tr key={project.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }} onClick={() => onProjectClick(project.id)} className="border-b border-black-50 hover:bg-gray-50/80 cursor-pointer transition-colors">
                  <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(project.id)} onChange={() => onToggleSelect(project.id)} className="h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]/30" aria-label={`Select ${project.name}`}/>
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-500 tabular-nums">{project.number ?? project.id}</td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProjectIcon color={project.color} icon={project.icon} />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-[#1F2937] truncate">
                          {project.name}
                        </span>
                        {!hideClientAgency && project.clientName?.trim() ? (
                          <span className="text-sm text-gray-500 truncate">
                            {" "}· {project.clientName.trim()}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-600 truncate">
                    {project.creator?.name ?? "—"}
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-600">
                    {formatProjectActiveDate(project.lastActiveAt ?? null)}
                  </td>
                  <td
                    className="px-3 py-3.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMembersProject(project);
                    }}
                  >
                    <button
                      type="button"
                      className={cn(
                        "flex max-w-full items-center rounded-lg -mx-1 px-1 py-0.5 text-left hover:bg-gray-100",
                        (project.members ?? []).length === 0 && "cursor-default",
                      )}
                      aria-label={`View members of ${project.name}`}
                      title="View joined members"
                    >
                      <div className="flex items-center -space-x-2">
                        {(project.members ?? []).length > 0 ? (
                          project.members!.slice(0, 4).map((member) => (
                            <UserAvatar
                              key={member.id}
                              name={member.name}
                              avatar={member.avatar}
                              size={28}
                              className="ring-2 ring-white"
                            />
                          ))
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                            <Users size={14} />
                            No members
                          </span>
                        )}
                        {(project.members?.length ?? 0) > 4 && (
                          <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-600 ring-2 ring-white">
                            +{(project.members?.length ?? 0) - 4}
                          </span>
                        )}
                      </div>
                    </button>
                  </td>
                </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {projects.length === 0 && (
        <div className="py-16 text-center">
          <FolderKanban size={36} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No projects found</p>
        </div>
      )}

      <Dialog
        open={membersProject != null}
        onOpenChange={(open) => {
          if (!open) setMembersProject(null);
        }}
      >
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 pr-12 border-b border-gray-100">
            <DialogTitle>Joined members</DialogTitle>
            <p className="text-sm text-gray-500 truncate">
              {membersProject?.name}
              {membersProject?.clientName?.trim()
                ? ` · ${membersProject.clientName.trim()}`
                : ""}
            </p>
          </DialogHeader>
          <div className="max-h-[min(24rem,70vh)] overflow-y-auto p-2">
            {(membersProject?.members ?? []).length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-gray-500">
                No members have joined this project yet.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {(membersProject?.members ?? []).map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                  >
                    <UserAvatar
                      name={member.name}
                      avatar={member.avatar}
                      size={36}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#1F2937]">
                        {member.name || "Unnamed"}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {memberPositionLabel(member)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
