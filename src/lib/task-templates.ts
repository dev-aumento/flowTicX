import type { CreateTaskFormData } from "@/components/tasks/CreateTaskModal";

export type TaskCreateTemplate = {
  id: string;
  label: string;
  form: Partial<CreateTaskFormData>;
};

export const TASK_CREATE_TEMPLATES: TaskCreateTemplate[] = [
  {
    id: "blank",
    label: "Blank task",
    form: {},
  },
  {
    id: "bug",
    label: "Bug report",
    form: {
      title: "Bug: ",
      priority: "high",
      tags: "bug",
      activeModules: ["status_summaries", "checklists", "tags"],
      checklistItems: ["Reproduce the issue", "Identify root cause", "Fix and verify"],
      statusSummary: "Investigating",
    },
  },
  {
    id: "feature",
    label: "Feature request",
    form: {
      title: "Feature: ",
      priority: "medium",
      tags: "feature",
      activeModules: ["status_summaries", "checklists", "time_planning"],
      checklistItems: ["Define requirements", "Design solution", "Implement", "Review"],
      statusSummary: "Planning",
    },
  },
  {
    id: "meeting",
    label: "Meeting follow-up",
    form: {
      title: "Follow-up: ",
      priority: "medium",
      tags: "meeting",
      activeModules: ["status_summaries", "checklists", "participants"],
      checklistItems: ["Share notes", "Assign action items", "Schedule next check-in"],
      statusSummary: "Action items pending",
    },
  },
  {
    id: "client",
    label: "Client deliverable",
    form: {
      title: "Client: ",
      priority: "high",
      tags: "client, deliverable",
      activeModules: ["status_summaries", "project", "reminders"],
      statusSummary: "Awaiting client feedback",
    },
  },
];
