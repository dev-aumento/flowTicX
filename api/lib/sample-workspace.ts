import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc, ProjectDoc, TaskDoc } from "@db/mongo/types";
import { defaultEntitlement } from "@/lib/plan-entitlements";
import { getCollection, insertDoc, updateById } from "../queries/connection";
import { findOrganizationById } from "./tenant";
import { findPlatformPlan } from "./platform-plans";

type SampleTask = { title: string };

type SampleProject = {
  name: string;
  description: string;
  color: string;
  tasks: SampleTask[];
};

/** Sample work only. No people, comments, or activity. */
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

/** Creates sample projects once for a workspace that does not have them yet. */
export async function seedSampleWorkspaceOnce(organizationId: number) {
  const org = await findOrganizationById(organizationId);
  if (!org || org.workspaceType === "platform" || org.workspaceType === "client") return;
  if (org.sampleWorkspaceSeededAt) return;

  await ensureSampleProjects(org.id, org.plan ?? "trial", { createIfEmpty: true });
  await updateById<OrganizationDoc>(Collections.organizations, org.id, {
    sampleWorkspaceSeededAt: new Date(),
  });
}
