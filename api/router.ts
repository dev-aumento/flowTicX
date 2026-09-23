import { authRouter } from "./auth-router";
import { userRouter } from "./user-router";
import { projectRouter } from "./project-router";
import { taskRouter } from "./task-router";
import { subtaskRouter } from "./subtask-router";
import { timeEntryRouter } from "./time-entry-router";
import { notificationRouter } from "./notification-router";
import { inviteRouter } from "./invite-router";
import { dashboardRouter } from "./dashboard-router";
import { permissionsRouter } from "./permissions-router";
import { leaveRouter } from "./leave-router";
import { personalDocumentRouter } from "./personal-document-router";
import { formerEmployeeRouter } from "./former-employee-router";
import { customerRouter } from "./customer-router";
import { invoiceRouter } from "./invoice-router";
import { financeRouter } from "./finance-router";
import { locationRouter } from "./location-router";
import { orgQrRouter } from "./org-qr-router";
import { dashboardReminderRouter } from "./dashboard-reminder-router";
import { organizationRouter } from "./organization-router";
import { platformRouter } from "./platform-router";
import { subscriptionRouter } from "./subscription-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  user: userRouter,
  project: projectRouter,
  task: taskRouter,
  subtask: subtaskRouter,
  timeEntry: timeEntryRouter,
  notification: notificationRouter,
  invite: inviteRouter,
  dashboard: dashboardRouter,
  dashboardReminder: dashboardReminderRouter,
  permissions: permissionsRouter,
  leave: leaveRouter,
  location: locationRouter,
  orgQr: orgQrRouter,
  personalDocuments: personalDocumentRouter,
  formerEmployees: formerEmployeeRouter,
  customer: customerRouter,
  invoice: invoiceRouter,
  finance: financeRouter,
  organization: organizationRouter,
  subscription: subscriptionRouter,
  platform: platformRouter,
});

export type AppRouter = typeof appRouter;
