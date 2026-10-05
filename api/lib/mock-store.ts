import { DEV_USER } from "./dev-mode";
import { noticePeriodEndsAt } from "@/lib/notice-period";
import type { UserDoc } from "@db/mongo/types";
import {
  countCompletedTasks,
  countTodoTasks,
} from "./dashboard-task-stats";
import type { SafeUser } from "../queries/users";
import { buildTimeStatsSummary, localDateKey, startOfCalendarWeek, periodClockInBounds, dayBounds, roundHours, attendanceEntrySeconds, getAutoClockOutDeadline, isPastAutoClockOutDeadline, computeAttendanceWorkSeconds, resolveAttendanceDisplaySeconds, filterMeaningfulAttendanceEntries, sumBreakSecondsInWindow } from "@/lib/work-hours-policy";
import { buildLeaveCoverageMap, eachLeaveDateKey, isAdminOrManagement, isAttendanceTrackableUser, isWeekdayDateKey } from "@/lib/leave-policy";
import {
  projectPerformancePercent,
} from "@/lib/project-funnel";
import { legacyStatusToStage, createPipelineStageKey, nextCustomStageColor, resolveProjectPipelineStages, isPipelineStageDeletable, isCustomPipelineStageKey, movePipelineStageOrder, isMarkingTaskComplete } from "@/lib/task-kanban";
import { taskMatchesUnifiedSearch } from "@/lib/unified-search";
import { extractTaskTags } from "@/lib/task-tags";
import { extractMentionedUserIds, formatCommentPreview } from "@/lib/task-comment-mentions";
import { extractMentionedUserIdsFromComment, richCommentPlainText } from "@/lib/rich-comment";
import { readCommentReactions, toggleUserReaction } from "@/lib/comment-reactions";
import { formatWorkZoneTime, startOfWorkZoneDay, workZoneWallTimeToUtc, calendarYmdToUtcNoon, parseIsoDateOnly } from "@/lib/timezone";
import { defaultTaskDeadlineIso } from "@/lib/task-deadline";
import { personalizeNotificationCopy } from "@/lib/viewer-second-person";
import { staffTimerMatchesExcludedRoles } from "@/lib/department-options";
import { normalizeCurrencyCode, timeEntrySecondsInRange, type InvoiceCurrencyCode } from "@/lib/invoice-store";
import {
  assignedTaskStatusCountRows,
  mergeTaskStatusLabels,
  type TaskStatusLabels,
} from "@/lib/task-status-labels";
import {
  buildDaySnapshotsFromEntries,
  calendarMonthBounds,
  classifyMonthAttendance,
} from "@/lib/month-attendance";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function atDayTime(daysBack: number, hours: number, minutes: number) {
  const d = daysAgo(daysBack);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

let mockOrgBaseCurrency: InvoiceCurrencyCode = "INR";

export function mockGetOrgCurrency() {
  return mockOrgBaseCurrency;
}

export function mockSetOrgCurrency(currency?: string | null) {
  mockOrgBaseCurrency = normalizeCurrencyCode(currency);
}

let mockTaskStatusLabels: Partial<TaskStatusLabels> | null = null;

export function mockGetTaskStatusLabels() {
  return mockTaskStatusLabels;
}

export function mockSetTaskStatusLabels(labels?: Partial<TaskStatusLabels> | null) {
  mockTaskStatusLabels = labels ? { ...labels } : null;
}

let mockPipelineStageLabelOverrides: Record<string, string> | null = null;

export function mockGetPipelineStageLabels() {
  return mockPipelineStageLabelOverrides;
}

export function mockSetPipelineStageLabels(labels?: Record<string, string> | null) {
  mockPipelineStageLabelOverrides = labels ? { ...labels } : null;
}

function resolveMockPipelineStages(
  project?: Parameters<typeof resolveProjectPipelineStages>[0],
) {
  return resolveProjectPipelineStages(project, mockGetPipelineStageLabels());
}

const users: SafeUser[] = [
  DEV_USER,
  {
    id: 2,
    unionId: "manager_union_001",
    organizationId: 1,
    name: "Sarah Chen",
    email: "sarah@aumento.io",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
    role: "manager",
    status: "active",
    department: "Engineering",
    position: "Engineering Lead",
    phone: "+1-555-0102",
    firstName: "Sarah",
    lastName: "Chen",
    secondName: null,
    dateOfBirth: null,
    dateOfJoining: null,
    sex: null,
    city: null,
    address: null,
    familyContactNumber: null,
    personalEmail: null,
    bloodGroup: null,
    aadhaarCard: null,
    panCard: null,
    notificationLanguage: "en",
    employmentType: "full_time",
    onNoticePeriod: false,
    headOfDepartmentUserIds: [],
    permissions: [],
    createdAt: daysAgo(90),
    updatedAt: daysAgo(1),
    lastSignInAt: daysAgo(0),
  },
  {
    id: 4,
    unionId: "emp_union_001",
    organizationId: 1,
    name: "Emily Rodriguez",
    email: "emily@aumento.io",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Emily",
    role: "employee",
    status: "active",
    department: "Engineering",
    position: "Frontend Developer",
    phone: "+1-555-0104",
    firstName: "Emily",
    lastName: "Rodriguez",
    secondName: null,
    dateOfBirth: null,
    dateOfJoining: null,
    sex: null,
    city: null,
    address: null,
    familyContactNumber: null,
    personalEmail: null,
    bloodGroup: null,
    aadhaarCard: null,
    panCard: null,
    notificationLanguage: "en",
    employmentType: "full_time",
    onNoticePeriod: false,
    headOfDepartmentUserIds: [],
    permissions: [],
    createdAt: daysAgo(60),
    updatedAt: daysAgo(2),
    lastSignInAt: daysAgo(0),
  },
];

function userById(id: number) {
  return users.find((u) => u.id === id) ?? null;
}

const passwordHashByUserId = new Map<number, string>();
let memoryOrganizationName = "Aaso";

function nextUserId() {
  return users.reduce((max, user) => Math.max(max, user.id), 0) + 1;
}

function splitRegisteredName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null as string | null, lastName: null as string | null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null as string | null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function mockGetOrganizationName() {
  return memoryOrganizationName;
}

export function mockSetOrganizationName(name: string) {
  const trimmed = name.trim();
  if (trimmed) memoryOrganizationName = trimmed;
  return memoryOrganizationName;
}

export function mockFindUserById(id: number): UserDoc | null {
  const user = userById(id);
  if (!user) return null;
  return {
    ...user,
    passwordHash: passwordHashByUserId.get(id) ?? null,
    privateNotes: privateNotesByUserId[id] ?? null,
  };
}

export function mockFindUsersByEmail(email: string): UserDoc[] {
  const normalized = email.trim().toLowerCase();
  return users
    .filter((entry) => entry.email?.toLowerCase() === normalized)
    .map((entry) => mockFindUserById(entry.id))
    .filter((entry): entry is UserDoc => entry != null);
}

export function mockFindUserByEmail(email: string): UserDoc | null {
  return mockFindUsersByEmail(email)[0] ?? null;
}

export function mockHasUserWithRole(role: UserDoc["role"]) {
  return users.some((entry) => entry.role === role);
}

export function mockUpdateLastSignIn(userId: number) {
  const user = userById(userId);
  if (!user) return;
  user.lastSignInAt = new Date();
  user.updatedAt = new Date();
}

export function mockSetPasswordHash(userId: number, passwordHash: string) {
  const user = userById(userId);
  if (!user) return false;
  passwordHashByUserId.set(userId, passwordHash);
  user.updatedAt = new Date();
  return true;
}

export function mockCreateRegisteredUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  role: SafeUser["role"];
  organizationName: string;
  department: string | null;
  position: string | null;
  permissions: string[];
}): UserDoc {
  mockSetOrganizationName(input.organizationName);
  const now = new Date();
  const id = nextUserId();
  const { firstName, lastName } = splitRegisteredName(input.name);
  const user: SafeUser = {
    id,
    unionId: `${input.role}_${id}`,
    organizationId: 1,
    name: input.name.trim(),
    email: input.email,
    avatar: null,
    role: input.role,
    status: "active",
    department: input.department,
    position: input.position,
    phone: null,
    firstName,
    lastName,
    secondName: null,
    dateOfBirth: null,
    dateOfJoining: now,
    sex: null,
    city: null,
    address: null,
    familyContactNumber: null,
    personalEmail: null,
    bloodGroup: null,
    aadhaarCard: null,
    panCard: null,
    notificationLanguage: "en",
    employmentType: "full_time",
    onNoticePeriod: false,
    headOfDepartmentUserIds: [],
    permissions: [...input.permissions],
    sortOrder: id,
    createdAt: now,
    updatedAt: now,
    lastSignInAt: now,
  };
  users.push(user);
  passwordHashByUserId.set(id, input.passwordHash);
  return mockFindUserById(id)!;
}

/** Owner-only notes kept separate from SafeUser so admin APIs never see them. */
const privateNotesByUserId: Record<number, string | null> = {};

const projects = [
  {
    id: 1,
    name: "Website Redesign",
    description: "Complete overhaul of the company website with modern design.",
    status: "active" as const,
    color: "#2563EB",
    icon: "folder-kanban",
    clientName: "Aumento Infoway",
    createdBy: 1,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(2),
    taskCount: 4,
    completedCount: 1,
    creator: DEV_USER,
  },
  {
    id: 2,
    name: "Mobile App v2",
    description: "Second version of the mobile app with offline support.",
    status: "active" as const,
    color: "#3B82F6",
    icon: "rocket",
    clientName: "Mobile Labs",
    createdBy: 2,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(1),
    taskCount: 2,
    completedCount: 0,
    creator: users[1],
  },
  {
    id: 3,
    name: "AGPL Website Refresh",
    description: "Refresh public website content and branding for AGPL.",
    status: "active" as const,
    color: "#10B981",
    icon: "globe",
    clientName: "AGPL",
    createdBy: 1,
    createdAt: daysAgo(45),
    updatedAt: daysAgo(0),
    taskCount: 0,
    completedCount: 0,
    creator: DEV_USER,
  },
  {
    id: 4,
    name: "AI — CyperX",
    description: "AI integration and automation for CyperX platform.",
    status: "active" as const,
    color: "#8B5CF6",
    icon: "laptop",
    clientName: "CyperX",
    createdBy: 2,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(3),
    taskCount: 0,
    completedCount: 0,
    creator: users[1],
  },
  {
    id: 5,
    name: "Client Portal v3",
    description: "Self-service portal for enterprise clients.",
    status: "active" as const,
    color: "#F59E0B",
    icon: "building-2",
    clientName: "Enterprise Clients",
    createdBy: 1,
    createdAt: daysAgo(15),
    updatedAt: daysAgo(5),
    taskCount: 0,
    completedCount: 0,
    creator: DEV_USER,
  },
  {
    id: 6,
    name: "Internal HR Tools",
    description: "HR onboarding and leave management modules.",
    status: "archived" as const,
    color: "#6B7280",
    icon: "users",
    clientName: "Internal",
    createdBy: 2,
    createdAt: daysAgo(120),
    updatedAt: daysAgo(30),
    taskCount: 0,
    completedCount: 0,
    creator: users[1],
  },
];

const projectMemberKeys = new Set<string>();

function mockMemberKey(projectId: number, userId: number) {
  return `${projectId}:${userId}`;
}

function mockIsProjectMember(
  projectId: number,
  userId: number,
  createdBy?: number | null,
) {
  if (createdBy != null && createdBy === userId) return true;
  return projectMemberKeys.has(mockMemberKey(projectId, userId));
}

function mockCanViewProjectTasks(
  user: SafeUser,
  projectCreatedBy: number | null | undefined,
  joined: boolean,
) {
  if (user.role === "admin" || user.role === "manager") return true;

  if (user.role === "employee") {
    if (projectCreatedBy != null && projectCreatedBy === user.id) return true;
    return joined;
  }

  if (user.permissions?.includes("projects.manage")) return true;
  if (user.permissions?.includes("tasks.view_all")) return true;
  if (projectCreatedBy != null && projectCreatedBy === user.id) return true;
  return joined;
}

const tasks = [
  {
    id: 1,
    title: "Design homepage hero section",
    description: "Create wireframes and high-fidelity mockups for the new homepage hero.",
    status: "in_progress" as const,
    stage: "in_designing" as const,
    priority: "high" as const,
    assigneeId: 1,
    projectId: 1,
    createdBy: 2,
    dueDate: daysFromNow(-5),
    estimatedHours: "8.00",
    actualHours: "3.50",
    position: 0,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    assignee: DEV_USER,
  },
  {
    id: 2,
    title: "Implement authentication flow",
    description: "Add login, logout, and session handling.",
    status: "review" as const,
    stage: "in_qa_1st_round" as const,
    priority: "urgent" as const,
    assigneeId: 1,
    projectId: 2,
    createdBy: 1,
    dueDate: daysFromNow(0),
    estimatedHours: "12.00",
    actualHours: "10.00",
    position: 1,
    createdAt: daysAgo(14),
    updatedAt: daysAgo(0),
    assignee: DEV_USER,
  },
  {
    id: 3,
    title: "Write API documentation",
    description: "Document all REST and tRPC endpoints for the team.",
    status: "todo" as const,
    stage: "new" as const,
    priority: "medium" as const,
    assigneeId: 1,
    projectId: 1,
    createdBy: 2,
    dueDate: daysFromNow(3),
    estimatedHours: "6.00",
    actualHours: "0.00",
    position: 2,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    assignee: DEV_USER,
  },
  {
    id: 4,
    title: "Set up CI/CD pipeline",
    description: "Configure GitHub Actions for automated testing and deployment.",
    status: "done" as const,
    stage: "finished" as const,
    priority: "low" as const,
    assigneeId: 1,
    projectId: 1,
    createdBy: 1,
    dueDate: daysFromNow(-3),
    estimatedHours: "4.00",
    actualHours: "4.00",
    position: 3,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(3),
    assignee: DEV_USER,
  },
  {
    id: 5,
    title: "User research interviews",
    description: "Conduct 5 user interviews for the mobile app redesign.",
    status: "in_progress" as const,
    stage: "in_developing" as const,
    priority: "medium" as const,
    assigneeId: 4,
    projectId: 2,
    createdBy: 2,
    dueDate: daysFromNow(7),
    estimatedHours: "10.00",
    actualHours: "2.00",
    position: 4,
    createdAt: daysAgo(7),
    updatedAt: daysAgo(2),
    assignee: users[2],
  },
  {
    id: 6,
    title: "Update brand guidelines",
    description: "Refresh color palette and typography docs.",
    status: "todo" as const,
    stage: "backlog" as const,
    priority: "low" as const,
    assigneeId: 1,
    projectId: 1,
    createdBy: 1,
    dueDate: null,
    estimatedHours: "4.00",
    actualHours: "0.00",
    position: 5,
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
    assignee: DEV_USER,
  },
  {
    id: 7,
    title: "Q4 planning workshop",
    description: "Schedule and prepare materials for quarterly planning.",
    status: "todo" as const,
    stage: "client_1st_round" as const,
    priority: "medium" as const,
    assigneeId: 1,
    projectId: 2,
    createdBy: 2,
    dueDate: daysFromNow(21),
    estimatedHours: "8.00",
    actualHours: "1.50",
    position: 6,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
    assignee: DEV_USER,
  },
];

const notifications = [
  {
    id: 1,
    userId: 1,
    taskId: 1,
    type: "task_assigned" as const,
    title: "Assigned to you",
    message: "Sarah Chen assigned you to Design homepage hero section",
    read: false,
    link: "/tasks?task=1",
    createdAt: daysAgo(1),
  },
  {
    id: 2,
    userId: 1,
    taskId: 2,
    type: "task_updated" as const,
    title: "Task moved to review",
    message: "Implement authentication flow is ready for review",
    read: false,
    link: "/tasks?task=2",
    createdAt: daysAgo(0),
  },
  {
    id: 3,
    userId: 1,
    taskId: 1,
    type: "mention" as const,
    title: "New comment on task",
    message: "Sarah Chen: Can we try a bolder hero layout?",
    read: false,
    link: "/tasks?task=1&view=chats",
    createdAt: daysAgo(0),
  },
  {
    id: 4,
    userId: 1,
    taskId: 2,
    type: "mention" as const,
    title: "New comment on task",
    message: "Emily Rodriguez: Auth flow looks good, minor tweaks needed",
    read: false,
    link: "/tasks?task=2&view=chats",
    createdAt: daysAgo(0),
  },
  {
    id: 5,
    userId: 1,
    taskId: 3,
    type: "deadline_reminder" as const,
    title: "Task chat update",
    message: "New activity on Write API documentation",
    read: false,
    link: "/tasks?task=3&view=chats",
    createdAt: daysAgo(0),
  },
  {
    id: 6,
    userId: 1,
    taskId: 7,
    type: "task_updated" as const,
    title: "Task chat update",
    message: "Planning workshop materials were uploaded",
    read: false,
    link: "/tasks?task=7&view=chats",
    createdAt: daysAgo(1),
  },
  {
    id: 7,
    userId: 1,
    type: "task_updated" as const,
    title: "Weekly summary",
    message: "You completed 3 tasks this week. Great work!",
    read: true,
    link: "/",
    createdAt: daysAgo(2),
  },
];

export function mockDashboardStats(userId: number, role?: string) {
  const isAdminOrManager = role === "admin" || role === "manager";
  const scopedTasks = isAdminOrManager
    ? tasks
    : tasks.filter((t) => t.assigneeId === userId);
  const ongoing = countTodoTasks(scopedTasks);
  const completed = countCompletedTasks(scopedTasks);
  const startOfToday = startOfWorkZoneDay();
  const todayMinutes = allUserTimeEntries(userId)
    .filter((e) => e.clockOut && e.clockIn >= startOfToday)
    .reduce((sum, e) => sum + (e.duration ?? 0), 0);

  return {
    ongoingTasks: ongoing,
    completedTasks: completed,
    hoursTracked: Math.round((todayMinutes / 60) * 10) / 10,
  };
}

export function mockRecentTasks(userId: number, limit = 10) {
  return tasks
    .filter((t) => t.assigneeId === userId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
}

export function mockWeeklyActivity() {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({
    day,
    completed: [2, 1, 3, 0, 2, 1, 0][i],
    created: [1, 2, 1, 2, 0, 1, 0][i],
  }));
}

export function mockWorkload() {
  const weekStart = startOfCalendarWeek();
  return users
    .filter((user) => String(user.role ?? "").toLowerCase() !== "admin")
    .map((user) => {
    const totalMinutes = allUserTimeEntries(user.id)
      .filter((e) => e.clockOut && new Date(e.clockIn) >= weekStart)
      .reduce((sum, e) => sum + (e.duration ?? 0), 0);
    return {
      userId: user.id,
      name: user.name || "Unknown",
      avatar: user.avatar,
      role: user.role,
      taskCount: tasks.filter((t) => t.assigneeId === user.id && t.status === "in_progress").length,
      hoursLogged: Math.round((totalMinutes / 60) * 10) / 10,
    };
  });
}

/** All tasks on a project for invoice auto-fill (no membership gate). */
export function mockInvoiceProjectTaskLines(projectId: number) {
  return [...tasks]
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => (a.position - b.position) || (a.id - b.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      actualHours: t.actualHours,
      estimatedHours: t.estimatedHours,
    }));
}

/** Completed time entries plus any still-running / paused timer on the task. */
export function mockInvoiceTrackedSeconds(
  taskId: number,
  range?: { start: Date; end: Date } | null,
  excludeDepartments?: string[] | null,
) {
  const now = new Date();
  const excluded = excludeDepartments ?? [];
  let seconds = 0;
  for (const entry of taskTimeEntries[taskId] ?? []) {
    if (staffTimerMatchesExcludedRoles(entry.user, excluded)) continue;
    if (range) {
      seconds += timeEntrySecondsInRange(entry, range.start, range.end, now);
    } else {
      const durationSeconds =
        entry.clockIn && entry.clockOut
          ? Math.max(0, Math.floor((entry.clockOut.getTime() - entry.clockIn.getTime()) / 1000))
          : (entry.duration ?? 0) * 60;
      seconds += durationSeconds;
    }
  }
  for (const active of Object.values(activeTaskTimers)) {
    if (active.taskId !== taskId) continue;
    if (staffTimerMatchesExcludedRoles(userById(active.userId), excluded)) continue;
    if (range) {
      seconds += timeEntrySecondsInRange(
        { clockIn: active.clockIn, clockOut: null },
        range.start,
        range.end,
        now,
      );
    } else {
      seconds += timerElapsedSeconds(active);
    }
  }
  return seconds;
}

