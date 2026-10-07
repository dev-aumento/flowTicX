import { Collections } from "@db/mongo/collections";
import type {
  EmployeeDoc,
  OrganizationDoc,
  ProjectDoc,
  ProjectMemberDoc,
  TaskDoc,
  TaskParticipantDoc,
  TimeEntryDoc,
  UserDoc,
  WorkBreakDoc,
  WorkSessionDoc,
} from "@db/mongo/types";
import { defaultEntitlement } from "@/lib/plan-entitlements";
import { workZoneDateKey, workZoneDateParts, workZoneWallTimeToUtc, workZoneWeekday } from "@/lib/timezone";
import { findById, getCollection, insertDoc, updateById } from "../queries/connection";
import { findEmployeeByUserId } from "../queries/employees";
import { joinProject } from "../queries/project-members";
import { createUser, findUserByUnionId } from "../queries/users";
import { limitsForOrganization } from "./plan-capacity";
import { findOrganizationById } from "./tenant";
import { findPlatformPlan } from "./platform-plans";

type SampleTask = { title: string };

type SampleProject = {
  name: string;
  description: string;
  color: string;
  tasks: SampleTask[];
};

/** Sample projects. Starter employees and their tracked hours are added separately. */
const SAMPLE_PROJECTS: SampleProject[] = [
  {
    name: "Website redesign",
    description: "Sample project for a public website refresh.",
    color: "#2563EB",
    tasks: [
      { title: "Draft the homepage layout" },
      { title: "Collect brand colors and type" },
      { title: "Review the services page" },
      { title: "Prepare the launch checklist" },
    ],
  },
  {
    name: "Mobile app launch",
    description: "Sample project for a first app release.",
    color: "#7C3AED",
    tasks: [
      { title: "Outline the main screens" },
      { title: "Write the onboarding copy" },
      { title: "Check the app store listing" },
    ],
  },
  {
    name: "Client onboarding",
    description: "Sample project for welcoming a new client.",
    color: "#059669",
    tasks: [
      { title: "Prepare the welcome pack" },
      { title: "List the kickoff questions" },
      { title: "Set the first milestone" },
      { title: "Share the project timeline" },
    ],
  },
  {
    name: "Marketing campaign",
    description: "Sample project for a short campaign.",
    color: "#D97706",
    tasks: [
      { title: "Choose the campaign theme" },
      { title: "Draft three social posts" },
      { title: "Review the landing page" },
    ],
  },
  {
    name: "Internal operations",
    description: "Sample project for everyday team work.",
    color: "#DB2777",
    tasks: [
      { title: "Update the process notes" },
      { title: "Organize the shared files" },
      { title: "Review the weekly checklist" },
      { title: "Note open follow-ups" },
    ],
  },
];

export function isFreePlan(plan: string | null | undefined) {
  const slug = (plan ?? "trial").trim().toLowerCase();
  return slug === "trial" || slug === "free" || slug.startsWith("free-");
}

/** Free stays at the plan cap (3). Every other plan gets five sample projects, still within its cap. */
export function sampleProjectCount(
  plan: string | null | undefined,
  projectLimit: number | null | undefined,
) {
  const wanted = isFreePlan(plan) ? 3 : 5;
  if (projectLimit == null) return wanted;
  return Math.max(0, Math.min(wanted, projectLimit));
}

async function projectLimitFor(plan: string | null | undefined) {
  const slug = plan ?? "trial";
  const catalog = await findPlatformPlan(slug);
  return catalog?.limits.projects ?? defaultEntitlement(slug).limits.projects;
}

/**
 * Adds empty sample projects and tasks for a new workspace.
 * Tasks have no assignee, owner, participants, or chat comments.
 * Existing custom projects are left alone. Missing samples are added when the plan allows more.
 */
