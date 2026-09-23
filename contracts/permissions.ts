export const PERMISSION_GROUPS = [
  {
    id: "dashboard",
    label: "Dashboard",
    permissions: [{ key: "dashboard.view", label: "View dashboard" }],
  },
  {
    id: "tasks",
    label: "Tasks",
    permissions: [
      { key: "tasks.view_own", label: "View own tasks" },
      { key: "tasks.view_all", label: "View all tasks" },
      { key: "tasks.view_client", label: "View client tasks" },
      { key: "tasks.create", label: "Create tasks" },
      { key: "tasks.edit_own", label: "Edit own tasks" },
      { key: "tasks.edit_all", label: "Edit all tasks" },
      { key: "tasks.change_assignee", label: "Change task assignee" },
      { key: "tasks.delete", label: "Delete tasks" },
    ],
  },
  {
    id: "projects",
    label: "Projects",
    permissions: [
      { key: "projects.view", label: "View projects" },
      { key: "projects.manage", label: "Create & manage projects" },
    ],
  },
  {
    id: "time",
    label: "Time Tracking",
    permissions: [
      { key: "time.edit_own", label: "Clock in/out & own time" },
      { key: "time.view_team", label: "View team time entries" },
      { key: "time.edit_all", label: "Edit all time entries" },
    ],
  },
  {
    id: "people",
    label: "People",
    permissions: [
      { key: "employees.view", label: "View employees" },
      { key: "employees.manage", label: "Manage employees" },
      { key: "departments.view", label: "View departments" },
      { key: "leaves.manage", label: "Manage leave" },
      { key: "attendance.manage", label: "Manage attendance" },
    ],
  },
  {
    id: "business",
    label: "Business",
    permissions: [
      { key: "customers.manage", label: "View & manage clients" },
      { key: "invoices.manage", label: "View & manage invoices" },
      { key: "reports.view", label: "View business reports" },
      { key: "analytics.view", label: "View analytics" },
    ],
  },
  {
    id: "profile",
    label: "Profile",
    permissions: [
      {
        key: "profile.head_of_department",
        label: "Set head of department",
      },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    permissions: [
      { key: "permissions.manage", label: "Manage permissions" },
      { key: "settings.task_status", label: "Edit task status names" },
    ],
  },
] as const;

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
);

export type AppPermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

export const ROUTE_PERMISSIONS: Record<string, AppPermissionKey | AppPermissionKey[]> = {
  "/": "dashboard.view",
  "/tasks": ["tasks.view_own", "tasks.view_all"],
  "/task-chats": ["tasks.view_own", "tasks.view_all"],
  "/projects": ["projects.view", "projects.manage"],
  "/time-tracking": ["time.edit_own", "time.view_team", "time.edit_all"],
  "/analytics": "analytics.view",
  "/admin/employees": ["employees.view", "employees.manage", "permissions.manage"],
  "/admin/departments": ["departments.view", "employees.view", "employees.manage", "permissions.manage"],
  "/admin/permissions": "permissions.manage",
  "/admin/tasks": "tasks.view_all",
  "/admin/client-tasks": ["tasks.view_client", "tasks.view_all"],
  "/admin/invoices": "invoices.manage",
  "/admin/customers": "customers.manage",
  "/admin/reports": ["reports.view", "invoices.manage", "customers.manage"],
  "/leave-management": "leaves.manage",
  "/attendance-management": "attendance.manage",
  "/locations": "attendance.manage",
  "/qr-code": "attendance.manage",
  "/recent-employees": ["employees.manage", "leaves.manage"],
};