export function mockTaskList(
  input?: {
    status?: string;
    priority?: string;
    assigneeId?: number;
    projectId?: number | null;
    search?: string;
    page?: number;
    limit?: number;
    clientAssignedToStaff?: boolean;
  },
  currentUser?: SafeUser,
) {
  let result = [...tasks];
  if (input?.status) result = result.filter((t) => t.status === input.status);
  if (input?.priority) result = result.filter((t) => t.priority === input.priority);
  if (input?.assigneeId) result = result.filter((t) => t.assigneeId === input.assigneeId);
  if (input?.clientAssignedToStaff) {
    const clientIds = new Set(
      users.filter((u) => String(u.role).toLowerCase() === "client").map((u) => u.id),
    );
    const staffIds = new Set(
      users.filter((u) => u.role !== "client" && u.role !== "platform").map((u) => u.id),
    );
    const originatedByClient = new Set<number>();
    for (const list of Object.values(taskActivities)) {
      for (const activity of list) {
        if (
          activity.action === "created" &&
          activity.userId != null &&
          clientIds.has(activity.userId)
        ) {
          originatedByClient.add(activity.taskId);
        }
      }
    }
    result = result.filter(
      (t) =>
        (t.assigneeId == null || staffIds.has(t.assigneeId) || clientIds.has(t.assigneeId)) &&
        ((t.createdBy != null && clientIds.has(t.createdBy)) || originatedByClient.has(t.id)),
    );
  } else if (
    currentUser?.role === "client" &&
    !(currentUser.permissions ?? []).includes("tasks.view_all")
  ) {
    result = result.filter(
      (t) => t.createdBy === currentUser.id || t.assigneeId === currentUser.id,
    );
  }
  if (input?.projectId) {
    const project = projects.find((p) => p.id === input.projectId);
    const user = currentUser ?? DEV_USER;
    const joined = project
      ? mockIsProjectMember(project.id, user.id, project.createdBy)
      : false;
    if (project && !mockCanViewProjectTasks(user, project.createdBy, joined)) {
      return { tasks: [], total: 0 };
    }
    result = result.filter((t) => t.projectId === input.projectId);
  }
  if (input?.search) {
    const ctx = {
      users,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
    };
    result = result.filter((t) => taskMatchesUnifiedSearch(t, input.search!, ctx));
  }
  const limit = input?.limit ?? 50;
  return {
    tasks: result.slice(0, limit).map((t) => {
      const project = t.projectId ? projects.find((p) => p.id === t.projectId) : null;
      const subs = taskSubtasks[t.id] ?? [];
      return {
        ...t,
        creator: t.createdBy ? userById(t.createdBy) ?? null : null,
        project: project
          ? { id: project.id, name: project.name, color: project.color }
          : null,
        participantIds: (taskParticipants[t.id] ?? []).map((p) => p.id),
        observerIds: (taskObservers[t.id] ?? []).map((p) => p.id),
        tags: extractTaskTags(t).length ? extractTaskTags(t) : (MOCK_TASK_TAGS[t.id] ?? []),
        subtaskCount: subs.length,
        completedSubtaskCount: subs.filter((s) => s.completed).length,
      };
    }),
    total: result.length,
  };
}

const taskParticipants: Record<number, SafeUser[]> = {
  1: [],
  2: [users[1], users[2]],
};

const taskObservers: Record<number, SafeUser[]> = {
  1: [users[1]!],
  5: [DEV_USER],
};

const MOCK_TASK_TAGS: Record<number, string[]> = {
  1: ["Design", "Shopify"],
  2: ["QA", "Auth"],
  3: ["Docs"],
  4: ["DevOps"],
};

const taskSubtasks: Record<number, Array<{
  id: number;
  taskId: number;
  title: string;
  completed: boolean;
  position: number;
  createdAt: Date;
}>> = {
  1: [
    { id: 1, taskId: 1, title: "Research competitors", completed: true, position: 0, createdAt: daysAgo(8) },
    { id: 2, taskId: 1, title: "Create mockups", completed: false, position: 1, createdAt: daysAgo(5) },
    { id: 8, taskId: 1, title: "Review with PM", completed: false, position: 2, createdAt: daysAgo(2) },
  ],
  2: [
    { id: 3, taskId: 2, title: "Login screen", completed: true, position: 0, createdAt: daysAgo(10) },
    { id: 4, taskId: 2, title: "Session handling", completed: true, position: 1, createdAt: daysAgo(8) },
    { id: 5, taskId: 2, title: "QA pass", completed: false, position: 2, createdAt: daysAgo(2) },
  ],
  3: [
    { id: 6, taskId: 3, title: "REST endpoints", completed: false, position: 0, createdAt: daysAgo(4) },
    { id: 7, taskId: 3, title: "tRPC endpoints", completed: false, position: 1, createdAt: daysAgo(4) },
  ],
};

const taskAttachments: Record<number, Array<{
  id: number;
  taskId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataBase64: string;
  listedInFiles?: boolean;
  uploadedBy: number;
  createdAt: Date;
}>> = {};

const taskActivities: Record<number, Array<{
  id: number;
  taskId: number;
  userId: number | null;
  action: "created" | "updated" | "status_changed" | "stage_changed" | "priority_changed" | "title_changed" | "assigned" | "owner_changed" | "commented" | "time_logged" | "subtask_completed" | "tag_added" | "participant_added" | "observer_added";
  oldValue: string | null;
  newValue: string | null;
  metadata: unknown;
  createdAt: Date;
  user: SafeUser | null;
}>> = {
  1: [
    { id: 1, taskId: 1, userId: 2, action: "created", oldValue: null, newValue: "Design homepage hero section", metadata: null, createdAt: daysAgo(10), user: users[1] },
    { id: 2, taskId: 1, userId: 2, action: "assigned", oldValue: "Jenish Radadiya", newValue: "Alex Morgan", metadata: null, createdAt: daysAgo(8), user: users[1] },
    { id: 3, taskId: 1, userId: 1, action: "time_logged", oldValue: null, newValue: "19 minutes", metadata: null, createdAt: daysAgo(3), user: DEV_USER },
    { id: 4, taskId: 1, userId: 2, action: "commented", oldValue: null, newValue: "Can we try a bolder hero layout?", metadata: null, createdAt: daysAgo(0), user: users[1] },
  ],
  2: [
    { id: 5, taskId: 2, userId: 1, action: "created", oldValue: null, newValue: "Implement authentication flow", metadata: null, createdAt: daysAgo(14), user: DEV_USER },
    { id: 6, taskId: 2, userId: 4, action: "commented", oldValue: null, newValue: "Auth flow looks good, minor tweaks needed", metadata: null, createdAt: daysAgo(0), user: users[2] },
    { id: 7, taskId: 2, userId: 1, action: "status_changed", oldValue: "in_progress", newValue: "review", metadata: null, createdAt: daysAgo(1), user: DEV_USER },
  ],
};

const taskTimeEntries: Record<number, Array<{
  id: number;
  userId: number;
  taskId: number;
  clockIn: Date;
  clockOut: Date | null;
  duration: number | null;
  note: string | null;
  user: SafeUser;
}>> = {
  1: (() => {
    const start1 = atDayTime(5, 10, 0);
    const end1 = new Date(start1.getTime() + 19 * 60_000);
    const start2 = atDayTime(3, 14, 30);
    const end2 = new Date(start2.getTime() + 19 * 60_000);
    const start3 = atDayTime(2, 9, 0);
    const end3 = new Date(start3.getTime() + 90 * 60_000);
    return [
      { id: 101, userId: 1, taskId: 1, clockIn: start1, clockOut: end1, duration: 19, note: "Wireframes and layout", user: DEV_USER },
      { id: 102, userId: 1, taskId: 1, clockIn: start2, clockOut: end2, duration: 19, note: "Quick review session", user: DEV_USER },
      { id: 103, userId: 2, taskId: 1, clockIn: start3, clockOut: end3, duration: 90, note: "Design feedback", user: users[1]! },
    ];
  })(),
  2: (() => {
    const start = atDayTime(4, 11, 15);
    const end = new Date(start.getTime() + 360 * 60_000);
    return [
      { id: 201, userId: 1, taskId: 2, clockIn: start, clockOut: end, duration: 360, note: "Auth implementation", user: DEV_USER },
    ];
  })(),
};

type MockWorkEntry = {
  id: number;
  userId: number;
  taskId: number | null;
  projectId: number | null;
  clockIn: Date;
  clockOut: Date | null;
  duration: number | null;
  durationSeconds: number | null;
  note: string | null;
  source: "web" | "mobile" | "manual";
  createdAt: Date;
  updatedAt: Date;
};

let nextWorkEntryId = 1000;

type MockWorkSession = {
  id: number;
  userId: number;
  startTime: Date;
  endTime: Date | null;
  active: boolean;
  paused: boolean;
  accumulatedWorkSeconds: number;
  workSegmentStartedAt: Date | null;
  breakStartedAt: Date | null;
};

const workSessionsByUser: Record<number, MockWorkSession> = {};

type MockWorkBreak = {
  id: number;
  userId: number;
  workSessionId: number;
  timeEntryId: number | null;
  startTime: Date;
  endTime: Date | null;
  reason: string | null;
  manuallyEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
};

let nextWorkBreakId = 5000;
const workBreaksByUser: Record<number, MockWorkBreak[]> = {};

type MockTimeApprovalRequest = {
  id: number;
  userId: number;
  type: "clock_in" | "break";
  status: "pending" | "approved" | "rejected";
  reason: string;
  workSessionId: number | null;
  timeEntryId: number | null;
  workBreakId: number | null;
  originalClockIn: Date | null;
  originalBreakStart: Date | null;
  originalBreakEnd: Date | null;
  requestedClockIn: Date | null;
  requestedBreakStart: Date | null;
  requestedBreakEnd: Date | null;
  reviewedBy: number | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let nextApprovalId = 9000;
const timeApprovalRequests: MockTimeApprovalRequest[] = [];

function mockNotifyAdmins(actor: SafeUser, title: string, message: string, approvalRequestId: number) {
  const recipients = users.filter(
    (u) => (u.role === "admin" || u.role === "hr") && u.id !== actor.id && u.status === "active",
  );
  for (const recipient of recipients) {
    notifications.unshift({
      id: Date.now() + Math.random(),
      userId: recipient.id,
      actorId: actor.id,
      taskId: null,
      type: "time_approval_pending",
      title,
      message,
      approvalRequestId,
      read: false,
      createdAt: new Date(),
    } as (typeof notifications)[number] & { approvalRequestId: number; actorId: number });
  }
}

function mockActorLabel(actor: SafeUser) {
  return actor.name || actor.email || "Someone";
}

function mockNotifyTaskMembers({
  taskId,
  actor,
  type,
  title,
  message,
  activityId = null,
  extraRecipientIds = [],
  excludeUserIds = [],
  includeAssignee = true,
  includeOwner = true,
  includeHrRecipients = false,
}: {
  taskId: number;
  actor: SafeUser;
  type: (typeof notifications)[number]["type"];
  title: string;
  message: string;
  activityId?: number | null;
  extraRecipientIds?: number[];
  excludeUserIds?: number[];
  includeAssignee?: boolean;
  includeOwner?: boolean;
  includeHrRecipients?: boolean;
}) {
  const task = tasks.find((t) => t.id === taskId);
  const excluded = new Set([actor.id, ...excludeUserIds].map(Number));
  const recipientIds = new Set<number>();
  if (includeOwner && task?.createdBy != null) recipientIds.add(task.createdBy);
  if (includeAssignee && task?.assigneeId != null) recipientIds.add(task.assigneeId);
  for (const id of extraRecipientIds) recipientIds.add(Number(id));

  const recipients = [...recipientIds].filter((id) => {
    if (excluded.has(id)) return false;
    if (includeHrRecipients) return true;
    const recipient = users.find((u) => u.id === id);
    if (!recipient) return true;
    // Keep mock aligned with production: HR department users skip task alerts.
    const dept = (recipient.department ?? "").trim().toLowerCase();
    if (recipient.role !== "admin" && dept === "hr") return false;
    return true;
  });
  if (recipients.length === 0) return;

  const now = new Date();
  for (const userId of recipients) {
    notifications.unshift({
      id: Date.now() + Math.floor(Math.random() * 10_000),
      userId,
      actorId: actor.id,
      taskId,
      activityId,
      type,
      title,
      message,
      read: false,
      link: activityId
        ? `/tasks?task=${taskId}&activity=${activityId}`
        : `/tasks?task=${taskId}`,
      createdAt: now,
    } as (typeof notifications)[number] & { actorId: number; activityId?: number | null });
  }
}

function mockApplyClockInApproval(
  request: MockTimeApprovalRequest,
  session: MockWorkSession,
  entry: MockWorkEntry | undefined,
) {
  if (!request.requestedClockIn || !request.originalClockIn) return;
  const deltaSeconds = Math.floor(
    (request.originalClockIn.getTime() - request.requestedClockIn.getTime()) / 1000,
  );
  if (deltaSeconds <= 0) return;

  const now = new Date();
  const requestedClockIn = request.requestedClockIn;
  const breaks = mockFindBreaksOverlappingWindow(
    session.userId,
    requestedClockIn,
    session.endTime ?? now,
  );

  session.startTime = requestedClockIn;

  if (session.active) {
    if (session.paused) {
      const pauseAt = session.breakStartedAt ?? now;
      session.accumulatedWorkSeconds = computeAttendanceWorkSeconds(
        requestedClockIn,
        pauseAt,
        breaks,
        now,
      );
      session.workSegmentStartedAt = null;
    } else {
      const segmentStart = session.workSegmentStartedAt;
      const segmentIsOriginalClockIn =
        !!segmentStart &&
        Math.abs(segmentStart.getTime() - request.originalClockIn.getTime()) < 2000;

      if (!segmentStart || segmentIsOriginalClockIn) {
        session.accumulatedWorkSeconds = computeAttendanceWorkSeconds(
          requestedClockIn,
          now,
          breaks,
          now,
        );
        session.workSegmentStartedAt = now;
      } else {
        session.accumulatedWorkSeconds = computeAttendanceWorkSeconds(
          requestedClockIn,
          segmentStart,
          breaks,
          now,
        );
      }
    }
  }

  if (entry) {
    entry.clockIn = requestedClockIn;
    if (entry.clockOut) {
      entry.durationSeconds = computeAttendanceWorkSeconds(
        requestedClockIn,
        entry.clockOut,
        breaks,
        now,
      );
      entry.duration = Math.floor(entry.durationSeconds / 60);
    }
  }
}

function workSessionTiming(session: MockWorkSession, now = new Date()) {
  const breaks = mockFindBreaksOverlappingWindow(session.userId, session.startTime, now);
  const workElapsedSeconds = computeAttendanceWorkSeconds(
    session.startTime,
    now,
    breaks,
    now,
  );
  const breakElapsedSeconds = session.breakStartedAt
    ? Math.floor((now.getTime() - session.breakStartedAt.getTime()) / 1000)
    : 0;
  return { workElapsedSeconds, breakElapsedSeconds };
}

export function mockWorkSessionView(session: MockWorkSession) {
  const { workElapsedSeconds, breakElapsedSeconds } = workSessionTiming(session);
  const priorDayWorkSeconds = mockPriorDayWorkSeconds(session.userId, session.startTime);
  return {
    id: session.id,
    userId: session.userId,
    startTime: session.startTime,
    endTime: session.endTime,
    active: session.active,
    paused: session.paused,
    workElapsedSeconds,
    breakElapsedSeconds,
    priorDayWorkSeconds,
  };
}

function mockPriorDayWorkSeconds(userId: number, sessionStart: Date) {
  const dateStr = localDateKey(sessionStart);
  const { start, end } = dayBounds(dateStr);
  return userWorkEntries
    .filter(
      (e) =>
        e.userId === userId &&
        e.taskId == null &&
        e.clockOut &&
        e.clockIn >= start &&
        e.clockIn <= end,
    )
    .reduce((sum, entry) => sum + attendanceEntrySeconds(entry), 0);
}

const userWorkEntries: MockWorkEntry[] = [
  {
    id: 1,
    userId: 1,
    taskId: null,
    projectId: null,
    clockIn: daysAgo(1),
    clockOut: new Date(daysAgo(1).getTime() + 4 * 3600000),
    duration: 240,
    durationSeconds: 240 * 60,
    note: "Homepage design work",
    source: "web",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
];

function periodStart(period: "today" | "week" | "month") {
  const now = new Date();
  if (period === "today") {
    return startOfWorkZoneDay(now);
  }
  if (period === "week") {
    return startOfCalendarWeek(now);
  }
  const start = new Date(now);
  start.setMonth(start.getMonth() - 1);
  return start;
}

function allUserTimeEntries(userId: number): MockWorkEntry[] {
  const general = userWorkEntries.filter((e) => e.userId === userId);
  const fromTasks: MockWorkEntry[] = [];

  for (const [taskIdStr, entries] of Object.entries(taskTimeEntries)) {
    const taskId = Number(taskIdStr);
    const projectId = tasks.find((t) => t.id === taskId)?.projectId ?? null;
    for (const e of entries) {
      if (e.userId !== userId || !e.clockOut) continue;
      fromTasks.push({
        id: e.id,
        userId: e.userId,
        taskId,
        projectId,
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        duration: e.duration ?? Math.max(
          1,
          Math.floor((e.clockOut.getTime() - e.clockIn.getTime()) / 60000),
        ),
        durationSeconds: null,
        note: e.note,
        source: "web",
        createdAt: e.clockIn,
        updatedAt: e.clockOut,
      });
    }
  }

  return [...general, ...fromTasks].sort(
    (a, b) => b.clockIn.getTime() - a.clockIn.getTime(),
  );
}

export function mockTaskById(id: number) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const project = projects.find((p) => p.id === task.projectId) as
    | ((typeof projects)[number] & {
        customPipelineStages?: Array<{ key: string; label: string; color: string }> | null;
        pipelineStageLabelOverrides?: Record<string, string> | null;
      })
    | null
    | undefined;
  const customStages = project?.customPipelineStages ?? [];
  return {
    ...task,
    project: project
      ? {
          ...project,
          customPipelineStages: customStages,
          pipelineStageLabelOverrides: project.pipelineStageLabelOverrides ?? {},
        }
      : null,
    pipelineStages: resolveMockPipelineStages(project),
    creator: userById(task.createdBy ?? 1),
    subtasks: [...(taskSubtasks[id] ?? [])],
    attachments: [...(taskAttachments[id] ?? [])]
      .filter((a) => a.listedInFiles !== false)
      .map(({ dataBase64: _data, ...meta }) => meta),
    participants: taskParticipants[id] ?? [],
    observers: taskObservers[id] ?? [],
    activities: (taskActivities[id] ?? []).map((a) => ({ ...a })),
  };
}

export function mockTaskTimeTracked(taskId: number) {
  const entries = (taskTimeEntries[taskId] ?? []).map((e) => {
    const durationSeconds = e.clockIn && e.clockOut
      ? Math.max(0, Math.floor((e.clockOut.getTime() - e.clockIn.getTime()) / 1000))
      : (e.duration ?? 0) * 60;
    return { ...e, durationSeconds };
  });
  const totalSeconds = entries.reduce((sum, e) => sum + e.durationSeconds, 0);
  return {
    totalMinutes: Math.round(totalSeconds / 60),
    totalSeconds,
    entries,
  };
}

export function mockUpdateTaskTimeEntry(
  actor: SafeUser,
  input: {
    taskId: number;
    entryId: number;
    clockIn: string;
    clockOut: string;
    reason: string;
  },
) {
  const list = taskTimeEntries[input.taskId];
  if (!list) throw new Error("Time entry not found");
  const entry = list.find((e) => e.id === input.entryId);
  if (!entry) throw new Error("Time entry not found");
  if (!entry.clockOut) throw new Error("Cannot edit an active timer session");

  const clockIn = new Date(input.clockIn);
  const clockOut = new Date(input.clockOut);
  if (clockOut <= clockIn) throw new Error("End time must be after start time");

  const previousDurationSeconds =
    typeof entry.durationSeconds === "number" && entry.durationSeconds >= 0
      ? entry.durationSeconds
      : (entry.duration ?? 0) * 60;
  const durationSeconds = Math.max(
    0,
    Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000),
  );
  entry.clockIn = clockIn;
  entry.clockOut = clockOut;
  entry.durationSeconds = durationSeconds;
  entry.duration = Math.floor(durationSeconds / 60);
  const noteSuffix = `(edited: ${input.reason.trim()})`;
  entry.note = entry.note ? `${entry.note} ${noteSuffix}` : noteSuffix;

  const activities = taskActivities[input.taskId] ?? (taskActivities[input.taskId] = []);
  activities.unshift({
    id: Date.now(),
    taskId: input.taskId,
    userId: actor.id,
    action: "time_logged",
    oldValue: null,
    newValue: `Time entry edited — ${entry.duration} min`,
    metadata: { entryId: input.entryId, reason: input.reason.trim() },
    createdAt: new Date(),
    user: actor,
  });

  const task = tasks.find((t) => t.id === input.taskId);
  if (task) {
    const currentActualHours = parseFloat(task.actualHours ?? "0") || 0;
    const adjustedActualHours =
      currentActualHours + (durationSeconds - previousDurationSeconds) / 3600;
    task.actualHours = Math.max(0, adjustedActualHours).toFixed(2);
  }
  mockNotifyTaskMembers({
    taskId: input.taskId,
    actor,
    type: "task_updated",
    title: "Time entry updated",
    message: `${mockActorLabel(actor)} edited time logged on "${task?.title ?? "a task"}"`,
  });

  return entry;
}

export function mockDeleteTaskTimeEntry(
  actor: SafeUser,
  input: {
    taskId: number;
    entryId: number;
  },
) {
  const list = taskTimeEntries[input.taskId];
  if (!list) throw new Error("Time entry not found");
  const index = list.findIndex((e) => e.id === input.entryId);
  if (index < 0) throw new Error("Time entry not found");
  const entry = list[index];
  if (!entry.clockOut) throw new Error("Cannot delete an active timer session");

  const durationSeconds =
    typeof entry.durationSeconds === "number" && entry.durationSeconds >= 0
      ? entry.durationSeconds
      : (entry.duration ?? 0) * 60;
  const durationMinutes = Math.floor(durationSeconds / 60);

  list.splice(index, 1);

  const activities = taskActivities[input.taskId] ?? (taskActivities[input.taskId] = []);
  activities.unshift({
    id: Date.now(),
    taskId: input.taskId,
    userId: actor.id,
    action: "time_logged",
    oldValue: null,
    newValue: `Time entry deleted — ${durationMinutes} min`,
    metadata: { entryId: input.entryId },
    createdAt: new Date(),
    user: actor,
  });

  const task = tasks.find((t) => t.id === input.taskId);
  if (task) {
    const currentActualHours = parseFloat(task.actualHours ?? "0") || 0;
    task.actualHours = Math.max(0, currentActualHours - durationSeconds / 3600).toFixed(2);
  }
  mockNotifyTaskMembers({
    taskId: input.taskId,
    actor,
    type: "task_updated",
    title: "Time entry deleted",
    message: `${mockActorLabel(actor)} deleted time logged on "${task?.title ?? "a task"}"`,
  });

  return { success: true as const };
}