export async function ensureSampleProjects(
  organizationId: number,
  plan: string | null | undefined,
  options?: { createIfEmpty?: boolean },
) {
  const wanted = sampleProjectCount(plan, await projectLimitFor(plan));
  if (wanted <= 0) return;

  const projectCol = await getCollection<ProjectDoc>(Collections.projects);
  const existing = await projectCol.find({ organizationId }).toArray();
  const sampleNames = new Set(SAMPLE_PROJECTS.map((project) => project.name));
  const onlySamples = existing.every((project) => sampleNames.has(project.name));
  if (!onlySamples) return;
  if (existing.length === 0 && !options?.createIfEmpty) return;

  const existingNames = new Set(existing.map((project) => project.name));
  const now = new Date();

  for (const sample of SAMPLE_PROJECTS.slice(0, wanted)) {
    if (existingNames.has(sample.name)) continue;

    const project = await insertDoc<ProjectDoc>(Collections.projects, {
      organizationId,
      name: sample.name,
      description: sample.description,
      clientName: null,
      status: "active",
      color: sample.color,
      icon: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });

    for (let index = 0; index < sample.tasks.length; index += 1) {
      const task = sample.tasks[index];
      await insertDoc<TaskDoc>(Collections.tasks, {
        organizationId,
        title: task.title,
        description: null,
        status: "todo",
        stage: "new",
        priority: "medium",
        assigneeId: null,
        projectId: project.id,
        createdBy: null,
        dueDate: null,
        estimatedHours: null,
        actualHours: null,
        position: index,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

/** Creates sample projects once, then starter employees and their tracked hours. */
export async function seedSampleWorkspaceOnce(organizationId: number) {
  const org = await findOrganizationById(organizationId);
  if (!org || org.workspaceType === "platform" || org.workspaceType === "client") return;

  if (!org.sampleWorkspaceSeededAt) {
    await ensureSampleProjects(org.id, org.plan ?? "trial", { createIfEmpty: true });
    await updateById<OrganizationDoc>(Collections.organizations, org.id, {
      sampleWorkspaceSeededAt: new Date(),
    });
  }

  await ensureSampleEmployeesOnce(org.id);
}

type SampleEmployee = {
  slug: string;
  name: string;
  firstName: string;
  lastName: string;
  department: string;
  position: string;
  avatarSeed: string;
  /** Attendance minutes for each seeded workday. */
  attendanceMinutes: number;
  /** Task hours tracked inside that attendance day. */
  taskMinutes: number;
  joinedDaysAgo: number;
  birthdayDaysAhead: number;
  birthYear: number;
};

const SAMPLE_TEAM: SampleEmployee[] = [
  {
    slug: "jason-miles",
    name: "Jason Miles",
    firstName: "Jason",
    lastName: "Miles",
    department: "Developer",
    position: "Software Engineer",
    avatarSeed: "Alex",
    attendanceMinutes: 510,
    taskMinutes: 360,
    joinedDaysAgo: 20,
    birthdayDaysAhead: 8,
    birthYear: 1994,
  },
  {
    slug: "jean-paul",
    name: "Jean Paul",
    firstName: "Jean",
    lastName: "Paul",
    department: "Designer",
    position: "Product Designer",
    avatarSeed: "Sarah",
    attendanceMinutes: 480,
    taskMinutes: 300,
    joinedDaysAgo: 14,
    birthdayDaysAhead: 16,
    birthYear: 1996,
  },
  {
    slug: "alex-smith",
    name: "Alex Smith",
    firstName: "Alex",
    lastName: "Smith",
    department: "QA",
    position: "QA Engineer",
    avatarSeed: "Jordan",
    attendanceMinutes: 450,
    taskMinutes: 270,
    joinedDaysAgo: 9,
    birthdayDaysAhead: 24,
    birthYear: 1992,
  },
  {
    slug: "sarah-wilson",
    name: "Sarah Wilson",
    firstName: "Sarah",
    lastName: "Wilson",
    department: "UI/UX Designer",
    position: "UI Designer",
    avatarSeed: "Emily",
    attendanceMinutes: 420,
    taskMinutes: 240,
    joinedDaysAgo: 2,
    birthdayDaysAhead: 32,
    birthYear: 1998,
  },
];

/** How many starter employees fit in the seats still open after the admin. */
export function sampleEmployeeCount(openSeats: number | null | undefined) {
  const wanted = SAMPLE_TEAM.length;
  if (openSeats == null) return wanted;
  if (!Number.isFinite(openSeats)) return 0;
  return Math.max(0, Math.min(wanted, Math.floor(openSeats)));
}

/** Recent Mon–Fri dates in the work zone, newest last, not including today. */
export function sampleWorkdayKeys(today: Date, days: number) {
  const keys: string[] = [];
  const todayParts = workZoneDateParts(today);
  let cursor = workZoneWallTimeToUtc(todayParts.year, todayParts.month, todayParts.day - 1, 12, 0, 0, 0);
  let guard = 0;
  while (keys.length < days && guard < 80) {
    guard += 1;
    const weekday = workZoneWeekday(cursor);
    if (weekday >= 1 && weekday <= 5) keys.push(workZoneDateKey(cursor));
    const parts = workZoneDateParts(cursor);
    cursor = workZoneWallTimeToUtc(parts.year, parts.month, parts.day - 1, 12, 0, 0, 0);
  }
  return keys.reverse();
}

function shiftWorkZoneDays(date: Date, deltaDays: number) {
  const parts = workZoneDateParts(date);
  return workZoneWallTimeToUtc(parts.year, parts.month, parts.day + deltaDays, 10, 0, 0, 0);
}

function sampleUnionId(organizationId: number, slug: string) {
  return `sample_${organizationId}_${slug}`;
}

function sampleEmail(organizationId: number, slug: string) {
  return `${slug}.${organizationId}@example.com`;
}

function avatarFor(seed: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

async function markSampleEmployeesSeeded(organizationId: number) {
  await updateById<OrganizationDoc>(Collections.organizations, organizationId, {
    sampleEmployeesSeededAt: new Date(),
    sampleEmployeesSeedingAt: null,
    updatedAt: new Date(),
  });
}

async function releaseSampleEmployeeSeed(organizationId: number) {
  await updateById<OrganizationDoc>(Collections.organizations, organizationId, {
    sampleEmployeesSeedingAt: null,
    updatedAt: new Date(),
  });
}

/** One request creates the starter team. A second request in the same moment waits it out. */
async function claimSampleEmployeeSeed(organizationId: number) {
  const col = await getCollection<OrganizationDoc>(Collections.organizations);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 2 * 60 * 1000);
  const unset = (field: string) => [{ [field]: null }, { [field]: { $exists: false } }];
  const result = await col.updateOne(
    {
      id: organizationId,
      $and: [
        { $or: unset("sampleEmployeesSeededAt") },
        {
          $or: [...unset("sampleEmployeesSeedingAt"), { sampleEmployeesSeedingAt: { $lt: staleBefore } }],
        },
      ],
    },
    { $set: { sampleEmployeesSeedingAt: now, updatedAt: now } },
  );
  return result.modifiedCount > 0;
}

async function openSeatsForSamples(organizationId: number) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.teamMembers == null) return null;
  const users = await getCollection<UserDoc>(Collections.users);
  const activeOthers = await users.countDocuments({
    organizationId,
    sampleEmployee: { $ne: true },
    role: { $nin: ["platform", "client"] },
    status: { $nin: ["inactive", "suspended", "Inactive", "Suspended"] },
  });
  return Math.max(0, limits.teamMembers - activeOthers);
}

async function insertClosedTime(input: {
  organizationId: number;
  userId: number;
  taskId: number | null;
  projectId: number | null;
  clockIn: Date;
  minutes: number;
}) {
  const clockOut = new Date(input.clockIn.getTime() + input.minutes * 60_000);
  const durationSeconds = input.minutes * 60;
  await insertDoc<TimeEntryDoc>(Collections.timeEntries, {
    organizationId: input.organizationId,
    userId: input.userId,
    taskId: input.taskId,
    projectId: input.projectId,
    clockIn: input.clockIn,
    clockOut,
    duration: input.minutes,
    durationSeconds,
    note: null,
    source: "web",
    createdAt: clockOut,
    updatedAt: clockOut,
  });
}

async function ensureSampleHours(
  user: UserDoc,
  profile: SampleEmployee,
  today: Date,
) {
  if (user.organizationId == null) return;
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const existing = await timeCol.countDocuments({
    userId: user.id,
    organizationId: user.organizationId,
  });
  if (existing > 0) return;

  const joinKey = user.dateOfJoining
    ? workZoneDateKey(user.dateOfJoining)
    : workZoneDateKey(today);
  const keys = sampleWorkdayKeys(today, 8).filter((key) => key >= joinKey);
  const taskCol = await getCollection<TaskDoc>(Collections.tasks);
  const tasks = await taskCol
    .find({ organizationId: user.organizationId, assigneeId: user.id })
    .sort({ id: 1 })
    .toArray();

  for (let dayIndex = 0; dayIndex < keys.length; dayIndex += 1) {
    const [year, month, day] = keys[dayIndex].split("-").map(Number);
    const clockIn = workZoneWallTimeToUtc(year || 1970, month || 1, day || 1, 9, 30, 0, 0);
    await insertClosedTime({
      organizationId: user.organizationId,
      userId: user.id,
      taskId: null,
      projectId: null,
      clockIn,
      minutes: profile.attendanceMinutes,
    });

    const task = tasks.length > 0 ? tasks[dayIndex % tasks.length] : null;
    if (!task) continue;
    const taskIn = workZoneWallTimeToUtc(year || 1970, month || 1, day || 1, 10, 15, 0, 0);
    await insertClosedTime({
      organizationId: user.organizationId,
      userId: user.id,
      taskId: task.id,
      projectId: task.projectId ?? null,
      clockIn: taskIn,
      minutes: profile.taskMinutes,
    });
  }
}

async function assignSampleTasks(organizationId: number, userIds: number[]) {
  if (userIds.length === 0) return;
  const taskCol = await getCollection<TaskDoc>(Collections.tasks);
  const tasks = await taskCol
    .find({ organizationId, assigneeId: null })
    .sort({ id: 1 })
    .toArray();
  const now = new Date();
  for (let index = 0; index < tasks.length; index += 1) {
    const userId = userIds[index % userIds.length];
    await updateById<TaskDoc>(Collections.tasks, tasks[index].id, {
      assigneeId: userId,
      updatedAt: now,
    });
  }

  const projectCol = await getCollection<ProjectDoc>(Collections.projects);
  const projects = await projectCol.find({ organizationId }).project({ id: 1 }).toArray();
  for (const project of projects) {
    for (const userId of userIds) {
      await joinProject(project.id, userId);
    }
  }
}

/**
 * Adds a small team and tracked hours to a workspace that still only has its admin
 * and the sample projects. Runs once. Deactivating a starter employee deletes their hours.
 */
export async function ensureSampleEmployeesOnce(organizationId: number) {
  const org = await findOrganizationById(organizationId);
  if (!org || org.workspaceType === "platform" || org.workspaceType === "client") return;
  if (org.sampleEmployeesSeededAt) return;
  if (!(await claimSampleEmployeeSeed(organizationId))) return;

  const userCol = await getCollection<UserDoc>(Collections.users);
  const projectCol = await getCollection<ProjectDoc>(Collections.projects);
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);

  const [projects, staff] = await Promise.all([
    projectCol.find({ organizationId }).project({ name: 1 }).toArray(),
    userCol
      .find({ organizationId, role: { $nin: ["platform", "client"] } })
      .project({ id: 1, role: 1, sampleEmployee: 1 })
      .toArray(),
  ]);
  const ownedIds = staff
    .filter((user) => user.role === "admin" || user.sampleEmployee)
    .map((user) => user.id);
  const foreignTime = await timeCol.countDocuments({
    organizationId,
    ...(ownedIds.length > 0 ? { userId: { $nin: ownedIds } } : {}),
  });

  const sampleNames = new Set(SAMPLE_PROJECTS.map((project) => project.name));
  const realStaff = staff.filter((user) => user.role !== "admin" && !user.sampleEmployee);
  const onlySamples = projects.length > 0 && projects.every((project) => sampleNames.has(project.name));
  const fresh = realStaff.length === 0 && foreignTime === 0 && onlySamples;

  if (!fresh) {
    if (projects.length > 0 || realStaff.length > 0 || foreignTime > 0 || org.sampleWorkspaceSeededAt) {
      await markSampleEmployeesSeeded(organizationId);
    } else {
      await releaseSampleEmployeeSeed(organizationId);
    }
    return;
  }

  const today = new Date();
  const wanted = sampleEmployeeCount(await openSeatsForSamples(organizationId));
  const activeSampleIds: number[] = [];

  for (const profile of SAMPLE_TEAM.slice(0, wanted)) {
    const unionId = sampleUnionId(organizationId, profile.slug);
    let user: UserDoc | null = await findUserByUnionId(unionId);
    if (!user) {
      const joinDate = shiftWorkZoneDays(today, -profile.joinedDaysAgo);
      const birthdayParts = workZoneDateParts(shiftWorkZoneDays(today, profile.birthdayDaysAhead));
      try {
        user = await createUser({
          unionId,
          organizationId,
          name: profile.name,
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: sampleEmail(organizationId, profile.slug),
          passwordHash: null,
          avatar: avatarFor(profile.avatarSeed),
          role: "employee",
          status: "active",
          department: profile.department,
          position: profile.position,
          dateOfJoining: joinDate,
          dateOfBirth: workZoneWallTimeToUtc(
            profile.birthYear,
            birthdayParts.month,
            birthdayParts.day,
            0,
            0,
            0,
            0,
          ),
          sampleEmployee: true,
        });
      } catch (error) {
        user = await findUserByUnionId(unionId);
        if (!user) throw error;
      }
      const employee = user ? await findEmployeeByUserId(user.id) : null;
      if (employee) {
        await updateById<EmployeeDoc>(Collections.employees, employee.id, {
          joinedAt: joinDate,
          updatedAt: new Date(),
        });
      }
    }
    if (!user?.sampleEmployee) continue;
    if (String(user.status).toLowerCase() !== "active") continue;
    activeSampleIds.push(user.id);
  }

  await assignSampleTasks(organizationId, activeSampleIds);

  for (const profile of SAMPLE_TEAM.slice(0, wanted)) {
    const user = await findUserByUnionId(sampleUnionId(organizationId, profile.slug));
    if (!user?.sampleEmployee || String(user.status).toLowerCase() !== "active") continue;
    await ensureSampleHours(user, profile, today);
  }

  await markSampleEmployeesSeeded(organizationId);
}

/** Deletes tracked hours and task links for a starter employee. Real employees are left alone. */
export async function removeSampleEmployeeWork(userId: number) {
  const user = await findById<UserDoc>(Collections.users, userId);
  if (!user?.sampleEmployee) return;

  const now = new Date();
  await Promise.all([
    getCollection<TimeEntryDoc>(Collections.timeEntries).then((col) => col.deleteMany({ userId })),
    getCollection<WorkSessionDoc>(Collections.workSessions).then((col) => col.deleteMany({ userId })),
    getCollection<WorkBreakDoc>(Collections.workBreaks).then((col) => col.deleteMany({ userId })),
    getCollection<TaskParticipantDoc>(Collections.taskParticipants).then((col) =>
      col.deleteMany({ userId }),
    ),
    getCollection<ProjectMemberDoc>(Collections.projectMembers).then((col) =>
      col.deleteMany({ userId }),
    ),
  ]);

  if (user.organizationId != null) {
    const taskCol = await getCollection<TaskDoc>(Collections.tasks);
    await taskCol.updateMany(
      { organizationId: user.organizationId, assigneeId: userId },
      { $set: { assigneeId: null, updatedAt: now } },
    );
  }
}
