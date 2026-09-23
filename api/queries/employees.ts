import type { EmployeeDoc, SafeEmployee, UserDoc } from "@db/mongo/types";
import { Collections } from "@db/mongo/collections";
import { findById, getCollection, insertDoc, updateById } from "./mongo";

export type { SafeEmployee };

export function omitEmployeePassword(employee: EmployeeDoc): SafeEmployee {
  const { passwordHash: _, ...safe } = employee;
  return safe;
}

const PERSONAL_FIELD_DEFAULTS = {
  firstName: null,
  lastName: null,
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
  notificationLanguage: null,
  employmentType: "full_time" as const,
  onNoticePeriod: false,
  headOfDepartmentUserIds: [] as number[],
};

function personalPatchFromUser(user: UserDoc): Partial<EmployeeDoc> {
  return {
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    secondName: user.secondName ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    dateOfJoining: user.dateOfJoining ?? null,
    sex: user.sex ?? null,
    city: user.city ?? null,
    address: user.address ?? null,
    familyContactNumber: user.familyContactNumber ?? null,
    personalEmail: user.personalEmail ?? null,
    bloodGroup: user.bloodGroup ?? null,
    aadhaarCard: user.aadhaarCard ?? null,
    panCard: user.panCard ?? null,
    notificationLanguage: user.notificationLanguage ?? null,
    employmentType: user.employmentType === "intern" ? "intern" : "full_time",
    onNoticePeriod: Boolean(user.onNoticePeriod),
    headOfDepartmentUserIds: user.headOfDepartmentUserIds ?? [],
  };
}
export async function findEmployeeByUserId(userId: number) {
  const col = await getCollection<EmployeeDoc>(Collections.employees);
  return col.findOne({ userId });
}

export async function findEmployeeByEmail(email: string) {
  const col = await getCollection<EmployeeDoc>(Collections.employees);
  return col.findOne({ email: email.toLowerCase() });
}

export async function createEmployeeFromUser(
  user: UserDoc,
  options: { inviteId?: number | null } = {},
) {
  const existing = await findEmployeeByUserId(user.id);
  if (existing) {
    return syncEmployeeFromUser(user, options.inviteId ?? existing.inviteId);
  }

  const now = new Date();
  return insertDoc<EmployeeDoc>(Collections.employees, {
    userId: user.id,
    organizationId: user.organizationId,
    inviteId: options.inviteId ?? null,
    name: user.name ?? "",
    email: (user.email ?? "").toLowerCase(),
    passwordHash: user.passwordHash ?? "",
    avatar: user.avatar,
    department: user.department,
    position: user.position,
    phone: user.phone,
    ...PERSONAL_FIELD_DEFAULTS,
    ...personalPatchFromUser(user),
    status: user.status,
    permissions: user.permissions ?? [],
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deactivateEmployeeByUserId(userId: number) {
  const existing = await findEmployeeByUserId(userId);
  if (!existing) return null;

  return updateById<EmployeeDoc>(Collections.employees, existing.id, {
    status: "Inactive",
    updatedAt: new Date(),
  });
}

/** Permanently remove the employee profile linked to a user. */
export async function deleteEmployeeByUserId(userId: number) {
  const existing = await findEmployeeByUserId(userId);
  if (!existing) return false;

  const col = await getCollection<EmployeeDoc>(Collections.employees);
  const result = await col.deleteOne({ id: existing.id });
  return result.deletedCount > 0;
}

/** userIds that still have a row in the employees collection */
export async function getEmployeeUserIdSet() {
  const col = await getCollection<EmployeeDoc>(Collections.employees);
  const docs = await col.find({}, { projection: { userId: 1, _id: 0 } }).toArray();
  return new Set(docs.map((d) => d.userId));
}

/**
 * Employees must exist in the employees collection to appear in the CRM.
 * Admins/managers/HR/finance are listed from users even without an employee row.
 * Clients are external accounts and stay out of the staff directory.
 */
export function isListedInEmployeeDirectory(
  user: Pick<UserDoc, "id" | "role">,
  employeeUserIds: Set<number>,
) {
  if (user.role === "client") return false;
  if (user.role !== "employee") return true;
  return employeeUserIds.has(user.id);
}

/** Roles included in workforce / headcount metrics (not clients or account managers). */
export function isCountedInWorkforce(
  user: Pick<UserDoc, "role"> | { role?: string | null } | null | undefined,
) {
  const role = String(user?.role ?? "").toLowerCase();
  return role !== "client" && role !== "finance";
}

export async function syncEmployeeFromUser(
  user: UserDoc,
  inviteId?: number | null,
) {
  const existing = await findEmployeeByUserId(user.id);
  if (!existing) {
    // Do not recreate a deleted employee profile here — use createEmployeeFromUser.
    return null;
  }

  const now = new Date();
  const patch: Partial<EmployeeDoc> = {
    name: user.name ?? "",
    email: (user.email ?? "").toLowerCase(),
    passwordHash: user.passwordHash ?? "",
    avatar: user.avatar,
    department: user.department,
    organizationId: user.organizationId,
    position: user.position,
    phone: user.phone,
    ...personalPatchFromUser(user),
    status: user.status,
    permissions: user.permissions ?? [],
    updatedAt: now,
  };

  if (inviteId !== undefined) {
    patch.inviteId = inviteId;
  }

  await updateById<EmployeeDoc>(Collections.employees, existing.id, patch);
  return findById<EmployeeDoc>(Collections.employees, existing.id);
}

export async function backfillEmployeesFromUsers() {
  const usersCol = await getCollection<UserDoc>(Collections.users);
  const employees = await usersCol.find({ role: "employee" }).toArray();

  let created = 0;
  let updated = 0;

  for (const user of employees) {
    const existing = await findEmployeeByUserId(user.id);
    if (existing) {
      await syncEmployeeFromUser(user);
      updated++;
    } else {
      await createEmployeeFromUser(user);
      created++;
    }
  }

  return { created, updated, total: employees.length };
}