export function mockAddManualTaskTimeEntry(
  actor: SafeUser,
  input: {
    taskId: number;
    userId?: number;
    clockIn: string;
    clockOut: string;
    note?: string;
  },
) {
  const userId = input.userId ?? actor.id;
  const clockIn = new Date(input.clockIn);
  const clockOut = new Date(input.clockOut);
  if (clockOut <= clockIn) throw new Error("End time must be after start time");

  const duration = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000);
  const list = taskTimeEntries[input.taskId] ?? (taskTimeEntries[input.taskId] = []);
  const entry = {
    id: Date.now(),
    userId,
    taskId: input.taskId,
    clockIn,
    clockOut,
    duration,
    note: input.note?.trim() || "Manual entry",
    user: userById(userId),
  };
  list.unshift(entry);

  const task = tasks.find((t) => t.id === input.taskId);
  if (task) {
    const currentHours = parseFloat(task.actualHours ?? "0");
    task.actualHours = (currentHours + duration / 60).toFixed(2);
  }

  const activities = taskActivities[input.taskId] ?? (taskActivities[input.taskId] = []);
  activities.unshift({
    id: Date.now() + 1,
    taskId: input.taskId,
    userId: actor.id,
    action: "time_logged",
    oldValue: null,
    newValue: `Manual time added — ${duration} min`,
    metadata: { entryId: entry.id, targetUserId: userId },
    createdAt: new Date(),
    user: actor,
  });

  mockNotifyTaskMembers({
    taskId: input.taskId,
    actor,
    type: "task_updated",
    title: "Time logged",
    message: `${mockActorLabel(actor)} added ${duration} min of time on "${task?.title ?? "a task"}"`,
  });

  return entry;
}

const activeTaskTimers: Record<number, {
  userId: number;
  taskId: number;
  clockIn: Date | null;
  paused: boolean;
  accumulatedSeconds: number;
}> = {};

function timerElapsedSeconds(active: NonNullable<typeof activeTaskTimers[number]>) {
  const running = active.clockIn
    ? Math.floor((Date.now() - active.clockIn.getTime()) / 1000)
    : 0;
  return active.accumulatedSeconds + running;
}

function persistTaskTimeEntry(
  taskId: number,
  userId: number,
  actor: SafeUser,
  totalSeconds: number,
  note = "Task timer",
) {
  if (totalSeconds < 1) return 0;

  const durationMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
  const list = taskTimeEntries[taskId] ?? (taskTimeEntries[taskId] = []);
  const clockOut = new Date();
  const clockIn = new Date(clockOut.getTime() - totalSeconds * 1000);
  list.unshift({
    id: Date.now(),
    userId,
    taskId,
    clockIn,
    clockOut,
    duration: durationMinutes,
    note,
    user: actor,
  });

  const task = tasks.find((t) => t.id === taskId);
  if (task) {
    const currentHours = parseFloat(task.actualHours ?? "0");
    task.actualHours = (currentHours + totalSeconds / 3600).toFixed(2);
  }

  const activities = taskActivities[taskId] ?? (taskActivities[taskId] = []);
  activities.unshift({
    id: Date.now() + 1,
    taskId,
    userId: actor.id,
    action: "time_logged",
    oldValue: null,
    newValue: `${durationMinutes} minutes`,
    metadata: null,
    createdAt: new Date(),
    user: actor,
  });

  return durationMinutes;
}

export function mockGetActiveTaskTimer(userId: number, taskId?: number) {
  const active = activeTaskTimers[userId];
  if (!active) return null;
  if (taskId !== undefined && active.taskId !== taskId) return null;
  return {
    taskId: active.taskId,
    startedAt: active.clockIn,
    paused: active.paused,
    accumulatedSeconds: active.accumulatedSeconds,
    elapsedSeconds: timerElapsedSeconds(active),
  };
}

export function mockGetMyActiveTaskTimer(userId: number) {
  const active = activeTaskTimers[userId];
  if (!active || active.paused || !active.clockIn) return null;
  const task = tasks.find((t) => t.id === active.taskId);
  if (!task) return null;
  return {
    taskId: active.taskId,
    taskTitle: task.title,
    startedAt: active.clockIn,
    paused: false,
    accumulatedSeconds: active.accumulatedSeconds,
  };
}

function mockCanManageTaskTime(actor: SafeUser, taskId: number) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return false;
  const uid = Number(actor.id);
  if (
    actor.role === "admin"
    || actor.role === "manager"
    || Number(task.createdBy) === uid
    || Number(task.assigneeId) === uid
  ) {
    return true;
  }
  return (taskParticipants[taskId] ?? []).some((p) => Number(p.id) === uid);
}

export function mockStartTaskTimer(
  userId: number,
  taskId: number,
  actor: SafeUser,
  clientStartedAt?: Date,
) {
  if (!mockCanManageTaskTime(actor, taskId)) {
    throw new Error("Only the assignee or participants can start the timer on this task");
  }
  const task = tasks.find((t) => t.id === taskId);
  const label = mockActorLabel(actor);
  const taskTitle = task?.title ?? "a task";
  const startedAt =
    clientStartedAt instanceof Date && Number.isFinite(clientStartedAt.getTime())
      ? clientStartedAt
      : new Date();

  const existing = activeTaskTimers[userId];
  if (
    existing
    && existing.taskId !== taskId
    && !existing.paused
    && existing.clockIn
  ) {
    mockPauseTaskTimer(userId, existing.taskId, actor);
  } else if (existing && existing.taskId !== taskId) {
    delete activeTaskTimers[userId];
  }

  const current = activeTaskTimers[userId];
  if (current?.taskId === taskId && current.paused) {
    // Each Start/Resume begins a fresh session from 00:00:00.
    current.paused = false;
    current.clockIn = startedAt;
    current.accumulatedSeconds = 0;
    const list = taskActivities[taskId] ?? (taskActivities[taskId] = []);
    list.unshift({
      id: Date.now(),
      taskId,
      userId: actor.id,
      action: "time_logged",
      oldValue: null,
      newValue: "resumed timer",
      metadata: null,
      createdAt: new Date(),
      user: actor,
    });
    mockNotifyTaskMembers({
      taskId,
      actor,
      type: "task_updated",
      title: "Timer started",
      message: `${label} resumed the timer on "${taskTitle}"`,
    });
    return { taskId, startedAt: current.clockIn, resumed: true };
  }

  activeTaskTimers[userId] = {
    userId,
    taskId,
    clockIn: startedAt,
    paused: false,
    accumulatedSeconds: 0,
  };
  const list = taskActivities[taskId] ?? (taskActivities[taskId] = []);
  list.unshift({
    id: Date.now(),
    taskId,
    userId: actor.id,
    action: "time_logged",
    oldValue: null,
    newValue: "started timer",
    metadata: null,
    createdAt: startedAt,
    user: actor,
  });
  mockNotifyTaskMembers({
    taskId,
    actor,
    type: "task_updated",
    title: "Timer started",
    message: `${label} started the timer on "${taskTitle}"`,
  });
  return { taskId, startedAt };
}

export function mockPauseTaskTimer(userId: number, taskId: number, actor: SafeUser) {
  if (!mockCanManageTaskTime(actor, taskId)) {
    throw new Error("Only the assignee or participants can pause the timer on this task");
  }
  const active = activeTaskTimers[userId];
  if (!active || active.taskId !== taskId || active.paused || !active.clockIn) {
    throw new Error("No running timer for this task");
  }

  active.accumulatedSeconds += Math.floor((Date.now() - active.clockIn.getTime()) / 1000);
  active.clockIn = null;

  const secondsToSave = active.accumulatedSeconds;
  const durationMinutes = Math.floor(secondsToSave / 60);
  if (secondsToSave >= 1) {
    persistTaskTimeEntry(taskId, userId, actor, secondsToSave, "Task timer (paused)");
    active.accumulatedSeconds = 0;
  }

  active.paused = true;

  const activities = taskActivities[taskId] ?? (taskActivities[taskId] = []);
  activities.unshift({
    id: Date.now(),
    taskId,
    userId: actor.id,
    action: "time_logged",
    oldValue: null,
    newValue: durationMinutes > 0 ? `paused timer ${durationMinutes} minutes` : "paused timer",
    metadata: null,
    createdAt: new Date(),
    user: actor,
  });

  const task = tasks.find((t) => t.id === taskId);
  mockNotifyTaskMembers({
    taskId,
    actor,
    type: "task_updated",
    title: "Timer paused",
    message: `${mockActorLabel(actor)} paused the timer on "${task?.title ?? "a task"}"`,
  });

  return { accumulatedSeconds: active.accumulatedSeconds, savedSeconds: secondsToSave };
}

export function mockStopTaskTimer(userId: number, taskId: number, actor: SafeUser) {
  if (!mockCanManageTaskTime(actor, taskId)) {
    throw new Error("Only the assignee or participants can stop the timer on this task");
  }
  const active = activeTaskTimers[userId];
  if (!active || active.taskId !== taskId) {
    throw new Error("No active timer for this task");
  }

  let totalSeconds = active.accumulatedSeconds;
  if (active.clockIn) {
    totalSeconds += Math.floor((Date.now() - active.clockIn.getTime()) / 1000);
  }
  delete activeTaskTimers[userId];

  const durationMinutes = totalSeconds >= 1
    ? persistTaskTimeEntry(taskId, userId, actor, totalSeconds)
    : 0;

  const task = tasks.find((t) => t.id === taskId);
  mockNotifyTaskMembers({
    taskId,
    actor,
    type: "task_updated",
    title: "Timer stopped",
    message: `${mockActorLabel(actor)} stopped the timer on "${task?.title ?? "a task"}" (${durationMinutes} min)`,
  });

  return { durationMinutes };
}

export function mockPauseAllRunningTaskTimers(userId: number, actor: SafeUser) {
  const active = activeTaskTimers[userId];
  if (!active || active.paused || !active.clockIn) return [];

  const taskId = active.taskId;
  mockPauseTaskTimer(userId, taskId, actor);
  return [{ taskId, durationSeconds: 0 }];
}

export function mockAddTaskComment(taskId: number, message: string, actor: SafeUser) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found");

  const list = taskActivities[taskId] ?? (taskActivities[taskId] = []);
  const activity = {
    id: Date.now(),
    taskId,
    userId: actor.id,
    action: "commented" as const,
    oldValue: null,
    newValue: message,
    metadata: null,
    createdAt: new Date(),
    user: actor,
  };
  list.unshift(activity);
  task.updatedAt = new Date();

  const previewSource = richCommentPlainText(message) || formatCommentPreview(message);
  const preview = previewSource.length > 120 ? `${previewSource.slice(0, 120)}…` : previewSource;
  const mentionedUserIds = extractMentionedUserIdsFromComment(message);

  if (mentionedUserIds.length > 0) {
    mockNotifyTaskMembers({
      taskId,
      actor,
      type: "mention",
      title: "You were mentioned in a comment",
      message: `${mockActorLabel(actor)} mentioned you on "${task.title}": ${preview}`,
      activityId: activity.id,
      extraRecipientIds: mentionedUserIds,
      includeAssignee: false,
      includeOwner: false,
      includeHrRecipients: true,
    });
  }
  mockNotifyTaskMembers({
    taskId,
    actor,
    type: "mention",
    title: "New comment on task",
    message: `${mockActorLabel(actor)}: ${preview}`,
    activityId: activity.id,
    excludeUserIds: mentionedUserIds,
  });

  return activity;
}

export function mockEditTaskComment(
  taskId: number,
  activityId: number,
  message: string,
  actor: SafeUser,
) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found");

  const list = taskActivities[taskId] ?? [];
  const activity = list.find((item) => item.id === activityId);
  if (!activity) throw new Error("Comment not found");
  if (activity.action !== "commented") throw new Error("Only comments can be edited");
  if (activity.userId !== actor.id) throw new Error("You can only edit your own comments");
  if (activity.metadata && typeof activity.metadata === "object" && "subtaskId" in activity.metadata) {
    throw new Error("This message cannot be edited");
  }

  activity.oldValue = activity.newValue;
  activity.newValue = message;
  activity.metadata = {
    ...(activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {}),
    editedAt: new Date().toISOString(),
  };
  task.updatedAt = new Date();

  const previousMentionIds = new Set(
    extractMentionedUserIdsFromComment(activity.oldValue ?? ""),
  );
  const nextMentionIds = extractMentionedUserIdsFromComment(message);
  const newlyMentioned = nextMentionIds.filter((id) => !previousMentionIds.has(id));
  if (newlyMentioned.length > 0) {
    const previewSource = richCommentPlainText(message) || formatCommentPreview(message);
    const preview = previewSource.length > 120 ? `${previewSource.slice(0, 120)}…` : previewSource;
    mockNotifyTaskMembers({
      taskId,
      actor,
      type: "mention",
      title: "You were mentioned in a comment",
      message: `${mockActorLabel(actor)} mentioned you on "${task.title}": ${preview}`,
      activityId: activity.id,
      extraRecipientIds: newlyMentioned,
      includeAssignee: false,
      includeOwner: false,
      includeHrRecipients: true,
    });
  }

  return activity;
}

export function mockDeleteTaskComment(
  taskId: number,
  activityId: number,
  actor: SafeUser,
) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found");

  const list = taskActivities[taskId] ?? [];
  const index = list.findIndex((item) => item.id === activityId);
  if (index < 0) throw new Error("Comment not found");

  const activity = list[index];
  if (activity.action !== "commented") throw new Error("Only comments can be deleted");
  if (activity.userId !== actor.id) throw new Error("You can only delete your own comments");
  if (activity.metadata && typeof activity.metadata === "object" && "subtaskId" in activity.metadata) {
    throw new Error("This message cannot be deleted");
  }

  list.splice(index, 1);
  task.updatedAt = new Date();

  return { success: true };
}

export function mockToggleCommentReaction(
  taskId: number,
  activityId: number,
  emoji: string,
  actor: SafeUser,
) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found");

  const list = taskActivities[taskId] ?? [];
  const activity = list.find((item) => item.id === activityId);
  if (!activity) throw new Error("Comment not found");
  if (activity.action !== "commented") throw new Error("Only comments can be reacted to");
  if (activity.metadata && typeof activity.metadata === "object" && "subtaskId" in activity.metadata) {
    throw new Error("This message cannot be reacted to");
  }

  const emojiValue = emoji.trim();
  const baseMeta =
    activity.metadata && typeof activity.metadata === "object"
      ? { ...(activity.metadata as Record<string, unknown>) }
      : {};
  const previousReactions = readCommentReactions(baseMeta);
  const reactions = toggleUserReaction(previousReactions, emojiValue, actor.id);
  const added =
    Boolean(reactions[emojiValue]?.includes(actor.id)) &&
    !Boolean(previousReactions[emojiValue]?.includes(actor.id));

  activity.metadata = {
    ...baseMeta,
    reactions,
  };
  task.updatedAt = new Date();

  if (added) {
    mockNotifyTaskMembers({
      taskId,
      actor,
      type: "task_updated",
      title: "New reaction on comment",
      message: `${mockActorLabel(actor)} reacted ${emojiValue} on a comment in "${task.title}"`,
      activityId: activity.id,
      includeAssignee: true,
    });
  }

  return { success: true, reactions };
}

export function mockCreateSubtask(taskId: number, title: string, actor: SafeUser) {
  const list = taskSubtasks[taskId] ?? (taskSubtasks[taskId] = []);
  const id = list.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  const subtask = {
    id,
    taskId,
    title,
    completed: false,
    position: list.length,
    createdAt: new Date(),
  };
  list.push(subtask);

  const activities = taskActivities[taskId] ?? (taskActivities[taskId] = []);
  activities.unshift({
    id: Date.now(),
    taskId,
    userId: actor.id,
    action: "commented",
    oldValue: null,
    newValue: `added subtask: ${title}`,
    metadata: { subtaskId: id },
    createdAt: new Date(),
    user: actor,
  });

  const task = tasks.find((t) => t.id === taskId);
  if (task) task.updatedAt = new Date();

  return subtask;
}

export function mockToggleSubtask(id: number) {
  for (const list of Object.values(taskSubtasks)) {
    const item = list.find((entry) => entry.id === id);
    if (!item) continue;
    item.completed = !item.completed;
    return item;
  }
  throw new Error("Checklist item not found");
}

export function mockDeleteSubtask(id: number) {
  for (const [taskId, list] of Object.entries(taskSubtasks)) {
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) continue;
    list.splice(index, 1);
    taskSubtasks[Number(taskId)] = list;
    return { success: true as const };
  }
  throw new Error("Checklist item not found");
}

export function mockCreateTask(
  input: {
    title: string;
    description?: string;
    priority?: string;
    assigneeId?: number;
    createdBy?: number;
    projectId?: number | null;
    dueDate?: string;
    estimatedHours?: number | string;
    tags?: string[];
    stage?: string;
  },
  actor: SafeUser,
) {
  const id = tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  const assignee = input.assigneeId ? userById(input.assigneeId) : undefined;

  const newTask = {
    id,
    title: input.title,
    description: input.description ?? null,
    status: "todo" as const,
    stage: (input.stage ?? "new") as typeof tasks[number]["stage"],
    priority: (input.priority ?? "medium") as "low" | "medium" | "high" | "urgent",
    assigneeId: input.assigneeId,
    projectId: input.projectId ?? undefined,
    createdBy:
      String(actor.role ?? "").toLowerCase() === "client"
        ? actor.id
        : input.createdBy != null
          ? Number(input.createdBy)
          : actor.id,
    dueDate: input.dueDate ? new Date(input.dueDate) : new Date(defaultTaskDeadlineIso()),
    estimatedHours: input.estimatedHours != null ? String(input.estimatedHours) : null,
    actualHours: "0.00",
    position: tasks.length,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignee: assignee ?? (input.assigneeId === actor.id ? actor : undefined),
  };

  tasks.unshift(newTask);
  taskParticipants[id] = [];
  taskObservers[id] = [];
  taskActivities[id] = [
    {
      id: Date.now(),
      taskId: id,
      userId: actor.id,
      action: "created",
      oldValue: null,
      newValue: input.title,
      metadata: input.tags?.length ? { tags: input.tags } : null,
      createdAt: new Date(),
      user: actor,
    },
  ];

  if (input.assigneeId && input.assigneeId !== actor.id) {
    mockNotifyTaskMembers({
      taskId: id,
      actor,
      type: "task_assigned",
      title: "Assigned to you",
      message: `${mockActorLabel(actor)} assigned "${input.title}" to you`,
      extraRecipientIds: [input.assigneeId],
      includeAssignee: false,
      includeOwner: false,
    });
  }

  return newTask;
}

export function mockDeleteTask(id: number, actor: SafeUser) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) throw new Error("Task not found");

  const task = tasks[index];
  if (task.createdBy !== actor.id && actor.role === "employee") {
    throw new Error("Not authorized to delete this task");
  }

  tasks.splice(index, 1);
  delete taskParticipants[id];
  delete taskObservers[id];
  delete taskActivities[id];
  delete taskTimeEntries[id];

  for (const userId of Object.keys(activeTaskTimers)) {
    if (activeTaskTimers[Number(userId)]?.taskId === id) {
      delete activeTaskTimers[Number(userId)];
    }
  }

  return { success: true };
}

