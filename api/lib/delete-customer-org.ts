import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc, ProjectDoc, TaskDoc, UserDoc } from "@db/mongo/types";
import { TRPCError } from "@trpc/server";
import { invalidateAuthUserCache } from "./auth";
import { getCollection, hasMongoConfigured } from "../queries/connection";
import { deleteAttachmentFromGridFs } from "../queries/attachment-storage";
import { deleteEmployeeDocumentFromGridFs } from "../queries/employee-document-storage";

const ORG_SCOPED_COLLECTIONS = [
  Collections.employees,
  Collections.employeeInvites,
  Collections.projects,
  Collections.tasks,
  Collections.timeEntries,
  Collections.timeApprovalRequests,
  Collections.notifications,
  Collections.employeeDocuments,
  Collections.formerEmployees,
  Collections.formerEmployeeDocuments,
  Collections.leaveRequests,
  Collections.leaveUsageOverrides,
  Collections.publicHolidays,
  Collections.workLocations,
  Collections.orgAttendanceQr,
  Collections.orgAttendanceQrActivity,
  Collections.customers,
  Collections.invoices,
  Collections.bankAccounts,
  Collections.ledgerAccounts,
  Collections.estimates,
  Collections.payments,
  Collections.expenses,
  Collections.contracts,
  Collections.vendorBills,
  Collections.dashboardReminders,
] as const;

async function deleteGridFsIds(ids: Array<string | null | undefined>, employeeBucket: boolean) {
  for (const id of ids) {
    if (!id) continue;
    try {
      if (employeeBucket) await deleteEmployeeDocumentFromGridFs(id);
      else await deleteAttachmentFromGridFs(id);
    } catch {
      // Best-effort: workspace rows must still be removed if file cleanup fails.
    }
  }
}

/** Permanently remove a customer organization and its tenant data. Never deletes the platform org. */
export async function deleteCustomerOrganization(organizationId: number) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Database is not configured",
    });
  }

  const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
  const org = await orgCol.findOne({ id: organizationId });
  if (!org || org.workspaceType === "platform") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
  }

  const orgFilter = { organizationId };
  const userCol = await getCollection<UserDoc>(Collections.users);
  const users = await userCol.find(orgFilter).toArray();
  const userIds = users.map((user) => user.id);

  const [projects, tasks, employeeDocs, formerDocs] = await Promise.all([
    getCollection<ProjectDoc>(Collections.projects).then((col) =>
      col.find(orgFilter).project({ id: 1 }).toArray(),
    ),
    getCollection<TaskDoc>(Collections.tasks).then((col) =>
      col.find(orgFilter).project({ id: 1 }).toArray(),
    ),
    getCollection<{ gridFsId?: string }>(Collections.employeeDocuments).then((col) =>
      col.find(orgFilter).project({ gridFsId: 1 }).toArray(),
    ),
    getCollection<{ gridFsId?: string }>(Collections.formerEmployeeDocuments).then((col) =>
      col.find(orgFilter).project({ gridFsId: 1 }).toArray(),
    ),
  ]);

  const projectIds = projects.map((row) => row.id);
  const taskIds = tasks.map((row) => row.id);

  const attachments =
    taskIds.length === 0
      ? []
      : await getCollection<{ gridFsId?: string }>(Collections.taskAttachments)
          .then((col) => col.find({ taskId: { $in: taskIds } }).project({ gridFsId: 1 }).toArray());

  await deleteGridFsIds(
    [...employeeDocs, ...formerDocs].map((doc) => doc.gridFsId),
    true,
  );
  await deleteGridFsIds(
    attachments.map((doc) => doc.gridFsId),
    false,
  );

  if (taskIds.length > 0) {
    const taskFilter = { taskId: { $in: taskIds } };
    await Promise.all([
      getCollection(Collections.taskParticipants).then((col) => col.deleteMany(taskFilter)),
      getCollection(Collections.subtasks).then((col) => col.deleteMany(taskFilter)),
      getCollection(Collections.taskActivity).then((col) => col.deleteMany(taskFilter)),
      getCollection(Collections.taskAttachments).then((col) => col.deleteMany(taskFilter)),
      getCollection(Collections.taskTagRelations).then((col) => col.deleteMany(taskFilter)),
    ]);
  }

  if (projectIds.length > 0) {
    await getCollection(Collections.projectMembers).then((col) =>
      col.deleteMany({ projectId: { $in: projectIds } }),
    );
  }

  if (userIds.length > 0) {
    const userFilter = { userId: { $in: userIds } };
    await Promise.all([
      getCollection(Collections.workSessions).then((col) => col.deleteMany(userFilter)),
      getCollection(Collections.workBreaks).then((col) => col.deleteMany(userFilter)),
    ]);
    for (const userId of userIds) invalidateAuthUserCache(userId);
  }

  for (const name of ORG_SCOPED_COLLECTIONS) {
    const col = await getCollection(name);
    await col.deleteMany(orgFilter);
  }

  await userCol.deleteMany(orgFilter);
  await orgCol.deleteOne({ id: organizationId });

  return { success: true as const, organizationId, name: org.name };
}
