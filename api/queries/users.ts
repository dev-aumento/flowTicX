import type { UserDoc, SafeUser } from "@db/mongo/types";
import { DEFAULT_PERMISSIONS_BY_ROLE } from "@db/mongo/types";
import { Collections } from "@db/mongo/collections";
import { findById, getCollection, insertDoc, updateById, withMongoRetry } from "./mongo";
import { getEmployeeDefaultPermissions } from "../lib/employee-defaults";
import { createEmployeeFromUser, deactivateEmployeeByUserId, syncEmployeeFromUser } from "./employees";

export type { SafeUser };

export function omitPasswordHash(user: UserDoc): SafeUser {
  const { passwordHash: _passwordHash, privateNotes: _privateNotes, ...safeUser } = user;
  return safeUser;
}

export async function findUserById(id: number) {
  return findById<UserDoc>(Collections.users, id);
}

export async function findUserByEmail(email: string) {
  return withMongoRetry(async () => {
    const col = await getCollection<UserDoc>(Collections.users);
    return col.findOne({ email });
  });
}

export async function findUserByUnionId(unionId: string) {
  return withMongoRetry(async () => {
    const col = await getCollection<UserDoc>(Collections.users);
    return col.findOne({ unionId });
  });
}

export async function updateLastSignIn(userId: number) {
  await updateById<UserDoc>(Collections.users, userId, {
    lastSignInAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function createUser(
  data: {
    unionId: string;
    organizationId: number;
    name?: string | null;
    email?: string | null;
    passwordHash?: string | null;
    avatar?: string | null;
    role: UserDoc["role"];
    status?: UserDoc["status"];
    department?: string | null;
    position?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    secondName?: string | null;
    dateOfBirth?: Date | null;
    dateOfJoining?: Date | null;
    sex?: UserDoc["sex"];
    city?: string | null;
    address?: string | null;
    familyContactNumber?: string | null;
    bloodGroup?: string | null;
    aadhaarCard?: string | null;
    panCard?: string | null;
    notificationLanguage?: string | null;
    privateNotes?: string | null;
    employmentType?: "full_time" | "intern";
    headOfDepartmentUserIds?: number[];
    permissions?: string[];
    sortOrder?: number;
  },
  options?: { inviteId?: number | null },
) {
  const now = new Date();
  const permissions =
    data.permissions ??
    (data.role === "employee"
      ? await getEmployeeDefaultPermissions()
      : DEFAULT_PERMISSIONS_BY_ROLE[data.role] ?? DEFAULT_PERMISSIONS_BY_ROLE.employee);

  const col = await getCollection<UserDoc>(Collections.users);
  const last = await col.find({}).sort({ sortOrder: -1, id: -1 }).limit(1).next();
  const sortOrder = data.sortOrder ?? ((last?.sortOrder ?? last?.id ?? 0) + 1);

  const user = await insertDoc<UserDoc>(Collections.users, {
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
    privateNotes: null,
    employmentType: "full_time",
    onNoticePeriod: false,
    headOfDepartmentUserIds: [],
    ...data,
    organizationId: data.organizationId,
    sortOrder,
    permissions,
    createdAt: now,
    updatedAt: now,
    lastSignInAt: now,
  } as Omit<UserDoc, "id">);

  if (user.role === "employee") {
    await createEmployeeFromUser(user, { inviteId: options?.inviteId ?? null });
  }

  return user;
}

export async function upsertUser(
  data: Pick<UserDoc, "unionId"> & Partial<Omit<UserDoc, "id">>,
) {
  const existing = await findUserByUnionId(data.unionId);
  const now = new Date();

  if (existing) {
    await updateById<UserDoc>(Collections.users, existing.id, {
      ...data,
      lastSignInAt: now,
      updatedAt: now,
    });
    return findUserById(existing.id);
  }

  if (data.organizationId == null) {
    throw new Error("organizationId is required when creating a user");
  }

  return createUser({
    unionId: data.unionId,
    organizationId: data.organizationId,
    name: data.name ?? null,
    email: data.email ?? null,
    passwordHash: data.passwordHash ?? null,
    avatar: data.avatar ?? null,
    role: data.role ?? "employee",
    status: data.status ?? "active",
    department: data.department ?? null,
    position: data.position ?? null,
    phone: data.phone ?? null,
    permissions: data.permissions,
  });
}