export function mockUpdateTask(
  id: number,
  data: {
    title?: string;
    assigneeId?: number | null;
    createdBy?: number | null;
    status?: string;
    stage?: string;
    priority?: string;
    description?: string;
    dueDate?: string | null;
    projectId?: number | null;
    estimatedHours?: number | string | null;
  },
  actor: SafeUser,
) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  const label = mockActorLabel(actor);
  const previousTitle = task.title;

  if (data.title !== undefined) {
    const nextTitle = data.title.trim();
    if (nextTitle && nextTitle !== task.title) {
      const list = taskActivities[id] ?? (taskActivities[id] = []);
      list.unshift({
        id: Date.now(),
        taskId: id,
        userId: actor.id,
        action: "title_changed",
        oldValue: task.title,
        newValue: nextTitle,
        metadata: null,
        createdAt: new Date(),
        user: actor,
      });
      task.title = nextTitle;
      mockNotifyTaskMembers({
        taskId: id,
        actor,
        type: "task_updated",
        title: "Task renamed",
        message: `${label} renamed "${previousTitle}" to "${nextTitle}"`,
      });
    }
  }

  const taskTitle = task.title;

  if (data.description !== undefined) task.description = data.description;
  if (data.createdBy !== undefined) {
    task.createdBy = data.createdBy;
  }
  if (data.dueDate !== undefined) {
    task.dueDate = data.dueDate;
    if (data.dueDate && task.status === "done") {
      task.status = "todo";
    }
  }
  if (data.status) {
    const list = taskActivities[id] ?? (taskActivities[id] = []);
    list.unshift({
      id: Date.now(),
      taskId: id,
      userId: actor.id,
      action: "status_changed",
      oldValue: task.status,
      newValue: data.status,
      metadata: null,
      createdAt: new Date(),
      user: actor,
    });
    task.status = data.status as typeof task.status;
    if (data.stage === undefined) {
      task.stage = legacyStatusToStage(data.status) as typeof task.stage;
    }
    mockNotifyTaskMembers({
      taskId: id,
      actor,
      type: "task_updated",
      title: "Task status changed",
      message: `${label} changed "${taskTitle}" to ${data.status.replace(/_/g, " ")}`,
    });
  }
  if (data.stage) {
    const oldStage = task.stage ?? legacyStatusToStage(task.status);
    task.stage = data.stage as typeof task.stage;
    if (data.stage === "finished") {
      task.status = "done";
    } else if (task.status === "done") {
      task.status = "in_progress";
    }
    const list = taskActivities[id] ?? (taskActivities[id] = []);
    list.unshift({
      id: Date.now() + 2,
      taskId: id,
      userId: actor.id,
      action: "stage_changed",
      oldValue: oldStage,
      newValue: data.stage,
      metadata: null,
      createdAt: new Date(),
      user: actor,
    });
    mockNotifyTaskMembers({
      taskId: id,
      actor,
      type: "task_updated",
      title: "Task stage changed",
      message: `${label} moved "${taskTitle}" to ${data.stage}`,
    });
  }

  // Completing a task (Done / Finished) always clears the assignee.
  if (isMarkingTaskComplete(data) && (task.assigneeId != null || data.assigneeId !== undefined)) {
    const oldAssigneeId = task.assigneeId ?? null;
    if (oldAssigneeId != null || data.assigneeId != null) {
      const oldName = userById(oldAssigneeId ?? 0)?.name ?? "Unassigned";
      task.assigneeId = undefined;
      task.assignee = undefined;
      const list = taskActivities[id] ?? (taskActivities[id] = []);
      list.unshift({
        id: Date.now() + 3,
        taskId: id,
        userId: actor.id,
        action: "assigned",
        oldValue: oldName,
        newValue: "Unassigned",
        metadata: { reason: "task_completed" },
        createdAt: new Date(),
        user: actor,
      });
    }
    // Skip normal assignee update below when completing.
    data = { ...data, assigneeId: undefined };
  }
  if (data.priority !== undefined && data.priority !== task.priority) {
    const oldPriority = task.priority;
    task.priority = data.priority as typeof task.priority;
    const formatPriority = (value: string) =>
      value.charAt(0).toUpperCase() + value.slice(1);
    const priorityTitle =
      data.priority === "urgent" ? "Task marked urgent" : "Task priority changed";
    const priorityMessage =
      data.priority === "urgent"
        ? `${label} marked "${taskTitle}" as urgent`
        : `${label} changed priority on "${taskTitle}" from ${formatPriority(oldPriority)} to ${formatPriority(data.priority)}`;

    const list = taskActivities[id] ?? (taskActivities[id] = []);
    list.unshift({
      id: Date.now() + 3,
      taskId: id,
      userId: actor.id,
      action: "priority_changed",
      oldValue: oldPriority,
      newValue: data.priority,
      metadata: null,
      createdAt: new Date(),
      user: actor,
    });
    mockNotifyTaskMembers({
      taskId: id,
      actor,
      type: "task_updated",
      title: priorityTitle,
      message: priorityMessage,
    });
    for (const lead of users.filter((u) => u.role === "admin" || u.role === "manager")) {
      if (lead.id === actor.id || lead.id === task.assigneeId) continue;
      notifications.unshift({
        id: Date.now() + Math.floor(Math.random() * 10_000),
        userId: lead.id,
        actorId: actor.id,
        taskId: id,
        type: "task_updated",
        title: priorityTitle,
        message: priorityMessage,
        read: false,
        createdAt: new Date(),
      } as (typeof notifications)[number]);
    }
  }
  if (data.assigneeId !== undefined) {
    const oldAssigneeId = task.assigneeId ?? null;
    const newAssigneeId = data.assigneeId ?? null;

    const newAssignee = newAssigneeId ? userById(newAssigneeId) : null;
    task.assigneeId = newAssigneeId ?? undefined;
    task.assignee = newAssignee;

    if (newAssigneeId) {
      mockRemoveObserver(id, newAssigneeId);
    }
    if (oldAssigneeId && oldAssigneeId !== newAssigneeId) {
      mockAddObserver(id, oldAssigneeId, actor, true);
    }

    const list = taskActivities[id] ?? (taskActivities[id] = []);
    list.unshift({
      id: Date.now() + 1,
      taskId: id,
      userId: actor.id,
      action: "assigned",
      oldValue: userById(oldAssigneeId ?? 0)?.name ?? "Unassigned",
      newValue: newAssignee?.name ?? "Unassigned",
      metadata: null,
      createdAt: new Date(),
      user: actor,
    });

    if (newAssigneeId) {
      mockNotifyTaskMembers({
        taskId: id,
        actor,
        type: "task_assigned",
        title: "Assigned to you",
        message: `${label} assigned "${taskTitle}" to you`,
        extraRecipientIds: [newAssigneeId],
        includeAssignee: false,
        includeOwner: false,
      });
      mockNotifyTaskMembers({
        taskId: id,
        actor,
        type: "task_updated",
        title: "Task reassigned",
        message: `${label} assigned "${taskTitle}" to ${newAssignee?.name ?? newAssignee?.email ?? "someone"}`,
        includeAssignee: false,
        excludeUserIds: [newAssigneeId],
      });
    } else {
      mockNotifyTaskMembers({
        taskId: id,
        actor,
        type: "task_updated",
        title: "Task updated",
        message: `${label} removed the assignee from "${taskTitle}"`,
      });
    }

    if (oldAssigneeId && oldAssigneeId !== newAssigneeId && oldAssigneeId !== actor.id) {
      notifications.unshift({
        id: Date.now() + Math.floor(Math.random() * 10_000),
        userId: oldAssigneeId,
        actorId: actor.id,
        taskId: id,
        type: "task_updated",
        title: "Task reassigned",
        message: `${label} reassigned "${taskTitle}" to another team member`,
        read: false,
        createdAt: new Date(),
      } as (typeof notifications)[number]);
    }

    for (const lead of users.filter((u) => u.role === "admin" || u.role === "manager")) {
      if (
        lead.id === actor.id
        || lead.id === newAssigneeId
        || lead.id === oldAssigneeId
      ) {
        continue;
      }
      notifications.unshift({
        id: Date.now() + Math.floor(Math.random() * 10_000),
        userId: lead.id,
        actorId: actor.id,
        taskId: id,
        type: "task_updated",
        title: "Task assignee changed",
        message: `${label} updated assignee on "${taskTitle}"`,
        read: false,
        createdAt: new Date(),
      } as (typeof notifications)[number]);
    }
  }
  if (data.projectId !== undefined) {
    task.projectId = data.projectId ?? undefined;
  }
  if (data.estimatedHours !== undefined) {
    task.estimatedHours = data.estimatedHours != null ? String(data.estimatedHours) : null;
  }
  task.updatedAt = new Date();
  return task;
}

export function mockUpdateStatus(id: number, status: string, actor: SafeUser) {
  return mockUpdateTask(id, { status }, actor);
}

export function mockAddParticipant(taskId: number, userId: number, actor: SafeUser) {
  const user = userById(userId);
  if (!user) return { success: false };
  const list = taskParticipants[taskId] ?? (taskParticipants[taskId] = []);
  if (!list.find((p) => p.id === userId)) {
    list.push(user);
    const activities = taskActivities[taskId] ?? (taskActivities[taskId] = []);
    activities.unshift({
      id: Date.now(),
      taskId,
      userId: actor.id,
      action: "participant_added",
      oldValue: null,
      newValue: user.name,
      metadata: null,
      createdAt: new Date(),
      user: actor,
    });

    const task = tasks.find((t) => t.id === taskId);
    mockNotifyTaskMembers({
      taskId,
      actor,
      type: "task_updated",
      title: "Added as participant",
      message: `${mockActorLabel(actor)} added you as a participant on "${task?.title ?? "a task"}"`,
      extraRecipientIds: [userId],
      includeAssignee: false,
      includeOwner: false,
    });
  }
  return { success: true };
}

export function mockRemoveParticipant(taskId: number, userId: number) {
  const list = taskParticipants[taskId];
  if (!list) return { success: true };
  taskParticipants[taskId] = list.filter((p) => p.id !== userId);
  return { success: true };
}

export function mockAddObserver(
  taskId: number,
  userId: number,
  actor?: SafeUser,
  logActivity = true,
) {
  const task = tasks.find((t) => t.id === taskId);
  const user = userById(userId);
  if (!task || !user) return { success: false };
  if (task.assigneeId === userId) return { success: false };

  const list = taskObservers[taskId] ?? (taskObservers[taskId] = []);
  if (list.find((p) => p.id === userId)) return { success: true };

  list.push(user);

  if (logActivity && actor) {
    const activities = taskActivities[taskId] ?? (taskActivities[taskId] = []);
    activities.unshift({
      id: Date.now(),
      taskId,
      userId: actor.id,
      action: "observer_added",
      oldValue: null,
      newValue: user.name,
      metadata: null,
      createdAt: new Date(),
      user: actor,
    });

    mockNotifyTaskMembers({
      taskId,
      actor,
      type: "task_updated",
      title: "Added as observer",
      message: `${mockActorLabel(actor)} added you as an observer on "${task.title}"`,
      extraRecipientIds: [userId],
      includeAssignee: false,
      includeOwner: false,
    });
  }
  return { success: true };
}

export function mockRemoveObserver(taskId: number, userId: number) {
  const list = taskObservers[taskId];
  if (!list) return { success: true };
  taskObservers[taskId] = list.filter((p) => p.id !== userId);
  return { success: true };
}

export function mockProjectList(
  currentUserId = DEV_USER.id,
  options?: { status?: string; joinedOnly?: boolean },
) {
  let source = projects;
  if (options?.status) {
    source = source.filter((p) => p.status === options.status);
  }
  if (options?.joinedOnly) {
    source = source.filter((p) =>
      mockIsProjectMember(p.id, currentUserId, p.createdBy),
    );
  }

  return source.map((p) => {
    const projectTasks = tasks.filter((t) => t.projectId === p.id);
    const memberMap = new Map<number, SafeUser>();
    for (const t of projectTasks) {
      if (t.assigneeId) {
        memberMap.set(t.assigneeId, t.assignee ?? userById(t.assigneeId) ?? DEV_USER);
      }
      if (t.createdBy) {
        const creator = userById(t.createdBy);
        if (creator) memberMap.set(t.createdBy, creator);
      }
      for (const participant of taskParticipants[t.id] ?? []) {
        memberMap.set(participant.id, participant);
      }
    }
    if (p.createdBy) {
      const creator = userById(p.createdBy);
      if (creator) memberMap.set(p.createdBy, creator);
    }
    for (const key of projectMemberKeys) {
      const [pid, uid] = key.split(":").map(Number);
      if (pid !== p.id || uid == null) continue;
      const joined = userById(uid);
      if (joined) memberMap.set(uid, joined);
    }

    const lastTaskUpdate = projectTasks.reduce<Date | null>((max, t) => {
      const d = new Date(t.updatedAt);
      if (Number.isNaN(d.getTime())) return max;
      return !max || d > max ? d : max;
    }, null);

    const lastActiveAt = lastTaskUpdate ?? new Date(p.updatedAt);
    const taskCount = projectTasks.length;
    const completedCount = projectTasks.filter((t) => t.status === "done").length;
    const creator = userById(p.createdBy);

    return {
      ...p,
      taskCount,
      completedCount,
      creator: creator
        ? {
            id: creator.id,
            name: creator.name,
            avatar: creator.avatar,
            department: creator.department,
            position: creator.position,
          }
        : null,
      performance: projectPerformancePercent(taskCount, completedCount),
      lastActiveAt: lastActiveAt.toISOString(),
      members: [...memberMap.values()]
        .map((u) => ({
          id: u.id,
          name: u.name,
          avatar: u.avatar,
          department: u.department ?? null,
          position: u.position ?? null,
          role: u.role ?? null,
        }))
        .sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
        ),
      privacyType: "Public" as const,
    };
  });
}

export function mockProjectById(id: number, currentUserId = DEV_USER.id) {
  const project = projects.find((p) => p.id === id);
  if (!project) return null;

  const user = userById(currentUserId) ?? DEV_USER;
  const joined = mockIsProjectMember(id, currentUserId, project.createdBy);
  const canViewTasks = mockCanViewProjectTasks(user, project.createdBy, joined);

  const projectTasks = canViewTasks ? tasks.filter((t) => t.projectId === id) : [];
  const memberIds = new Set<number>();
  if (project.createdBy) memberIds.add(project.createdBy);
  for (const key of projectMemberKeys) {
    const [pid, uid] = key.split(":").map(Number);
    if (pid === id) memberIds.add(uid);
  }
  for (const t of projectTasks) {
    if (t.assigneeId) memberIds.add(t.assigneeId);
    if (t.createdBy) memberIds.add(t.createdBy);
    for (const p of taskParticipants[t.id] ?? []) memberIds.add(p.id);
    for (const o of taskObservers[t.id] ?? []) memberIds.add(o.id);
  }

  const dueDates = projectTasks
    .map((t) => t.dueDate)
    .filter((d): d is string => Boolean(d))
    .sort();

  const hoursTracked = projectTasks.reduce(
    (sum, t) => sum + parseFloat(String(t.actualHours ?? "0")),
    0,
  );

  return {
    ...project,
    customPipelineStages:
      (project as { customPipelineStages?: Array<{ key: string; label: string; color: string }> })
        .customPipelineStages ?? [],
    pipelineStageLabelOverrides:
      (project as { pipelineStageLabelOverrides?: Record<string, string> }).pipelineStageLabelOverrides ??
      {},
    hiddenPipelineStageKeys:
      (project as { hiddenPipelineStageKeys?: string[] }).hiddenPipelineStageKeys ?? [],
    pipelineStages: resolveMockPipelineStages(
      project as {
        customPipelineStages?: Array<{ key: string; label: string; color: string }> | null;
        pipelineStageLabelOverrides?: Record<string, string> | null;
        hiddenPipelineStageKeys?: string[] | null;
      },
    ),
    creator: userById(project.createdBy),
    stats: {
      total: projectTasks.length,
      todo: projectTasks.filter((t) => t.status === "todo").length,
      inProgress: projectTasks.filter((t) => t.status === "in_progress").length,
      review: projectTasks.filter((t) => t.status === "review").length,
      done: projectTasks.filter((t) => t.status === "done").length,
    },
    hoursTracked: Math.round(hoursTracked * 10) / 10,
    memberCount: memberIds.size || 1,
    dueDate: dueDates[0] ?? null,
    isMember: joined,
    canViewTasks,
  };
}

export function mockJoinProject(projectId: number, userId: number) {
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw new Error("Project not found");

  projectMemberKeys.add(mockMemberKey(projectId, userId));
  const user = userById(userId) ?? DEV_USER;
  const joined = mockIsProjectMember(projectId, userId, project.createdBy);

  return {
    success: true,
    isMember: joined,
    canViewTasks: mockCanViewProjectTasks(user, project.createdBy, joined),
  };
}

export function mockBulkTaskAction(
  input: {
    taskIds: number[];
    action: "delete" | "status" | "move_project";
    status?: "todo" | "in_progress" | "review" | "done";
    projectId?: number | null;
  },
  _user: SafeUser,
) {
  const ids = new Set(input.taskIds);
  if (input.action === "delete") {
    for (let i = tasks.length - 1; i >= 0; i--) {
      if (ids.has(tasks[i].id)) tasks.splice(i, 1);
    }
    return { success: true, affected: input.taskIds.length };
  }

  for (const task of tasks) {
    if (!ids.has(task.id)) continue;
    if (input.action === "status" && input.status) {
      task.status = input.status;
      task.stage = legacyStatusToStage(input.status) as typeof task.stage;
      if (input.status === "done") {
        task.assigneeId = undefined;
        task.assignee = undefined;
      }
    }
    if (input.action === "move_project") {
      task.projectId = input.projectId ?? null;
    }
    task.updatedAt = new Date();
  }

  return { success: true, affected: input.taskIds.length };
}

export function mockAddPipelineStage(
  projectId: number,
  label: string,
  color?: string,
) {
  const project = projects.find((p) => p.id === projectId) as
    | (typeof projects)[number] & {
        customPipelineStages?: Array<{ key: string; label: string; color: string }> | null;
        pipelineStageOrder?: string[] | null;
      }
    | undefined;
  if (!project) throw new Error("Project not found");

  const custom = [...(project.customPipelineStages ?? [])];
  const existing = resolveMockPipelineStages(project);
  const key = createPipelineStageKey(
    label,
    existing.map((s) => s.key),
  );
  const stage = {
    key,
    label: label.trim(),
    color: color ?? nextCustomStageColor(custom.length),
  };
  custom.push(stage);
  project.customPipelineStages = custom;
  project.pipelineStageOrder = [...existing.map((s) => s.key), stage.key];
  project.updatedAt = new Date();

  return {
    project,
    stage,
    stages: resolveMockPipelineStages(project),
    customPipelineStages: custom,
    pipelineStageOrder: project.pipelineStageOrder,
  };
}

export function mockRenamePipelineStage(
  projectId: number,
  key: string,
  label: string,
) {
  const project = projects.find((p) => p.id === projectId) as
    | (typeof projects)[number] & {
        customPipelineStages?: Array<{ key: string; label: string; color: string }> | null;
        pipelineStageLabelOverrides?: Record<string, string> | null;
      }
    | undefined;
  if (!project) throw new Error("Project not found");

  const stages = resolveMockPipelineStages(project);
  if (!stages.some((s) => s.key === key)) {
    throw new Error("Section not found on this project");
  }

  const nextLabel = label.trim();
  const overrides = { ...(project.pipelineStageLabelOverrides ?? {}) };
  overrides[key] = nextLabel;
  project.pipelineStageLabelOverrides = overrides;
  project.customPipelineStages = (project.customPipelineStages ?? []).map((stage) =>
    stage.key === key ? { ...stage, label: nextLabel } : stage,
  );
  project.updatedAt = new Date();

  return {
    project,
    key,
    label: nextLabel,
    stages: resolveMockPipelineStages(project),
    pipelineStageLabelOverrides: overrides,
  };
}

export function mockDeletePipelineStage(projectId: number, key: string) {
  const project = projects.find((p) => p.id === projectId) as
    | (typeof projects)[number] & {
        customPipelineStages?: Array<{ key: string; label: string; color: string }> | null;
        pipelineStageLabelOverrides?: Record<string, string> | null;
        hiddenPipelineStageKeys?: string[] | null;
        pipelineStageOrder?: string[] | null;
      }
    | undefined;
  if (!project) throw new Error("Project not found");

  if (!isPipelineStageDeletable(key)) {
    throw new Error("To Do and Finished sections cannot be deleted");
  }

  const stages = resolveMockPipelineStages(project);
  if (!stages.some((s) => s.key === key)) {
    throw new Error("Section not found on this project");
  }

  let movedTaskCount = 0;
  for (const task of tasks) {
    if (task.projectId === projectId && task.stage === key) {
      task.stage = "new";
      task.status = "todo";
      task.updatedAt = new Date();
      movedTaskCount += 1;
    }
  }

  const overrides = { ...(project.pipelineStageLabelOverrides ?? {}) };
  delete overrides[key];
  project.pipelineStageLabelOverrides = overrides;

  if (isCustomPipelineStageKey(key)) {
    project.customPipelineStages = (project.customPipelineStages ?? []).filter(
      (stage) => stage.key !== key,
    );
  } else {
    const hidden = [...(project.hiddenPipelineStageKeys ?? [])];
    if (!hidden.includes(key)) hidden.push(key);
    project.hiddenPipelineStageKeys = hidden;
  }
  project.pipelineStageOrder = (project.pipelineStageOrder ?? stages.map((s) => s.key)).filter(
    (stageKey) => stageKey !== key,
  );
  project.updatedAt = new Date();

  return {
    project,
    key,
    movedTaskCount,
    stages: resolveMockPipelineStages(project),
    customPipelineStages: project.customPipelineStages ?? [],
    pipelineStageLabelOverrides: overrides,
    hiddenPipelineStageKeys: project.hiddenPipelineStageKeys ?? [],
    pipelineStageOrder: project.pipelineStageOrder ?? [],
  };
}

export function mockReorderPipelineStage(
  projectId: number,
  key: string,
  direction: "left" | "right",
) {
  const project = projects.find((p) => p.id === projectId) as
    | (typeof projects)[number] & {
        pipelineStageOrder?: string[] | null;
      }
    | undefined;
  if (!project) throw new Error("Project not found");

  const stages = resolveMockPipelineStages(project);
  if (!stages.some((s) => s.key === key)) {
    throw new Error("Section not found on this project");
  }

  const pipelineStageOrder = movePipelineStageOrder(
    stages.map((s) => s.key),
    key,
    direction,
  );
  if (!pipelineStageOrder) {
    return {
      project,
      key,
      direction,
      stages,
      pipelineStageOrder: project.pipelineStageOrder ?? stages.map((s) => s.key),
    };
  }

  project.pipelineStageOrder = pipelineStageOrder;
  project.updatedAt = new Date();

  return {
    project,
    key,
    direction,
    stages: resolveMockPipelineStages(project),
    pipelineStageOrder,
  };
}

export function mockDeleteProject(id: number) {
  const projectIndex = projects.findIndex((p) => p.id === id);
  if (projectIndex === -1) return { success: false };

  projects.splice(projectIndex, 1);

  for (const key of [...projectMemberKeys]) {
    if (key.startsWith(`${id}:`)) projectMemberKeys.delete(key);
  }

  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].projectId === id) {
      const taskId = tasks[i].id;
      delete taskParticipants[taskId];
      delete taskObservers[taskId];
      tasks.splice(i, 1);
    }
  }

  return { success: true };
}

export function mockNotificationList(userId: number, unreadOnly = false) {
  const notifs = notifications.filter((n) => n.userId === userId);
  const filtered = unreadOnly ? notifs.filter((n) => !n.read) : notifs;
  return {
    notifications: filtered,
    unreadCount: notifs.filter((n) => !n.read).length,
  };
}

export function mockLatestNotificationId(userId: number) {
  const userNotifs = notifications.filter((n) => n.userId === userId);
  if (userNotifs.length === 0) return 0;
  return Math.max(...userNotifs.map((n) => n.id));
}

export function mockNotificationsSince(
  userId: number,
  sinceId: number,
  viewer?: { id?: number | null; name?: string | null; email?: string | null } | null,
) {
  const identity = viewer ?? users.find((u) => u.id === userId) ?? { id: userId };
  return notifications
    .filter((n) => n.userId === userId && n.id > sinceId)
    .sort((a, b) => a.id - b.id)
    .map((n) => personalizeNotificationCopy(n, identity));
}

export function mockMarkAllNotificationsRead(userId: number) {
  for (const n of notifications) {
    if (n.userId === userId) n.read = true;
  }
  return { success: true };
}

export function mockMarkNotificationRead(userId: number, id: number) {
  const notif = notifications.find((n) => n.id === id && n.userId === userId);
  if (notif) notif.read = true;
  return notif ?? null;
}

export function mockMarkTaskNotificationsRead(userId: number, taskId: number) {
  let count = 0;
  for (const n of notifications) {
    if (n.userId !== userId || n.read) continue;
    if (n.taskId === taskId) {
      n.read = true;
      count += 1;
    }
  }
  return { success: true, count };
}

export function mockDeleteNotification(userId: number, id: number) {
  const index = notifications.findIndex((n) => n.id === id && n.userId === userId);
  if (index >= 0) notifications.splice(index, 1);
  return { success: true };
}

function expireMockNoticePeriods() {
  const now = new Date();
  for (const user of users) {
    if (!user.onNoticePeriod || !user.noticePeriodEndsAt) continue;
    if (user.noticePeriodEndsAt.getTime() > now.getTime()) continue;
    user.onNoticePeriod = false;
    user.noticePeriodDays = null;
    user.noticePeriodEndsAt = null;
    user.status = "inactive";
    user.updatedAt = now;
  }
}

export function mockUserList() {
  expireMockNoticePeriods();
  const sorted = [...users].sort((a, b) => {
    const aOrder = a.sortOrder ?? a.id;
    const bOrder = b.sortOrder ?? b.id;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.id - b.id;
  });
  return { users: sorted.map((u) => ({ ...u })), total: sorted.length };
}

export function mockReorderUsers(orderedIds: number[]) {
  orderedIds.forEach((id, index) => {
    const user = users.find((u) => u.id === id);
    if (user) {
      user.sortOrder = index;
      user.updatedAt = new Date();
    }
  });
  return { success: true };
}

export function mockAdminUpdateUser(input: {
  id: number;
  name?: string;
  role?: "admin" | "manager" | "employee" | "hr" | "client" | "finance";
  status?: "active" | "inactive" | "suspended";
  department?: string | null;
  position?: string | null;
  phone?: string | null;
  permissions?: string[];
  clientCanViewTimeTracking?: boolean;
  clientCanViewDueDate?: boolean;
  assignedEmployeeIds?: number[];
}) {
  const user = userById(input.id);
  if (!user) return null;

  if (input.name !== undefined) user.name = input.name;
  if (input.role !== undefined) user.role = input.role;
  if (input.status !== undefined) user.status = input.status;
  if (input.department !== undefined) user.department = input.department;
  if (input.position !== undefined) user.position = input.position;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.permissions !== undefined) {
    const role = input.role ?? user.role;
    user.permissions =
      String(role).toLowerCase() === "client"
        ? input.permissions.filter((key) => key !== "invoices.manage")
        : input.permissions;
  }
  if (input.clientCanViewTimeTracking !== undefined) {
    user.clientCanViewTimeTracking = input.clientCanViewTimeTracking;
  }
  if (input.clientCanViewDueDate !== undefined) {
    user.clientCanViewDueDate = input.clientCanViewDueDate;
  }
  if (input.assignedEmployeeIds !== undefined) {
    user.assignedEmployeeIds = input.assignedEmployeeIds;
  }
  user.updatedAt = new Date();
  return { ...user };
}

export type ProfileUpdateInput = {
  name?: string;
  department?: string | null;
  position?: string | null;
  phone?: string | null;
  avatar?: string | null;
};

export function mockUpdateUserProfile(userId: number, data: ProfileUpdateInput) {
  const user = userById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  if (data.name !== undefined) user.name = data.name;
  if (data.department !== undefined) user.department = data.department;
  if (data.position !== undefined) user.position = data.position;
  if (data.phone !== undefined) user.phone = data.phone;
  if (data.avatar !== undefined) user.avatar = data.avatar;
  user.updatedAt = new Date();

  return { ...user };
}

export type PersonalInfoUpdateInput = {
  firstName?: string | null;
  lastName?: string | null;
  secondName?: string | null;
  email?: string;
  department?: string | null;
  position?: string | null;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  familyContactNumber?: string | null;
  personalEmail?: string | null;
  bloodGroup?: string | null;
  aadhaarCard?: string | null;
  panCard?: string | null;
  dateOfBirth?: string | null;
  dateOfJoining?: string | null;
  sex?: "male" | "female" | "other" | "prefer_not_to_say" | null;
  notificationLanguage?: string | null;
  headOfDepartmentUserIds?: number[];
  privateNotes?: string | null;
  employmentType?: "full_time" | "intern";
  onNoticePeriod?: boolean;
  noticePeriodDays?: number | null;
};

function mockPersonalRecord(
  user: SafeUser,
  options?: { includePrivateNotes?: boolean },
) {
  const parts = (user.name ?? "").trim().split(/\s+/);
  const firstName = user.firstName ?? parts[0] ?? null;
  const lastName = user.lastName ?? (parts.length > 1 ? parts.slice(1).join(" ") : null);
  const headIds = user.headOfDepartmentUserIds ?? [];
  return {
    firstName,
    lastName,
    secondName: user.secondName ?? null,
    email: user.email ?? null,
    position: user.position ?? null,
    department: user.department ?? null,
    phone: user.phone ?? null,
    city: user.city ?? null,
    address: user.address ?? null,
    familyContactNumber: user.familyContactNumber ?? null,
    personalEmail: user.personalEmail ?? null,
    bloodGroup: user.bloodGroup ?? null,
    aadhaarCard: user.aadhaarCard ?? null,
    panCard: user.panCard ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    dateOfJoining: user.dateOfJoining ?? null,
    sex: user.sex ?? null,
    notificationLanguage: user.notificationLanguage ?? "en",
    employmentType: user.employmentType === "intern" ? "intern" : "full_time",
    onNoticePeriod: Boolean(user.onNoticePeriod),
    noticePeriodDays: user.noticePeriodDays ?? null,
    noticePeriodEndsAt: user.noticePeriodEndsAt ?? null,
    headOfDepartmentUserIds: headIds,
    headsOfDepartment: headIds
      .map((id) => userById(id))
      .filter((u): u is SafeUser => Boolean(u))
      .map((u) => ({ id: u.id, name: u.name })),
    ...(options?.includePrivateNotes
      ? { privateNotes: privateNotesByUserId[user.id] ?? null }
      : {}),
  };
}

export function mockGetPersonalInfo(
  userId: number,
  options?: { includePrivateNotes?: boolean },
) {
  expireMockNoticePeriods();
  const user = userById(userId);
  if (!user) throw new Error("User not found");
  return mockPersonalRecord(user, options);
}

export function mockUpdatePersonalInfo(
  userId: number,
  data: PersonalInfoUpdateInput,
  options?: { includePrivateNotes?: boolean },
) {
  const user = userById(userId);
  if (!user) throw new Error("User not found");

  if (data.firstName !== undefined) user.firstName = data.firstName;
  if (data.lastName !== undefined) user.lastName = data.lastName;
  if (data.secondName !== undefined) user.secondName = data.secondName;
  if (data.email !== undefined) user.email = data.email;
  if (data.department !== undefined) user.department = data.department;
  if (data.position !== undefined) user.position = data.position;
  if (data.phone !== undefined) user.phone = data.phone;
  if (data.city !== undefined) user.city = data.city;
  if (data.address !== undefined) user.address = data.address;
  if (data.familyContactNumber !== undefined) {
    user.familyContactNumber = data.familyContactNumber;
  }
  if (data.personalEmail !== undefined) {
    user.personalEmail = data.personalEmail?.trim() || null;
  }
  if (data.bloodGroup !== undefined) user.bloodGroup = data.bloodGroup;
  if (data.aadhaarCard !== undefined) user.aadhaarCard = data.aadhaarCard;
  if (data.panCard !== undefined) user.panCard = data.panCard;
  if (data.sex !== undefined) user.sex = data.sex;
  if (data.notificationLanguage !== undefined) {
    user.notificationLanguage = data.notificationLanguage;
  }
  if (data.employmentType !== undefined) {
    user.employmentType = data.employmentType;
  }
  if (data.onNoticePeriod !== undefined) {
    const wasOnNotice = Boolean(user.onNoticePeriod);
    const previousDays = user.noticePeriodDays ?? null;
    if (data.onNoticePeriod) {
      const days = data.noticePeriodDays ?? previousDays;
      if (days == null || days < 1) {
        throw new Error("Enter how many days this employee must serve on notice.");
      }
      user.onNoticePeriod = true;
      user.noticePeriodDays = days;
      if (!wasOnNotice || days !== previousDays || !user.noticePeriodEndsAt) {
        user.noticePeriodEndsAt = noticePeriodEndsAt(days);
      }
    } else {
      user.onNoticePeriod = false;
      user.noticePeriodDays = null;
      user.noticePeriodEndsAt = null;
    }
  }
  if (data.headOfDepartmentUserIds !== undefined) {
    user.headOfDepartmentUserIds = data.headOfDepartmentUserIds;
  }
  if (data.dateOfBirth !== undefined) {
    const parts = data.dateOfBirth ? parseIsoDateOnly(data.dateOfBirth) : null;
    user.dateOfBirth = parts ? calendarYmdToUtcNoon(parts) : null;
  }
  if (data.dateOfJoining !== undefined) {
    const parts = data.dateOfJoining ? parseIsoDateOnly(data.dateOfJoining) : null;
    user.dateOfJoining = parts ? calendarYmdToUtcNoon(parts) : null;
  }
  if (options?.includePrivateNotes && data.privateNotes !== undefined) {
    privateNotesByUserId[userId] = data.privateNotes;
  }
  if (data.firstName !== undefined || data.lastName !== undefined) {
    const combined = [user.firstName, user.lastName].filter(Boolean).join(" ");
    if (combined) user.name = combined;
  }
  user.updatedAt = new Date();

  return mockPersonalRecord(user, options);
}

export function mockCurrentSession(userId: number) {
  mockRunAutoClockOutForUser(userId);
  const session = workSessionsByUser[userId];
  if (!session?.active) return null;
  const view = mockWorkSessionView(session);
  const existing = timeApprovalRequests.find(
    (r) => r.workSessionId === session.id && r.type === "clock_in",
  );
  return {
    ...view,
    clockInRequest: existing
      ? {
          id: existing.id,
          requestedClockIn: existing.requestedClockIn!,
          reason: existing.reason,
          status: existing.status,
        }
      : null,
    pendingClockInRequest:
      existing?.status === "pending"
        ? {
            id: existing.id,
            requestedClockIn: existing.requestedClockIn!,
            reason: existing.reason,
          }
        : null,
  };
}

export function mockClockIn(userId: number, note?: string) {
  const now = new Date();
  const existing = workSessionsByUser[userId];
  const orphanOpen = userWorkEntries.find(
    (e) => e.userId === userId && !e.clockOut && e.taskId == null,
  );
  if (existing?.active || orphanOpen) {
    if (existing?.active && isPastAutoClockOutDeadline(existing.startTime, now)) {
      mockRunAutoClockOutForUser(userId, now);
    } else {
      mockClockOut(userId, { note: "Clocked out for new session" });
    }
  }

  // Remove any leftover open attendance rows so only the new session remains.
  for (let i = userWorkEntries.length - 1; i >= 0; i--) {
    const e = userWorkEntries[i];
    if (e.userId === userId && !e.clockOut && e.taskId == null) {
      userWorkEntries.splice(i, 1);
    }
  }

  const sessionId = nextWorkEntryId++;
  workSessionsByUser[userId] = {
    id: sessionId,
    userId,
    startTime: now,
    endTime: null,
    active: true,
    paused: false,
    accumulatedWorkSeconds: 0,
    workSegmentStartedAt: now,
    breakStartedAt: null,
  };

  const entry: MockWorkEntry = {
    id: nextWorkEntryId++,
    userId,
    taskId: null,
    projectId: null,
    clockIn: now,
    clockOut: null,
    duration: null,
    durationSeconds: null,
    note: note || "Clocked in",
    source: "web",
    createdAt: now,
    updatedAt: now,
  };
  userWorkEntries.unshift(entry);

  return { entry, session: mockWorkSessionView(workSessionsByUser[userId]) };
}

export function mockClockOut(
  userId: number,
  input?: { note?: string; clockIn?: string; clockOut?: string },
) {
  const now = new Date();
  const clockOutTime = input?.clockOut ? new Date(input.clockOut) : now;
  const clockInTime = input?.clockIn ? new Date(input.clockIn) : undefined;

  if (Number.isNaN(clockOutTime.getTime())) {
    throw new Error("Invalid clock out time");
  }
  if (clockInTime && Number.isNaN(clockInTime.getTime())) {
    throw new Error("Invalid clock in time");
  }
  if (clockOutTime.getTime() > now.getTime()) {
    throw new Error("Clock out time cannot be in the future");
  }

  const session = workSessionsByUser[userId];
  const openEntries = userWorkEntries
    .filter((e) => e.userId === userId && !e.clockOut && e.taskId == null)
    .sort(
      (a, b) =>
        a.clockIn.getTime() - b.clockIn.getTime() || a.id - b.id,
    );
  const openEntry = openEntries[0];

  const effectiveClockIn = clockInTime ?? openEntry?.clockIn ?? session?.startTime;
  if (!effectiveClockIn) {
    throw new Error("No active clock-in session found");
  }
  if (clockOutTime.getTime() <= effectiveClockIn.getTime()) {
    throw new Error("Clock out time must be after clock in time");
  }

  let durationSeconds = 0;
  if (session?.active) {
    if (session.paused) {
      const openBreak = (workBreaksByUser[userId] ?? []).find(
        (b) => b.workSessionId === session.id && !b.endTime,
      );
      if (openBreak) {
        openBreak.endTime = clockOutTime;
        openBreak.updatedAt = now;
      }
    }
    const breaks = mockFindBreaksOverlappingWindow(
      userId,
      effectiveClockIn,
      clockOutTime,
    );
    durationSeconds = computeAttendanceWorkSeconds(
      effectiveClockIn,
      clockOutTime,
      breaks,
      now,
    );
    session.active = false;
    session.endTime = clockOutTime;
    session.paused = false;
    session.workSegmentStartedAt = null;
    session.breakStartedAt = null;
    if (clockInTime) session.startTime = clockInTime;
  }

  if (openEntry) {
    if (clockInTime) openEntry.clockIn = clockInTime;
    if (!durationSeconds) {
      const breaks = mockFindBreaksOverlappingWindow(
        userId,
        openEntry.clockIn,
        clockOutTime,
      );
      durationSeconds = computeAttendanceWorkSeconds(
        openEntry.clockIn,
        clockOutTime,
        breaks,
        now,
      );
    }
    openEntry.clockOut = clockOutTime;
    openEntry.durationSeconds = durationSeconds;
    openEntry.duration = Math.floor(durationSeconds / 60);
    openEntry.updatedAt = now;
    if (input?.note) {
      openEntry.note = openEntry.note
        ? `${openEntry.note} - ${input.note}`
        : input.note;
    }
  }

  // Drop duplicate open attendance rows instead of leaving zero-duration junk.
  for (const dup of openEntries.slice(1)) {
    const idx = userWorkEntries.findIndex((e) => e.id === dup.id);
    if (idx >= 0) userWorkEntries.splice(idx, 1);
  }

  return {
    durationSeconds,
    duration: Math.floor(durationSeconds / 60),
    entry: openEntry ? { ...openEntry } : null,
  };
}

export function mockRunAutoClockOutForUser(userId: number, now = new Date()) {
  const session = workSessionsByUser[userId];
  if (!session?.active) return null;
  if (!isPastAutoClockOutDeadline(session.startTime, now)) return null;

  const deadline = getAutoClockOutDeadline(session.startTime);
  return mockClockOut(userId, {
    clockOut: deadline.toISOString(),
    note: "Auto clock-out at 10:00 PM",
  });
}

export function mockRunAutoClockOutJob(now = new Date()) {
  const results = [];
  for (const session of Object.values(workSessionsByUser)) {
    if (!session.active) continue;
    const result = mockRunAutoClockOutForUser(session.userId, now);
    if (result) results.push(result);
  }
  return results;
}

export function mockPauseWorkSession(userId: number) {
  const session = workSessionsByUser[userId];
  if (!session?.active || session.paused || !session.workSegmentStartedAt) {
    throw new Error("No active work session to pause");
  }

  session.accumulatedWorkSeconds += Math.floor(
    (Date.now() - session.workSegmentStartedAt.getTime()) / 1000,
  );
  const breakStart = new Date();
  session.workSegmentStartedAt = null;
  session.breakStartedAt = breakStart;
  session.paused = true;

  const openEntry = userWorkEntries.find(
    (e) => e.userId === userId && !e.clockOut && e.taskId == null,
  );
  const list = workBreaksByUser[userId] ?? (workBreaksByUser[userId] = []);
  list.push({
    id: nextWorkBreakId++,
    userId,
    workSessionId: session.id,
    timeEntryId: openEntry?.id ?? null,
    startTime: breakStart,
    endTime: null,
    reason: null,
    manuallyEdited: false,
    createdAt: breakStart,
    updatedAt: breakStart,
  });

  return mockWorkSessionView(session);
}

export function mockResumeWorkSession(userId: number) {
  const session = workSessionsByUser[userId];
  if (!session?.active || !session.paused) {
    throw new Error("Work session is not paused");
  }

  const resumeTime = new Date();
  session.workSegmentStartedAt = resumeTime;
  session.breakStartedAt = null;
  session.paused = false;

  const openBreak = (workBreaksByUser[userId] ?? []).find(
    (b) => b.workSessionId === session.id && !b.endTime,
  );
  if (openBreak) {
    openBreak.endTime = resumeTime;
    openBreak.updatedAt = resumeTime;
  }

  return mockWorkSessionView(session);
}

export function mockTimeEntryList(userId: number, opts?: { limit?: number }) {
  const limit = opts?.limit ?? 50;
  const completed = allUserTimeEntries(userId);
  const openEntry = userWorkEntries.find(
    (e) => e.userId === userId && !e.clockOut && e.taskId == null,
  );
  const entries = openEntry
    ? [openEntry, ...completed.filter((e) => e.id !== openEntry.id)]
    : completed;

  return {
    entries: entries.slice(0, limit),
    total: entries.length,
  };
}

export function mockTimeStats(userId: number, period: "today" | "week" | "month" = "week") {
  const now = new Date();
  const { start, end } = periodClockInBounds(period, now);
  const entries = filterMeaningfulAttendanceEntries(
    allUserTimeEntries(userId).filter(
      (e) =>
        e.taskId == null &&
        e.clockOut &&
        e.clockIn >= start &&
        e.clockIn <= end,
    ),
  );

  const dailyMapSeconds = new Map<string, number>();
  for (const e of entries) {
    const date = localDateKey(e.clockIn);
    const breaks = mockFindBreaksOverlappingWindow(userId, e.clockIn, e.clockOut!);
    const seconds = resolveAttendanceDisplaySeconds(e, breaks, now);
    dailyMapSeconds.set(date, (dailyMapSeconds.get(date) ?? 0) + seconds);
  }

  const session = workSessionsByUser[userId];
  let activeSession: { date: string; workSeconds: number } | null = null;

  if (session?.active && session.startTime >= start && session.startTime <= end) {
    const sessionDate = localDateKey(session.startTime);
    const breaks = mockFindBreaksOverlappingWindow(userId, session.startTime, now);
    const workSeconds = computeAttendanceWorkSeconds(
      session.startTime,
      now,
      breaks,
      now,
    );
    dailyMapSeconds.set(
      sessionDate,
      (dailyMapSeconds.get(sessionDate) ?? 0) + workSeconds,
    );
    activeSession = { date: sessionDate, workSeconds };
  }

  const totalSeconds = Array.from(dailyMapSeconds.values()).reduce((sum, s) => sum + s, 0);
  const dailyMapMinutes = new Map(
    Array.from(dailyMapSeconds.entries()).map(([date, seconds]) => [date, seconds / 60]),
  );
  const rangeStartKey = localDateKey(start);
  const rangeEndKey = localDateKey(end);
  const leaveByDate = buildLeaveCoverageMap(
    leaveRequests.filter(
      (r) =>
        r.userId === userId &&
        r.status === "approved" &&
        r.startDate <= rangeEndKey &&
        r.endDate >= rangeStartKey,
    ),
  );
  const summary = buildTimeStatsSummary(totalSeconds / 60, dailyMapMinutes, period, {
    leaveByDate,
    referenceDate: now,
  });

  return {
    ...summary,
    totalSeconds,
    entriesCount: entries.length,
    activeSession,
  };
}

export function mockMonthAttendance(
  userId: number,
  year: number,
  month: number,
  now = new Date(),
) {
  const { end, endKey } = calendarMonthBounds(year, month);
  const lookbackStart = workZoneWallTimeToUtc(year, month, 1 - 14, 0, 0, 0, 0);
  const lookbackStartKey = localDateKey(lookbackStart);

  const entries = allUserTimeEntries(userId).filter(
    (e) =>
      e.taskId == null &&
      e.clockIn >= lookbackStart &&
      e.clockIn <= end,
  );

  const breaks = mockFindBreaksOverlappingWindow(userId, lookbackStart, end);
  const leaveByDate = buildLeaveCoverageMap(
    leaveRequests.filter(
      (r) =>
        r.userId === userId &&
        r.status === "approved" &&
        r.startDate <= endKey &&
        r.endDate >= lookbackStartKey,
    ),
  );

  const session = workSessionsByUser[userId];
  let liveSession: { startTime: Date; workSeconds: number } | null = null;
  if (
    session?.active &&
    session.startTime >= lookbackStart &&
    session.startTime <= end
  ) {
    const workSeconds = computeAttendanceWorkSeconds(
      session.startTime,
      now,
      mockFindBreaksOverlappingWindow(userId, session.startTime, now),
      now,
    );
    liveSession = { startTime: session.startTime, workSeconds };
  }

  const days = buildDaySnapshotsFromEntries({
    userId,
    entries,
    breaks: breaks.map((b) => ({
      userId,
      startTime: b.startTime,
      endTime: b.endTime,
    })),
    leaveByDate,
    now,
    liveSession,
  });

  return classifyMonthAttendance(year, month, days, {
    asOf: now,
    leaves: leaveRequests.filter(
      (r) =>
        r.userId === userId &&
        r.status === "approved" &&
        r.startDate <= endKey &&
        r.endDate >= lookbackStartKey,
    ),
    holidayDateKeys: mockListPublicHolidays(year)
      .holidays.filter((h) => h.date.startsWith(`${year}-${String(month).padStart(2, "0")}-`))
      .map((h) => h.date),
  });
}

export function mockTeamMonthAttendance(
  year: number,
  month: number,
  now = new Date(),
) {
  return users
    .filter((u) => isAttendanceTrackableUser(u))
    .map((user) => ({
      userId: user.id,
      name: user.name || "Unknown",
      email: user.email ?? null,
      avatar: user.avatar ?? null,
      department: user.department ?? null,
      role: user.role,
      attendance: mockMonthAttendance(user.id, year, month, now),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mockDayEntriesForUser(userId: number, dateStr: string, now = new Date()) {
  const { start, end } = dayBounds(dateStr);
  const dayEntries = userWorkEntries.filter(
    (e) =>
      e.userId === userId &&
      e.taskId == null &&
      e.clockIn >= start &&
      e.clockIn <= end,
  );

  const openEntries = dayEntries.filter((e) => !e.clockOut);
  const openAttendance =
    openEntries.length === 0
      ? undefined
      : openEntries.reduce((best, entry) =>
          entry.clockIn.getTime() < best.clockIn.getTime() ||
          (entry.clockIn.getTime() === best.clockIn.getTime() && entry.id < best.id)
            ? entry
            : best,
        );

  const meaningful = filterMeaningfulAttendanceEntries(dayEntries);
  const completed = meaningful.filter((e) => e.clockOut);
  const entries = filterMeaningfulAttendanceEntries(
    openAttendance ? [...completed, openAttendance] : completed,
  );

  let attendanceLiveSeconds = 0;
  const session = workSessionsByUser[userId];
  if (session?.active && localDateKey(session.startTime) === dateStr) {
    attendanceLiveSeconds = workSessionTiming(session, now).workElapsedSeconds;
  } else if (openAttendance) {
    const breaks = mockFindBreaksOverlappingWindow(
      userId,
      openAttendance.clockIn,
      now,
    );
    attendanceLiveSeconds = computeAttendanceWorkSeconds(
      openAttendance.clockIn,
      now,
      breaks,
      now,
    );
  }

  const enrichedEntries = entries.map((entry) => {
    let durationSeconds: number | null;
    if (entry.clockOut) {
      const entryBreaks = mockFindBreaksOverlappingWindow(
        userId,
        entry.clockIn,
        entry.clockOut,
      );
      durationSeconds = resolveAttendanceDisplaySeconds(entry, entryBreaks, now);
    } else {
      durationSeconds =
        openAttendance?.id === entry.id && attendanceLiveSeconds > 0
          ? attendanceLiveSeconds
          : null;
    }
    return {
      id: entry.id,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      durationSeconds,
      duration: durationSeconds != null ? Math.floor(durationSeconds / 60) : null,
      note: entry.note,
    };
  });

  const totalSeconds = enrichedEntries.reduce(
    (sum, entry) => sum + (entry.durationSeconds ?? 0),
    0,
  );
  const dayBreaks = mockFindBreaksOverlappingWindow(userId, start, end);
  const breakSeconds = sumBreakSecondsInWindow(dayBreaks, start, end, now);
  const sortedEntries = [...enrichedEntries].sort(
    (a, b) => a.clockIn.getTime() - b.clockIn.getTime(),
  );
  const stillOpen = sortedEntries.some((entry) => !entry.clockOut);
  const clockOut = stillOpen
    ? null
    : sortedEntries.reduce<Date | null>((latest, entry) => {
        if (!entry.clockOut) return latest;
        if (!latest || entry.clockOut.getTime() > latest.getTime()) return entry.clockOut;
        return latest;
      }, null);

  return {
    entries: enrichedEntries,
    clockIn: sortedEntries[0]?.clockIn ?? null,
    clockOut,
    totalMinutes: totalSeconds / 60,
    totalSeconds,
    totalHours: roundHours(totalSeconds / 3600),
    breakSeconds,
    breakMinutes: Math.floor(breakSeconds / 60),
    breakHours: roundHours(breakSeconds / 3600),
    entriesCount: enrichedEntries.length,
  };
}

function sumAttendanceDaySeconds(
  entries: Array<MockWorkEntry>,
  attendanceLiveSeconds: number,
) {
  let totalSeconds = 0;

  for (const entry of entries) {
    if (entry.clockOut) {
      totalSeconds += attendanceEntrySeconds(entry);
    }
  }

  // Live session time must only be counted once.
  if (attendanceLiveSeconds > 0) {
    totalSeconds += attendanceLiveSeconds;
  }

  return totalSeconds;
}

function displayAttendanceDurationSeconds(
  entry: MockWorkEntry,
  attendanceLiveSeconds: number,
) {
  if (entry.clockOut) return attendanceEntrySeconds(entry);
  if (!entry.clockOut && attendanceLiveSeconds > 0) {
    return attendanceLiveSeconds;
  }
  return null;
}

export function mockFindBreaksOverlappingWindow(
  userId: number,
  windowStart: Date,
  windowEnd: Date,
) {
  return (workBreaksByUser[userId] ?? []).filter(
    (b) =>
      b.startTime.getTime() < windowEnd.getTime() &&
      ((b.endTime && b.endTime.getTime() > windowStart.getTime()) || !b.endTime),
  );
}

export function mockRefreshAttendanceEntriesOverlappingBreak(
  userId: number,
  breakStart: Date,
  breakEnd: Date,
  now = new Date(),
) {
  const entries = allUserTimeEntries(userId).filter(
    (e) =>
      e.taskId == null &&
      e.clockOut &&
      e.clockOut.getTime() > breakStart.getTime() &&
      e.clockIn.getTime() < breakEnd.getTime(),
  );
  for (const entry of entries) {
    if (!entry.clockOut) continue;
    const breaks = mockFindBreaksOverlappingWindow(userId, entry.clockIn, entry.clockOut);
    entry.durationSeconds = computeAttendanceWorkSeconds(
      entry.clockIn,
      entry.clockOut,
      breaks,
      now,
    );
    entry.duration = Math.floor(entry.durationSeconds / 60);
  }
}

export function mockResyncActiveSessionFromBreaks(userId: number, now = new Date()) {
  const session = workSessionsByUser[userId];
  if (!session?.active) return;
  const breaks = mockFindBreaksOverlappingWindow(userId, session.startTime, now);
  const workSeconds = computeAttendanceWorkSeconds(
    session.startTime,
    now,
    breaks,
    now,
  );
  if (session.paused) {
    session.accumulatedWorkSeconds = workSeconds;
    session.workSegmentStartedAt = null;
  } else {
    session.accumulatedWorkSeconds = workSeconds;
    session.workSegmentStartedAt = now;
  }
}

export function mockCreateBreak(
  actor: SafeUser,
  input: {
    userId?: number;
    startTime: string;
    endTime: string;
    reason: string;
  },
) {
  const targetUserId =
    input.userId && actor.role === "admin" ? input.userId : actor.id;
  if (input.userId && input.userId !== actor.id && actor.role !== "admin") {
    throw new Error("Not allowed to add a break for this user");
  }

  const startTime = new Date(input.startTime);
  const endTime = new Date(input.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw new Error("Invalid break times");
  }
  if (endTime <= startTime) {
    throw new Error("Break end must be after break start");
  }
  if (endTime.getTime() > Date.now()) {
    throw new Error("Break end cannot be in the future");
  }

  const entry = allUserTimeEntries(targetUserId).find(
    (e) =>
      e.taskId == null &&
      e.clockIn.getTime() < endTime.getTime() &&
      ((e.clockOut && e.clockOut.getTime() > startTime.getTime()) || !e.clockOut),
  );
  const openEntry = userWorkEntries.find(
    (e) => e.userId === targetUserId && !e.clockOut && e.taskId == null,
  );
  const attendance = entry ?? openEntry;
  if (!attendance) {
    throw new Error(
      "No attendance entry covers this break time. You must have been clocked in.",
    );
  }

  const session = workSessionsByUser[targetUserId];
  const sessionOk =
    session &&
    session.startTime.getTime() < endTime.getTime() &&
    ((session.endTime && session.endTime.getTime() > startTime.getTime()) ||
      session.active ||
      !session.endTime);
  if (!sessionOk) {
    throw new Error(
      "No work session found for that time. Add the break while the day still has a session, or contact admin.",
    );
  }

  const now = new Date();
  const list = workBreaksByUser[targetUserId] ?? (workBreaksByUser[targetUserId] = []);
  const created = {
    id: nextWorkBreakId++,
    userId: targetUserId,
    workSessionId: session.id,
    timeEntryId: attendance.id,
    startTime,
    endTime,
    reason: input.reason.trim(),
    manuallyEdited: true,
    createdAt: now,
    updatedAt: now,
  };
  list.push(created);
  list.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  mockRefreshAttendanceEntriesOverlappingBreak(targetUserId, startTime, endTime, now);
  mockResyncActiveSessionFromBreaks(targetUserId, now);

  return { ...created, requiresApproval: false };
}

export function mockGetBreaksForWindow(userId: number, windowStart: Date, windowEnd: Date) {
  const breaks = mockFindBreaksOverlappingWindow(userId, windowStart, windowEnd);
  const pendingByBreakId = new Map(
    timeApprovalRequests
      .filter(
        (r) =>
          r.userId === userId &&
          r.type === "break" &&
          r.status === "pending" &&
          r.workBreakId,
      )
      .map((r) => [r.workBreakId!, r]),
  );

  return {
    breaks: breaks
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .map((b) => {
        const pending = pendingByBreakId.get(b.id);
        return {
          ...b,
          pendingEdit: pending
            ? {
                id: pending.id,
                requestedBreakStart: pending.requestedBreakStart!,
                requestedBreakEnd: pending.requestedBreakEnd,
                reason: pending.reason,
              }
            : null,
        };
      }),
  };
}

export function mockGetBreaks(userId: number, dateStr: string) {
  const { start, end } = dayBounds(dateStr);
  return mockGetBreaksForWindow(userId, start, end);
}

export function mockUpdateBreak(
  actor: SafeUser,
  input: { id: number; startTime: string; endTime?: string | null; reason: string },
) {
  const list = workBreaksByUser[actor.id] ?? [];
  const existing = list.find((b) => b.id === input.id);
  if (!existing && actor.role === "admin") {
    for (const breaks of Object.values(workBreaksByUser)) {
      const found = breaks.find((b) => b.id === input.id);
      if (found) {
        return mockUpdateBreakForBreak(actor, found, input);
      }
    }
  }
  if (!existing) throw new Error("Break not found");
  if (existing.userId !== actor.id && actor.role !== "admin") {
    throw new Error("Not allowed to edit this break");
  }
  return mockUpdateBreakForBreak(actor, existing, input);
}

function mockUpdateBreakForBreak(
  actor: SafeUser,
  existing: {
    id: number;
    userId: number;
    workSessionId: number;
    startTime: Date;
    endTime: Date | null;
    reason: string | null;
    manuallyEdited: boolean;
    updatedAt: Date;
  },
  input: { id: number; startTime: string; endTime?: string | null; reason: string },
) {
  const startTime = new Date(input.startTime);
  const endTime = input.endTime ? new Date(input.endTime) : null;
  if (endTime && endTime <= startTime) {
    throw new Error("Break end must be after break start");
  }
  if (endTime && endTime.getTime() > Date.now()) {
    throw new Error("Break end cannot be in the future");
  }

  const wasOpen = !existing.endTime;
  const previousStart = existing.startTime;
  const previousEnd = existing.endTime;
  existing.startTime = startTime;
  existing.endTime = endTime;
  existing.reason = input.reason.trim();
  existing.manuallyEdited = true;
  existing.updatedAt = new Date();

  const session = Object.values(workSessionsByUser).find(
    (s) => s.id === existing.workSessionId && s.active,
  );
  if (session?.paused && session.breakStartedAt) {
    if (wasOpen && endTime) {
      session.workSegmentStartedAt = endTime;
      session.breakStartedAt = null;
      session.paused = false;
    } else if (!endTime) {
      session.breakStartedAt = startTime;
    }
  }

  for (const request of timeApprovalRequests) {
    if (
      request.workBreakId === input.id &&
      request.type === "break" &&
      request.status === "pending"
    ) {
      request.status = "approved";
      request.reviewedBy = actor.id;
      request.reviewedAt = new Date();
      request.reviewNote = "Applied directly by employee (approval no longer required)";
      request.updatedAt = new Date();
    }
  }

  const refreshEnd = endTime ?? new Date();
  mockRefreshAttendanceEntriesOverlappingBreak(
    existing.userId,
    startTime,
    refreshEnd,
  );
  mockRefreshAttendanceEntriesOverlappingBreak(
    existing.userId,
    previousStart,
    previousEnd ?? refreshEnd,
  );
  mockResyncActiveSessionFromBreaks(existing.userId);

  return { ...existing, requiresApproval: false };
}

/** @deprecated Use mockUpdateBreak — kept for older callers. */
export function mockRequestBreakEdit(
  actor: SafeUser,
  input: { id: number; startTime: string; endTime?: string | null; reason: string },
) {
  return mockUpdateBreak(actor, input);
}

export function mockUpdateAttendanceEntry(
  actor: SafeUser,
  input: { id: number; clockIn: string; clockOut: string; breakMinutes?: number; reason: string },
) {
  const entry = userWorkEntries.find(
    (e) => e.id === input.id && e.taskId == null,
  );
  if (!entry) throw new Error("Attendance entry not found");
  if (entry.userId !== actor.id && actor.role !== "admin") {
    throw new Error("Not allowed to edit this attendance entry");
  }
  if (!entry.clockOut) {
    throw new Error("Cannot edit an active session — clock out first");
  }

  const clockIn = new Date(input.clockIn);
  const clockOut = new Date(input.clockOut);
  if (Number.isNaN(clockIn.getTime()) || Number.isNaN(clockOut.getTime())) {
    throw new Error("Invalid clock in or clock out time");
  }
  if (clockOut <= clockIn) {
    throw new Error("Clock out must be after clock in");
  }
  if (clockOut.getTime() > Date.now()) {
    throw new Error("Clock out time cannot be in the future");
  }

  let durationSeconds: number;
  if (input.breakMinutes != null) {
    const spanSeconds = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000);
    const breakSeconds = Math.min(input.breakMinutes * 60, spanSeconds);
    durationSeconds = Math.max(0, spanSeconds - breakSeconds);
  } else {
    durationSeconds = computeAttendanceWorkSeconds(
      clockIn,
      clockOut,
      mockFindBreaksOverlappingWindow(entry.userId, clockIn, clockOut),
      new Date(),
    );
  }
  const now = new Date();
  const originalClockIn = entry.clockIn;

  entry.clockIn = clockIn;
  entry.clockOut = clockOut;
  entry.durationSeconds = durationSeconds;
  entry.duration = Math.floor(durationSeconds / 60);
  entry.note = entry.note
    ? `${entry.note} — ${input.reason.trim()}`
    : input.reason.trim();
  entry.updatedAt = now;

  const session = Object.values(workSessionsByUser).find(
    (s) =>
      s.userId === entry.userId &&
      !s.active &&
      s.startTime.getTime() === originalClockIn.getTime(),
  );
  if (session) {
    session.startTime = clockIn;
    session.endTime = clockOut;
  }

  return { ...entry };
}

export function mockRequestManualClockIn(
  actor: SafeUser,
  input: { requestedClockIn: string; reason: string },
) {
  const session = workSessionsByUser[actor.id];
  if (!session?.active) throw new Error("You must be clocked in to request a manual clock-in time");

  const openEntry = userWorkEntries.find(
    (e) => e.userId === actor.id && !e.clockOut && e.taskId == null,
  );
  const actualClockIn = openEntry?.clockIn ?? session.startTime;
  const requestedClockIn = new Date(input.requestedClockIn);

  if (requestedClockIn >= actualClockIn) {
    throw new Error("Manual clock-in time must be earlier than your actual clock-in time");
  }
  if (localDateKey(requestedClockIn) !== localDateKey(actualClockIn)) {
    throw new Error("Manual clock-in must be on the same day as your session");
  }

  const existingRequest = timeApprovalRequests.find(
    (r) => r.workSessionId === session.id && r.type === "clock_in",
  );
  if (existingRequest) {
    throw new Error("You have already submitted a manual clock-in request for this session");
  }

  const now = new Date();
  const request: MockTimeApprovalRequest = {
    id: nextApprovalId++,
    userId: actor.id,
    type: "clock_in",
    status: "pending",
    reason: input.reason.trim(),
    workSessionId: session.id,
    timeEntryId: openEntry?.id ?? null,
    workBreakId: null,
    originalClockIn: actualClockIn,
    originalBreakStart: null,
    originalBreakEnd: null,
    requestedClockIn,
    requestedBreakStart: null,
    requestedBreakEnd: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: now,
    updatedAt: now,
  };
  timeApprovalRequests.unshift(request);

  const actorName = actor.name || actor.email || "An employee";
  const requestedLabel = formatWorkZoneTime(requestedClockIn, {
    hour: "numeric",
    minute: "2-digit",
  });
  const actualLabel = formatWorkZoneTime(actualClockIn, {
    hour: "numeric",
    minute: "2-digit",
  });
  mockNotifyAdmins(
    actor,
    "Manual clock-in needs approval",
    `${actorName} requests clock-in at ${requestedLabel} instead of ${actualLabel}: ${input.reason.trim()}`,
    request.id,
  );

  return { ...request, requiresApproval: true };
}

export function mockListPendingApprovals() {
  return {
    requests: timeApprovalRequests
      .filter((r) => r.status === "pending")
      .map((r) => ({
        ...r,
        user: userById(r.userId),
      })),
  };
}

export function mockReviewTimeApproval(
  actor: SafeUser,
  input: { id: number; action: "approve" | "reject"; reviewNote?: string },
) {
  const request = timeApprovalRequests.find((r) => r.id === input.id);
  if (!request) throw new Error("Approval request not found");
  if (request.status !== "pending") throw new Error("This request has already been reviewed");

  const approved = input.action === "approve";
  if (approved) {
    if (request.type === "clock_in") {
      const session = request.workSessionId
        ? workSessionsByUser[request.userId]
        : undefined;
      if (!session) throw new Error("Work session not found");
      const entry = request.timeEntryId
        ? userWorkEntries.find((e) => e.id === request.timeEntryId)
        : undefined;
      mockApplyClockInApproval(request, session, entry);
    } else if (request.type === "break") {
      const list = workBreaksByUser[request.userId] ?? [];
      const breakItem = list.find((b) => b.id === request.workBreakId);
      if (!breakItem || !request.requestedBreakStart) throw new Error("Break not found");
      breakItem.startTime = request.requestedBreakStart;
      breakItem.endTime = request.requestedBreakEnd;
      breakItem.reason = request.reason;
      breakItem.manuallyEdited = true;
      breakItem.updatedAt = new Date();

      const session = workSessionsByUser[request.userId];
      if (session?.active && session.paused && session.breakStartedAt && !breakItem.endTime) {
        session.breakStartedAt = request.requestedBreakStart;
      }
    }
  }

  request.status = approved ? "approved" : "rejected";
  request.reviewedBy = actor.id;
  request.reviewedAt = new Date();
  request.reviewNote = input.reviewNote?.trim() || null;
  request.updatedAt = new Date();

  const employee = userById(request.userId);
  notifications.unshift({
    id: Date.now() + Math.random(),
    userId: request.userId,
    actorId: actor.id,
    taskId: null,
    type: approved ? "time_approved" : "time_rejected",
    title: approved ? "Time adjustment approved" : "Time adjustment rejected",
    message: approved
      ? `Your ${request.type === "clock_in" ? "manual clock-in" : "break edit"} request has been approved.`
      : `Your ${request.type === "clock_in" ? "manual clock-in" : "break edit"} request has been rejected.${input.reviewNote ? ` Note: ${input.reviewNote.trim()}` : ""}`,
    read: false,
    createdAt: new Date(),
  } as (typeof notifications)[number] & { actorId: number });

  return { success: true, approved, employeeName: employee?.name || "Employee" };
}

export function mockGetDayHours(userId: number, dateStr: string) {
  return mockDayEntriesForUser(userId, dateStr);
}

export function mockTeamHours(input?: { date?: string; startDate?: string; endDate?: string }) {
  const dateStr = input?.date ?? localDateKey(new Date());
  return users
    .filter((user) => isAttendanceTrackableUser(user))
    .map((user) => {
    const day = mockDayEntriesForUser(user.id, dateStr);
    return {
      userId: user.id,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      totalHours: day.totalHours,
      breakHours: day.breakHours,
      breakSeconds: day.breakSeconds,
      entriesCount: day.entriesCount,
      clockIn: day.clockIn ?? null,
      clockOut: day.clockOut ?? null,
    };
  });
}

export function mockAdminStats() {
  const weeklyMinutes = users.reduce((sum, user) => {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const minutes = allUserTimeEntries(user.id)
      .filter((e) => e.clockOut && e.clockIn >= weekAgo)
      .reduce((s, e) => s + (e.duration ?? 0), 0);
    return sum + minutes;
  }, 0);

  return {
    totalEmployees: users.length,
    activeProjects: projects.filter((p) => p.status === "active").length,
    totalTasks: tasks.length,
    weeklyHours: Math.round((weeklyMinutes / 60) * 10) / 10,
    activeClockIns: Object.values(workSessionsByUser).filter((s) => s.active).length,
  };
}

export function mockAssignedTaskStatusCounts() {
  const assigned = tasks.filter((t) => t.assigneeId != null);
  const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
  for (const task of assigned) {
    if (task.status in counts) {
      counts[task.status as keyof typeof counts] += 1;
    }
  }
  return assignedTaskStatusCountRows(counts, mergeTaskStatusLabels(mockTaskStatusLabels));
}

export function mockActiveClockIns() {
  return Object.values(workSessionsByUser)
    .filter((s) => s.active)
    .map((session) => {
      const user = userById(session.userId);
      return {
        sessionId: session.id,
        userId: session.userId,
        name: user?.name || "Unknown",
        avatar: user?.avatar ?? null,
        role: user?.role ?? "employee",
        department: user?.department ?? null,
        startTime: session.startTime,
        paused: !!session.paused,
        workElapsedSeconds: workSessionTiming(session).workElapsedSeconds,
      };
    });
}

export function mockUpcomingBirthdays() {
  const todayLabel = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
  const inDaysLabel = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };
  return [
    {
      id: 2,
      name: "Sarah Chen",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
      position: "Engineering Lead",
      daysLeft: 0,
      dateLabel: todayLabel,
      isToday: true,
    },
    {
      id: 4,
      name: "Emily Rodriguez",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Emily",
      position: "Frontend Developer",
      daysLeft: 12,
      dateLabel: inDaysLabel(12),
      isToday: false,
    },
  ];
}

export function mockHrDashboard() {
  const active = users.filter((u) => u.status === "active");
  const totalEmployees = Math.max(active.length, 1);
  const presentToday = Object.values(workSessionsByUser).filter((s) => s.active).length;
  const presentPct = Math.round((presentToday / totalEmployees) * 100);
  const byDepartmentMap = new Map<string, number>([
    ["Developer", 0],
    ["Designer", 0],
    ["QA", 0],
    ["UI/UX", 0],
  ]);
  let staffInOverview = 0;
  for (const u of active) {
    const raw = (u.department ?? "").trim().toLowerCase();
    let label: string | null = null;
    if (raw.includes("ui") && raw.includes("ux")) label = "UI/UX";
    else if (raw === "qa" || raw.startsWith("qa ")) label = "QA";
    else if (raw === "developer" || raw === "developers") label = "Developer";
    else if (raw === "designer" || raw === "designers") label = "Designer";
    if (!label) continue;
    byDepartmentMap.set(label, (byDepartmentMap.get(label) ?? 0) + 1);
    staffInOverview += 1;
  }
  const byDepartment = [...byDepartmentMap.entries()]
    .map(([name, count]) => ({
      name,
      count,
      percent: staffInOverview > 0 ? Math.round((count / staffInOverview) * 100) : 0,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  const now = new Date();
  const todayKey = localDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = localDateKey(tomorrow);

  const upcomingLeaveItems: Array<{
    id: string;
    leaveId: number;
    day: number;
    dateKey: string;
    section: "today" | "tomorrow" | "upcoming";
    name: string;
    avatar: string | null;
    leaveType: string;
    leaveTypeLabel: string;
  }> = [];
  const upcomingWfhItems: typeof upcomingLeaveItems = [];

  for (const l of leaveRequests.filter(
    (r) =>
      (r.status === "approved" || r.status === "pending") &&
      r.endDate >= todayKey,
  )) {
    const isWfh = l.leaveType === "wfh";
    if (!isWfh && l.status !== "approved") continue;
    const rangeStart = l.startDate < todayKey ? todayKey : l.startDate;
    for (const dateKey of eachLeaveDateKey(rangeStart, l.endDate)) {
      if (!isWeekdayDateKey(dateKey) || dateKey < todayKey) continue;
      const user = userById(l.userId);
      const section =
        dateKey === todayKey
          ? "today"
          : dateKey === tomorrowKey
            ? "tomorrow"
            : "upcoming";
      const item = {
        id: `${l.id}-${dateKey}`,
        leaveId: l.id,
        day: Number(dateKey.slice(8, 10)),
        dateKey,
        section: section as "today" | "tomorrow" | "upcoming",
        name: user?.name || "Employee",
        avatar: user?.avatar ?? null,
        leaveType: leaveTypeShort(l.leaveType),
        leaveTypeLabel:
          l.leaveType === "paid"
            ? "Paid"
            : l.leaveType === "sick"
              ? "Sick"
              : l.leaveType === "unpaid"
                ? "Unpaid"
                : l.leaveType === "wfh"
                  ? "Work from home"
                  : "Half day",
      };
      if (isWfh) {
        upcomingWfhItems.push(item);
      } else {
        upcomingLeaveItems.push(item);
      }
    }
  }

  upcomingLeaveItems.sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.name.localeCompare(b.name),
  );
  upcomingWfhItems.sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.name.localeCompare(b.name),
  );

  return {
    totalEmployees: active.length,
    presentToday,
    presentPct,
    presentDeltaPct: 0,
    onLeaveToday: 0,
    onLeavePct: 0,
    onLeaveDeltaPct: 0,
    newJoinersThisMonth: active.filter(
      (u) => u.createdAt.getTime() > Date.now() - 30 * 86400000,
    ).length,
    joinersDelta: 0,
    departmentsCount: byDepartment.length,
    overviewStaffTotal: staffInOverview,
    byDepartment,
    leaveMonthLabel: new Date().toLocaleString("en-IN", { month: "long" }),
    upcomingLeaves: upcomingLeaveItems,
    upcomingWfh: upcomingWfhItems,
    recentJoiners: active
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map((u) => ({
        id: u.id,
        name: u.name || "Employee",
        avatar: u.avatar ?? null,
        position: u.position || u.department || "Team member",
        joinedAt: u.createdAt,
        joinedLabel: u.createdAt.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      })),
    upcomingBirthdays: mockUpcomingBirthdays(),
    projectOverview: {
      total: 18,
      byStatus: [
        { name: "Completed", count: 8, percent: 44, color: "#2563EB" },
        { name: "In Progress", count: 7, percent: 39, color: "#3B82F6" },
        { name: "On Hold", count: 2, percent: 11, color: "#F59E0B" },
        { name: "Overdue", count: 1, percent: 6, color: "#EF4444" },
      ],
    },
    monthMetrics: {
      totalHoursLogged: 214.5,
      totalHoursDeltaPct: 8,
      trackedHours: 198,
      trackedHoursPct: 92,
      trackedHoursDeltaPct: 5,
      billableHours: 162.3,
      billablePct: 76,
      teamUtilizationPct: 78,
      utilizationDeltaPct: 5,
      pendingInvoicesAmount: 6250,
      pendingInvoicesCount: 2,
      revenueThisMonth: 28450,
      revenueDeltaPct: 12,
      currency: mockGetOrgCurrency(),
    },
  };
}

export { mockFinanceDashboard } from "./mock-finance-dashboard";

export function mockLeaveSummary() {
  const data = mockHrDashboard();
  return {
    leaveMonthLabel: data.leaveMonthLabel,
    upcomingLeaves: data.upcomingLeaves,
    upcomingWfh: data.upcomingWfh,
    upcomingBirthdays: data.upcomingBirthdays,
  };
}

export function mockListTaskAttachments(taskId: number) {
  return (taskAttachments[taskId] ?? [])
    .filter((a) => a.listedInFiles !== false)
    .map(({ dataBase64: _data, ...meta }) => meta);
}

export function mockListWorkspaceFiles() {
  return Object.values(taskAttachments)
    .flat()
    .filter((attachment) => attachment.listedInFiles !== false)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((attachment) => {
      const task = tasks.find((row) => row.id === attachment.taskId);
      const project = task?.projectId ? projects.find((row) => row.id === task.projectId) : null;
      return {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        createdAt: attachment.createdAt,
        taskId: attachment.taskId,
        taskTitle: task?.title ?? "Task",
        projectName: project?.name ?? null,
      };
    });
}

export function mockListWorkspaceMeetings() {
  return Object.values(taskActivities)
    .flat()
    .filter((activity) => activity.action === "commented")
    .map((activity) => {
      const parsed = mockParseMeetingComment(activity.newValue);
      if (!parsed) return null;
      const task = tasks.find((row) => row.id === activity.taskId);
      const project = task?.projectId ? projects.find((row) => row.id === task.projectId) : null;
      return {
        id: activity.id,
        title: parsed.title,
        when: parsed.when,
        createdAt: activity.createdAt,
        taskId: activity.taskId,
        taskTitle: task?.title ?? "Task",
        projectName: project?.name ?? null,
        createdByName: activity.user?.name ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function mockParseMeetingComment(message: string | null) {
  if (!message?.trim()) return null;
  const match = message.replace(/\s+/g, " ").trim().match(/^(?:📅\s*)?Event or meeting:\s*(.+)$/i);
  if (!match?.[1]) return null;
  const rest = match[1].trim();
  const withWhen = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (withWhen?.[1]?.trim()) {
    return { title: withWhen[1].trim(), when: withWhen[2]?.trim() || null };
  }
  return { title: rest, when: null };
}

export function mockGetTaskAttachment(id: number) {
  for (const list of Object.values(taskAttachments)) {
    const found = list.find((a) => a.id === id);
    if (found) return found;
  }
  return null;
}

export function mockAddTaskAttachment(
  input: {
    taskId: number;
    fileName: string;
    mimeType: string;
    fileSize: number;
    dataBase64: string;
    listedInFiles?: boolean;
  },
  actor: SafeUser,
) {
  const list = taskAttachments[input.taskId] ?? (taskAttachments[input.taskId] = []);
  const id = list.reduce((max, a) => Math.max(max, a.id), 0) + 1;
  const attachment = {
    id,
    taskId: input.taskId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileSize: input.fileSize,
    dataBase64: input.dataBase64,
    listedInFiles: input.listedInFiles ?? true,
    uploadedBy: actor.id,
    createdAt: new Date(),
  };
  list.push(attachment);
  return attachment;
}

export function mockDeleteTaskAttachment(id: number) {
  for (const [taskId, list] of Object.entries(taskAttachments)) {
    const index = list.findIndex((a) => a.id === id);
    if (index >= 0) {
      list.splice(index, 1);
      if (list.length === 0) delete taskAttachments[Number(taskId)];
      return { success: true };
    }
  }
  throw new Error("Attachment not found");
}

import {
  TOTAL_PAID_LEAVES,
  accruedPaidLeavesForYear,
  annualPaidLeaveEntitlement,
  annualSickLeaveEntitlement,
  annualWfhEntitlement,
  canCancelLeaveRequest,
  canEditLeaveRequest,
  consumesPaidBalance,
  consumesSickBalance,
  formatLeaveDays,
  allowsHalfDayLeave,
  employeeLeaveReviewMessage,
  isHalfDayLeave,
  isInProbationPeriod,
  isWorkFromHomeLeave,
  leaveBalanceUnits,
  leaveDayUnits,
  leaveDaysInYear,
  leaveYearsInRange,
  firstOverlappingLeaveDate,
  alreadyAppliedLeaveMessage,
  leaveRequestNotificationTitle,
  paidLeaveLockPeriodLabel,
  resolveEmploymentType,
  toJoiningDateKey,
  leaveTypeLabel,
  leaveTypeShort,
  managerLeaveNotificationMessage,
  manualLeaveEntryMessage,
  MONTHLY_PAID_LEAVES,
  roundLeaveUnits,
  type LeaveType,
} from "@/lib/leave-policy";
import { workZoneDateKey, workZoneDateParts } from "@/lib/timezone";
import type { LeaveRequestDoc, LeaveUsageOverrideDoc, PublicHolidayDoc } from "@db/mongo/types";
import { defaultHolidaysForYear } from "@/lib/public-holidays";

const leaveRequests: LeaveRequestDoc[] = [];
let nextLeaveId = 1;

function mockComputeLeaveUsage(
  userId: number,
  year: number,
  options?: { excludeRequestId?: number },
) {
  const requests = leaveRequests.filter(
    (r) =>
      r.userId === userId &&
      (r.status === "pending" || r.status === "approved") &&
      r.id !== options?.excludeRequestId,
  );
  let approvedPaid = 0;
  let approvedSick = 0;
  let approvedWfh = 0;
  let pendingPaid = 0;
  let pendingSick = 0;
  let pendingWfh = 0;
  for (const req of requests) {
    const units = leaveDaysInYear(
      req.startDate,
      req.endDate,
      year,
      req.leaveType,
      isHalfDayLeave(req),
    );
    if (units <= 0) continue;
    if (consumesPaidBalance(req.leaveType)) {
      if (req.status === "approved") approvedPaid += units;
      else pendingPaid += units;
    } else if (consumesSickBalance(req.leaveType)) {
      if (req.status === "approved") approvedSick += units;
      else pendingSick += units;
    } else if (isWorkFromHomeLeave(req.leaveType)) {
      if (req.status === "approved") approvedWfh += units;
      else pendingWfh += units;
    }
  }
  const usedPaid = approvedPaid + pendingPaid;
  const usedSick = approvedSick + pendingSick;
  const usedWfh = approvedWfh + pendingWfh;
  const dateOfJoining = userById(userId)?.dateOfJoining ?? null;
  const joiningKey = toJoiningDateKey(dateOfJoining);
  const employmentType = resolveEmploymentType(userById(userId));
  const onNoticePeriod = Boolean(userById(userId)?.onNoticePeriod);
  const paidAccrued = accruedPaidLeavesForYear(
    year,
    new Date(),
    joiningKey,
    employmentType,
    onNoticePeriod,
  );
  const paidAnnual = annualPaidLeaveEntitlement(
    year,
    joiningKey,
    employmentType,
    onNoticePeriod,
  );
  const sickTotal = annualSickLeaveEntitlement(year, joiningKey);
  const wfhTotal = annualWfhEntitlement(year, joiningKey);
  return {
    year,
    paidTotal: paidAccrued,
    paidAnnualTotal: paidAnnual,
    sickTotal,
    wfhTotal,
    paidRemaining: roundLeaveUnits(Math.max(0, paidAccrued - usedPaid)),
    sickRemaining: roundLeaveUnits(Math.max(0, sickTotal - usedSick)),
    wfhRemaining: roundLeaveUnits(Math.max(0, wfhTotal - usedWfh)),
    paidUsed: roundLeaveUnits(approvedPaid),
    sickUsed: roundLeaveUnits(approvedSick),
    wfhUsed: roundLeaveUnits(approvedWfh),
    paidPending: roundLeaveUnits(pendingPaid),
    sickPending: roundLeaveUnits(pendingSick),
    wfhPending: roundLeaveUnits(pendingWfh),
    usedLeaves: roundLeaveUnits(approvedPaid + approvedSick),
    dateOfJoining: joiningKey ?? dateOfJoining,
    employmentType,
    onNoticePeriod,
    inProbation: isInProbationPeriod(joiningKey, new Date(), employmentType),
    paidLeaveLockLabel: paidLeaveLockPeriodLabel(employmentType),
  };
}

function mockAssertYearScopedBalance(params: {
  userId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  excludeRequestId?: number;
  forEmployee?: boolean;
}) {
  if (
    !consumesPaidBalance(params.leaveType) &&
    !consumesSickBalance(params.leaveType) &&
    !isWorkFromHomeLeave(params.leaveType)
  ) {
    return;
  }

  const endDate = params.isHalfDay ? params.startDate : params.endDate;
  const short = leaveTypeShort(params.leaveType);
  const employeeSuffix = params.forEmployee ? " for this employee" : "";

  for (const year of leaveYearsInRange(params.startDate, endDate)) {
    const needed = leaveDaysInYear(
      params.startDate,
      endDate,
      year,
      params.leaveType,
      params.isHalfDay,
    );
    if (needed <= 0) continue;

    const usage = mockComputeLeaveUsage(params.userId, year, {
      excludeRequestId: params.excludeRequestId,
    });
    const remaining = consumesPaidBalance(params.leaveType)
      ? usage.paidRemaining
      : consumesSickBalance(params.leaveType)
        ? usage.sickRemaining
        : usage.wfhRemaining;

    if (needed > remaining) {
      throw new Error(
        `Only ${remaining} ${short} day(s) remaining for ${year}${employeeSuffix}`,
      );
    }
  }
}

function mockAssertNoOverlappingLeave(params: {
  userId: number;
  startDate: string;
  endDate: string;
  excludeRequestId?: number;
}) {
  for (const req of leaveRequests) {
    if (req.userId !== params.userId) continue;
    if (req.status !== "pending" && req.status !== "approved") continue;
    if (params.excludeRequestId != null && req.id === params.excludeRequestId) continue;
    const conflict = firstOverlappingLeaveDate(params.startDate, params.endDate, req);
    if (conflict) {
      throw new Error(alreadyAppliedLeaveMessage(conflict));
    }
  }
}

export function mockLeaveBalance(userId: number, year = workZoneDateParts(new Date()).year) {
  return mockComputeLeaveUsage(userId, year);
}

export function mockMyLeaveRequests(userId: number) {
  return {
    requests: leaveRequests
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}

export function mockApprovedLeavesInRange(
  userId: number,
  startDate: string,
  endDate: string,
) {
  return {
    leaves: leaveRequests
      .filter(
        (r) =>
          r.userId === userId &&
          r.status === "approved" &&
          r.startDate <= endDate &&
          r.endDate >= startDate,
      )
      .map((r) => ({
        id: r.id,
        leaveType: r.leaveType,
        startDate: r.startDate,
        endDate: r.endDate,
        days: r.days,
        isHalfDay: Boolean(r.isHalfDay) || r.leaveType === "half" || r.days === 0.5,
      })),
  };
}

export function mockApplyLeave(
  userId: number,
  input: {
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay?: boolean;
  },
) {
  const isHalfDay = Boolean(input.isHalfDay) && !isWorkFromHomeLeave(input.leaveType);
  if (isHalfDay && !allowsHalfDayLeave(input.leaveType)) {
    throw new Error("Half day is not available for this leave type");
  }
  if (isWorkFromHomeLeave(input.leaveType) && input.isHalfDay) {
    throw new Error("Work from home is full day only");
  }

  if (isHalfDay && input.startDate !== input.endDate) {
    throw new Error("Half day leave must be for a single day only");
  }
  const days = isHalfDay
    ? 0.5
    : leaveDayUnits(input.leaveType, input.startDate, input.endDate, false);
  if (days <= 0) throw new Error("End date must be on or after the start date");
  const todayKey = workZoneDateKey(new Date());
  if (input.startDate < todayKey) throw new Error("Leave cannot start in the past");
  const requestEndDate = isHalfDay ? input.startDate : input.endDate;
  mockAssertNoOverlappingLeave({
    userId,
    startDate: input.startDate,
    endDate: requestEndDate,
  });
  mockAssertYearScopedBalance({
    userId,
    leaveType: input.leaveType,
    startDate: input.startDate,
    endDate: input.endDate,
    isHalfDay,
  });
  const now = new Date();
  const request: LeaveRequestDoc = {
    id: nextLeaveId++,
    userId,
    organizationId: userById(userId)?.organizationId ?? 1,
    leaveType: input.leaveType,
    isHalfDay,
    startDate: input.startDate,
    endDate: requestEndDate,
    days,
    reason: input.reason,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: now,
    updatedAt: now,
  };
  leaveRequests.push(request);

  const actor = userById(userId);
  const dateLabel =
    input.startDate === input.endDate
      ? input.startDate
      : `${input.startDate} → ${input.endDate}`;
  for (const manager of users.filter(
    (u) =>
      u.id !== userId &&
      (u.role === "admin" ||
        u.role === "hr" ||
        (u.department ?? "").trim().toLowerCase() === "hr"),
  )) {
    notifications.push({
      id: notifications.reduce((max, n) => Math.max(max, n.id), 0) + 1,
      userId: manager.id,
      actorId: userId,
      type: "leave_request_pending" as const,
      title: leaveRequestNotificationTitle(input.leaveType, "new"),
      message: managerLeaveNotificationMessage({
        actorName: actor?.name ?? "An employee",
        leaveType: input.leaveType,
        action: "submitted",
        days,
        dateLabel,
        isHalfDay,
      }),
      taskId: null,
      leaveRequestId: request.id,
      read: false,
      createdAt: now,
    });
  }

  return { request, balance: mockComputeLeaveUsage(userId, Number(input.startDate.slice(0, 4))) };
}

export function mockUpdateMyLeave(
  userId: number,
  input: {
    id: number;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay?: boolean;
  },
) {
  const existing = leaveRequests.find((r) => r.id === input.id);
  if (!existing) throw new Error("Leave request not found");
  if (existing.userId !== userId) {
    throw new Error("You can only edit your own leave requests");
  }
  const todayKey = workZoneDateKey(new Date());
  if (!canEditLeaveRequest(existing, todayKey)) {
    throw new Error(
      existing.status === "approved"
        ? "Approved leave cannot be edited"
        : "Only pending leave requests can be edited",
    );
  }

  const isHalfDay = Boolean(input.isHalfDay) && !isWorkFromHomeLeave(input.leaveType);
  if (isWorkFromHomeLeave(input.leaveType) && input.isHalfDay) {
    throw new Error("Work from home is full day only");
  }
  if (isHalfDay && !allowsHalfDayLeave(input.leaveType)) {
    throw new Error("Half day is not available for this leave type");
  }
  if (isHalfDay && input.startDate !== input.endDate) {
    throw new Error("Half day leave must be for a single day only");
  }
  const days = isHalfDay
    ? 0.5
    : leaveDayUnits(input.leaveType, input.startDate, input.endDate, false);
  if (days <= 0) throw new Error("End date must be on or after the start date");
  if (input.startDate < todayKey) throw new Error("Leave cannot start in the past");

  const requestEndDate = isHalfDay ? input.startDate : input.endDate;
  mockAssertNoOverlappingLeave({
    userId,
    startDate: input.startDate,
    endDate: requestEndDate,
    excludeRequestId: existing.id,
  });
  mockAssertYearScopedBalance({
    userId,
    leaveType: input.leaveType,
    startDate: input.startDate,
    endDate: input.endDate,
    isHalfDay,
    excludeRequestId: existing.id,
  });

  const wasApproved = existing.status === "approved";
  const now = new Date();
  existing.leaveType = input.leaveType;
  existing.isHalfDay = isHalfDay;
  existing.startDate = input.startDate;
  existing.endDate = requestEndDate;
  existing.days = days;
  existing.reason = input.reason;
  existing.status = "pending";
  existing.reviewedBy = null;
  existing.reviewedAt = null;
  existing.reviewNote = wasApproved ? "Re-submitted after employee edit" : existing.reviewNote;
  existing.updatedAt = now;

  const actor = userById(userId);
  const dateLabel =
    existing.startDate === existing.endDate
      ? existing.startDate
      : `${existing.startDate} → ${existing.endDate}`;
  for (const manager of users.filter(
    (u) =>
      u.id !== userId &&
      (u.role === "admin" ||
        u.role === "hr" ||
        (u.department ?? "").trim().toLowerCase() === "hr"),
  )) {
    notifications.push({
      id: notifications.reduce((max, n) => Math.max(max, n.id), 0) + 1,
      userId: manager.id,
      actorId: userId,
      type: "leave_request_pending" as const,
      title: leaveRequestNotificationTitle(
        input.leaveType,
        wasApproved ? "resubmitted" : "updated",
      ),
      message: managerLeaveNotificationMessage({
        actorName: actor?.name ?? "An employee",
        leaveType: input.leaveType,
        action: wasApproved ? "resubmitted" : "updated",
        days,
        dateLabel,
        isHalfDay,
      }),
      taskId: null,
      leaveRequestId: existing.id,
      read: false,
      createdAt: now,
    });
  }

  return { request: { ...existing }, balance: mockComputeLeaveUsage(userId, Number(input.startDate.slice(0, 4))) };
}

export function mockCreateManualLeave(
  reviewerId: number,
  input: {
    userId: number;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    reason?: string;
    isHalfDay?: boolean;
    status: "approved" | "rejected";
    reviewNote?: string;
  },
) {
  const employee = userById(input.userId);
  if (!employee) throw new Error("Employee not found");

  if (!isWorkFromHomeLeave(input.leaveType) && (input.reason?.trim().length ?? 0) < 3) {
    throw new Error("Please enter a reason (at least 3 characters)");
  }

  const isHalfDay = Boolean(input.isHalfDay) && !isWorkFromHomeLeave(input.leaveType);
  if (isWorkFromHomeLeave(input.leaveType) && input.isHalfDay) {
    throw new Error("Work from home is full day only");
  }
  if (isHalfDay && !allowsHalfDayLeave(input.leaveType)) {
    throw new Error("Half day is not available for this leave type");
  }
  if (isHalfDay && input.startDate !== input.endDate) {
    throw new Error("Half day leave must be for a single day only");
  }
  const days = isHalfDay
    ? 0.5
    : leaveDayUnits(input.leaveType, input.startDate, input.endDate, false);
  if (days <= 0) throw new Error("End date must be on or after the start date");

  const requestEndDate = isHalfDay ? input.startDate : input.endDate;
  if (input.status === "approved") {
    mockAssertNoOverlappingLeave({
      userId: input.userId,
      startDate: input.startDate,
      endDate: requestEndDate,
    });
    mockAssertYearScopedBalance({
      userId: input.userId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      isHalfDay,
      forEmployee: true,
    });
  }

  const now = new Date();
  const reviewNote =
    input.reviewNote?.trim() ||
    (input.status === "approved" ? "Added manually by HR" : "Rejected via manual entry");

  const request: LeaveRequestDoc = {
    id: nextLeaveId++,
    userId: input.userId,
    organizationId: userById(input.userId)?.organizationId ?? 1,
    leaveType: input.leaveType,
    isHalfDay,
    startDate: input.startDate,
    endDate: requestEndDate,
    days,
    reason:
      input.reason?.trim() ||
      (isWorkFromHomeLeave(input.leaveType) ? "Work from home" : ""),
    status: input.status,
    reviewedBy: reviewerId,
    reviewedAt: now,
    reviewNote,
    createdAt: now,
    updatedAt: now,
  };
  leaveRequests.push(request);

  const dateLabel =
    request.startDate === request.endDate
      ? request.startDate
      : `${request.startDate} → ${request.endDate}`;

  notifications.push({
    id: notifications.reduce((max, n) => Math.max(max, n.id), 0) + 1,
    userId: input.userId,
    actorId: reviewerId,
    type: (input.status === "approved" ? "leave_approved" : "leave_rejected") as
      | "leave_approved"
      | "leave_rejected",
    title: leaveRequestNotificationTitle(
      input.leaveType,
      input.status === "approved" ? "recorded" : "rejected",
    ),
    message: manualLeaveEntryMessage(input.leaveType, {
      status: input.status,
      days,
      dateLabel,
      isHalfDay,
      reviewNote,
    }),
    taskId: null,
    leaveRequestId: request.id,
    read: false,
    createdAt: now,
  });

  return { request };
}

export function mockListLeaveRequests() {
  return {
    requests: [...leaveRequests]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        ...r,
        employee: userById(r.userId)
          ? {
              id: r.userId,
              name: userById(r.userId)!.name,
              email: userById(r.userId)!.email,
              avatar: userById(r.userId)!.avatar,
              department: userById(r.userId)!.department,
            }
          : null,
      })),
  };
}

export function mockUpdateLeaveDetails(
  _reviewerId: number,
  input: {
    id: number;
    reason: string;
    reviewNote?: string | null;
  },
) {
  const existing = leaveRequests.find((r) => r.id === input.id);
  if (!existing) throw new Error("Leave request not found");

  const isWfh = isWorkFromHomeLeave(existing.leaveType);
  const nextReason = input.reason.trim();
  if (!isWfh && nextReason.length < 3) {
    throw new Error("Please enter a reason (at least 3 characters)");
  }

  existing.reason = isWfh
    ? nextReason || existing.reason || "Work from home"
    : nextReason;
  if (input.reviewNote !== undefined) {
    existing.reviewNote = input.reviewNote?.trim() || null;
  }
  existing.updatedAt = new Date();

  return { request: { ...existing } };
}

export function mockReviewLeave(
  reviewerId: number,
  input: {
    id: number;
    status: "approved" | "rejected" | "cancelled" | "pending";
    reviewNote?: string;
  },
) {
  const existing = leaveRequests.find((r) => r.id === input.id);
  if (!existing) throw new Error("Leave request not found");
  if (existing.status === input.status) {
    throw new Error(`This leave request is already ${input.status}`);
  }

  if (input.status === "approved") {
    mockAssertNoOverlappingLeave({
      userId: existing.userId,
      startDate: existing.startDate,
      endDate: existing.endDate,
      excludeRequestId: existing.id,
    });
    mockAssertYearScopedBalance({
      userId: existing.userId,
      leaveType: existing.leaveType,
      startDate: existing.startDate,
      endDate: existing.endDate,
      isHalfDay: isHalfDayLeave(existing),
      excludeRequestId: existing.id,
      forEmployee: true,
    });
  }

  const now = new Date();
  const normalizedHalf = Boolean(existing.isHalfDay) || existing.leaveType === "half" || existing.days === 0.5;
  const normalizedDays = leaveBalanceUnits(existing);
  existing.status = input.status;
  existing.reviewedBy = input.status === "pending" ? null : reviewerId;
  existing.reviewedAt = input.status === "pending" ? null : now;
  existing.reviewNote =
    input.reviewNote?.trim() ||
    (input.status === "cancelled"
      ? "Cancelled by HR"
      : input.status === "pending"
        ? null
        : existing.reviewNote);
  existing.isHalfDay = normalizedHalf;
  existing.days = normalizedDays;
  if (normalizedHalf) existing.endDate = existing.startDate;
  existing.updatedAt = now;

  const notifType =
    input.status === "approved"
      ? ("leave_approved" as const)
      : input.status === "rejected"
        ? ("leave_rejected" as const)
        : input.status === "cancelled"
          ? ("leave_cancelled" as const)
          : ("leave_request_pending" as const);

  notifications.push({
    id: notifications.reduce((max, n) => Math.max(max, n.id), 0) + 1,
    userId: existing.userId,
    actorId: reviewerId,
    type: notifType,
    title:
      input.status === "approved"
        ? leaveRequestNotificationTitle(existing.leaveType, "approved")
        : input.status === "rejected"
          ? leaveRequestNotificationTitle(existing.leaveType, "rejected")
          : input.status === "cancelled"
            ? leaveRequestNotificationTitle(existing.leaveType, "cancelled")
            : leaveRequestNotificationTitle(existing.leaveType, "pending"),
    message: employeeLeaveReviewMessage(existing.leaveType, {
      status:
        input.status === "approved"
          ? "approved"
          : input.status === "rejected"
            ? "rejected"
            : input.status === "cancelled"
              ? "cancelled"
              : "pending",
      startDate: existing.startDate,
      endDate: existing.endDate,
      reviewNote: input.reviewNote,
      isHalfDay: existing.isHalfDay,
      days: existing.days,
    }),
    taskId: null,
    leaveRequestId: existing.id,
    read: false,
    createdAt: now,
  });

  return { request: { ...existing } };
}

export function mockCancelLeave(userId: number, id: number) {
  const existing = leaveRequests.find((r) => r.id === id);
  if (!existing) throw new Error("Leave request not found");
  if (existing.userId !== userId) {
    throw new Error("You can only cancel your own leave requests");
  }
  const todayKey = workZoneDateKey(new Date());
  if (!canCancelLeaveRequest(existing, todayKey)) {
    throw new Error(
      existing.status === "approved"
        ? "Approved leave that has already started cannot be cancelled"
        : "Only pending or upcoming approved leaves can be cancelled",
    );
  }

  const now = new Date();
  existing.status = "cancelled";
  existing.reviewedBy = userId;
  existing.reviewedAt = now;
  existing.reviewNote = "Cancelled by employee";
  existing.updatedAt = now;

  const actor = userById(userId);
  const dateLabel =
    existing.startDate === existing.endDate
      ? existing.startDate
      : `${existing.startDate} → ${existing.endDate}`;

  for (const manager of users.filter(
    (u) =>
      u.id !== userId &&
      (u.role === "admin" ||
        u.role === "hr" ||
        (u.department ?? "").trim().toLowerCase() === "hr"),
  )) {
    notifications.push({
      id: notifications.reduce((max, n) => Math.max(max, n.id), 0) + 1,
      userId: manager.id,
      actorId: userId,
      type: "leave_cancelled" as const,
      title: leaveRequestNotificationTitle(existing.leaveType, "cancelled"),
      message: managerLeaveNotificationMessage({
        actorName: actor?.name ?? "An employee",
        leaveType: existing.leaveType,
        action: "cancelled",
        days: existing.days,
        dateLabel,
        isHalfDay: Boolean(existing.isHalfDay),
      }),
      taskId: null,
      leaveRequestId: existing.id,
      read: false,
      createdAt: now,
    });
  }

  return {
    request: { ...existing },
    balance: mockComputeLeaveUsage(userId, Number(existing.startDate.slice(0, 4))),
  };
}

const publicHolidays: PublicHolidayDoc[] = [];
let nextHolidayId = 1;
let holidaysSeeded = false;

function seedMockHolidaysIfEmpty() {
  if (holidaysSeeded || publicHolidays.length > 0) return;
  holidaysSeeded = true;
  const year = workZoneDateParts(new Date()).year;
  const now = new Date();
  for (const h of defaultHolidaysForYear(year)) {
    publicHolidays.push({
      id: nextHolidayId++,
      date: h.date,
      name: h.name,
      organizationId: 1,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function mockListPublicHolidays(year?: number) {
  seedMockHolidaysIfEmpty();
  const list = [...publicHolidays].sort((a, b) => a.date.localeCompare(b.date));
  if (year == null) return { holidays: list };
  const prefix = `${year}-`;
  return { holidays: list.filter((h) => h.date.startsWith(prefix)) };
}

export function mockAddPublicHoliday(
  actorId: number,
  input: { date: string; name: string },
) {
  seedMockHolidaysIfEmpty();
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Holiday name must be at least 2 characters");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Invalid holiday date");
  if (publicHolidays.some((h) => h.date === input.date)) {
    throw new Error("A holiday is already set for this date");
  }
  const now = new Date();
  const holiday: PublicHolidayDoc = {
    id: nextHolidayId++,
    date: input.date,
    name,
    organizationId: 1,
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
  publicHolidays.push(holiday);
  return { holiday };
}

export function mockDeletePublicHoliday(id: number) {
  const idx = publicHolidays.findIndex((h) => h.id === id);
  if (idx < 0) throw new Error("Holiday not found");
  publicHolidays.splice(idx, 1);
  return { success: true };
}

const leaveUsageOverrides: LeaveUsageOverrideDoc[] = [];
let nextLeaveUsageOverrideId = 1;

export function mockListLeaveUsageOverrides(year: number) {
  return {
    overrides: leaveUsageOverrides.filter((o) => o.year === year),
  };
}

export function mockSetLeaveUsageOverride(
  reviewerId: number,
  input: { userId: number; year: number; month: number; remainingPaid: number },
) {
  const employee = userById(input.userId);
  if (!employee) throw new Error("Employee not found");

  const paidDaysUsed =
    Math.round((MONTHLY_PAID_LEAVES - input.remainingPaid) * 10) / 10;
  const existingIdx = leaveUsageOverrides.findIndex(
    (o) =>
      o.userId === input.userId &&
      o.year === input.year &&
      o.month === input.month,
  );
  const now = new Date();

  if (paidDaysUsed <= 0) {
    if (existingIdx >= 0) leaveUsageOverrides.splice(existingIdx, 1);
    return { override: null };
  }

  if (existingIdx >= 0) {
    const existing = leaveUsageOverrides[existingIdx];
    existing.paidDaysUsed = paidDaysUsed;
    existing.updatedBy = reviewerId;
    existing.updatedAt = now;
    return { override: { ...existing } };
  }

  const override: LeaveUsageOverrideDoc = {
    id: nextLeaveUsageOverrideId++,
    userId: input.userId,
    organizationId: userById(input.userId)?.organizationId ?? 1,
    year: input.year,
    month: input.month,
    paidDaysUsed,
    updatedBy: reviewerId,
    createdAt: now,
    updatedAt: now,
  };
  leaveUsageOverrides.push(override);
  return { override: { ...override } };
}

// ─── Work locations (geofences) ───────────────────────────────────────────────

import type { WorkLocationDoc } from "@db/mongo/types";
import { DEFAULT_LOCATION_RADIUS_M } from "@/lib/geofence";

let nextWorkLocationId = 1;
const workLocations: WorkLocationDoc[] = [];

export function mockListWorkLocations(options?: { includeArchived?: boolean }) {
  return workLocations
    .filter((l) => (options?.includeArchived ? true : !l.archived))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((l) => ({ ...l }));
}

export function mockListActiveWorkLocations() {
  return workLocations
    .filter((l) => !l.archived)
    .map((l) => ({
      id: l.id,
      name: l.name,
      latitude: l.latitude,
      longitude: l.longitude,
      radiusMeters: l.radiusMeters,
    }));
}

/** Approved WFH covering dateKey (YYYY-MM-DD) — clock-in may skip geofence. */
export function mockHasApprovedWfhOnDate(userId: number, dateKey: string): boolean {
  return leaveRequests.some(
    (l) =>
      l.userId === userId &&
      l.status === "approved" &&
      isWorkFromHomeLeave(l.leaveType) &&
      l.startDate <= dateKey &&
      l.endDate >= dateKey,
  );
}

export function mockCreateWorkLocation(input: {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  createdBy: number;
}) {
  const now = new Date();
  const doc: WorkLocationDoc = {
    id: nextWorkLocationId++,
    organizationId: 1,
    name: input.name.trim(),
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: input.radiusMeters ?? DEFAULT_LOCATION_RADIUS_M,
    archived: false,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  workLocations.push(doc);
  return { ...doc };
}

export function mockUpdateWorkLocation(
  id: number,
  patch: {
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  },
) {
  const existing = workLocations.find((l) => l.id === id);
  if (!existing) throw new Error("Location not found");
  existing.name = patch.name.trim();
  existing.address = patch.address;
  existing.latitude = patch.latitude;
  existing.longitude = patch.longitude;
  existing.radiusMeters = patch.radiusMeters;
  existing.updatedAt = new Date();
  return { ...existing };
}

export function mockSetWorkLocationArchived(id: number, archived: boolean) {
  const existing = workLocations.find((l) => l.id === id);
  if (!existing) throw new Error("Location not found");
  existing.archived = archived;
  existing.updatedAt = new Date();
  return { ...existing };
}

export function mockDeleteWorkLocation(id: number) {
  const idx = workLocations.findIndex((l) => l.id === id);
  if (idx < 0) throw new Error("Location not found");
  workLocations.splice(idx, 1);
  return { ok: true as const };
}

// ─── Org attendance QR ───────────────────────────────────────────────────────

import type {
  OrgAttendanceQrActivityAction,
  OrgAttendanceQrActivityDoc,
  OrgAttendanceQrDoc,
} from "@db/mongo/types";
import { nanoid } from "nanoid";

let nextOrgQrId = 1;
let nextOrgQrActivityId = 1;
const orgAttendanceQrs: OrgAttendanceQrDoc[] = [];
const orgAttendanceQrActivities: OrgAttendanceQrActivityDoc[] = [];

function toPublicOrgQr(doc: OrgAttendanceQrDoc) {
  return {
    token: doc.token,
    payload: `aumento-attendance:${doc.token}`,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPublicOrgQrActivity(doc: OrgAttendanceQrActivityDoc) {
  return {
    id: doc.id,
    action: doc.action,
    userId: doc.userId,
    userName: doc.userName,
    createdAt: doc.createdAt,
  };
}

function pushOrgQrActivity(params: {
  organizationId: number;
  action: OrgAttendanceQrActivityAction;
  userId: number;
  userName: string;
}) {
  const doc: OrgAttendanceQrActivityDoc = {
    id: nextOrgQrActivityId++,
    organizationId: params.organizationId,
    action: params.action,
    userId: params.userId,
    userName: params.userName,
    createdAt: new Date(),
  };
  orgAttendanceQrActivities.push(doc);
  return toPublicOrgQrActivity(doc);
}

export function mockGetOrgAttendanceQr(organizationId: number) {
  const doc = orgAttendanceQrs.find((q) => q.organizationId === organizationId);
  return doc ? toPublicOrgQr(doc) : null;
}

export function mockListOrgAttendanceQrActivity(organizationId: number) {
  return orgAttendanceQrActivities
    .filter((a) => a.organizationId === organizationId)
    .slice()
    .sort((a, b) => {
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      return byTime !== 0 ? byTime : b.id - a.id;
    })
    .slice(0, 50)
    .map(toPublicOrgQrActivity);
}

export function mockGenerateOrgAttendanceQr(
  organizationId: number,
  updatedBy: number,
  userName: string,
  action: "created" | "regenerated",
) {
  const now = new Date();
  const existing = orgAttendanceQrs.find((q) => q.organizationId === organizationId);
  let qr: ReturnType<typeof toPublicOrgQr>;
  if (existing) {
    existing.token = nanoid(40);
    existing.updatedBy = updatedBy;
    existing.updatedAt = now;
    qr = toPublicOrgQr(existing);
  } else {
    const doc: OrgAttendanceQrDoc = {
      id: nextOrgQrId++,
      organizationId,
      token: nanoid(40),
      updatedBy,
      createdAt: now,
      updatedAt: now,
    };
    orgAttendanceQrs.push(doc);
    qr = toPublicOrgQr(doc);
  }
  pushOrgQrActivity({
    organizationId,
    action,
    userId: updatedBy,
    userName,
  });
  return qr;
}

export function mockRecordOrgAttendanceQrDownload(
  organizationId: number,
  userId: number,
  userName: string,
) {
  return pushOrgQrActivity({
    organizationId,
    action: "downloaded",
    userId,
    userName,
  });
}
