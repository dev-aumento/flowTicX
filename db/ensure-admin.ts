import "dotenv/config";
import { hashPassword } from "../api/lib/password";
import { ensureSchema } from "../api/lib/migrate";
import { ensureDefaultOrganizationMigration } from "../api/lib/tenant";
import { findById, getCollection, insertDoc, updateById } from "../api/queries/mongo";
import { syncEmployeeFromUser } from "../api/queries/employees";
import { Collections } from "./mongo/collections";
import {
  DEFAULT_PERMISSIONS_BY_ROLE,
  type UserDoc,
} from "./mongo/types";

const DEFAULT_ADMIN = {
  unionId: "admin_union_001",
  name: "Sandeep",
  email: "sandeep@aumentoinfoway.com",
  role: "admin" as const,
  department: "Management",
  position: "Project Manager",
  password: "Aumento@dev2026",
};

const LEGACY_DEMO_ADMIN_EMAIL = "alex@aumento.io";

export async function ensureDefaultAdmin() {
  await ensureSchema();
  const organizationId = await ensureDefaultOrganizationMigration();

  const col = await getCollection<UserDoc>(Collections.users);
  const email = DEFAULT_ADMIN.email.toLowerCase();
  const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
  const now = new Date();
  const permissions = DEFAULT_PERMISSIONS_BY_ROLE.admin;

  let target =
    (await col.findOne({ email })) ??
    (await col.findOne({ unionId: DEFAULT_ADMIN.unionId }));

  if (target) {
    await updateById<UserDoc>(Collections.users, target.id, {
      unionId: DEFAULT_ADMIN.unionId,
      organizationId: target.organizationId ?? organizationId,
      name: target.name?.trim() || DEFAULT_ADMIN.name,
      email,
      role: DEFAULT_ADMIN.role,
      status: "active",
      department: DEFAULT_ADMIN.department,
      position: DEFAULT_ADMIN.position,
      passwordHash,
      permissions,
      updatedAt: now,
    });
    console.log(`Updated admin: ${email}`);
  } else {
    await insertDoc<UserDoc>(Collections.users, {
      unionId: DEFAULT_ADMIN.unionId,
      organizationId,
      name: DEFAULT_ADMIN.name,
      email,
      passwordHash,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sandeep",
      role: DEFAULT_ADMIN.role,
      status: "active",
      department: DEFAULT_ADMIN.department,
      position: DEFAULT_ADMIN.position,
      phone: null,
      firstName: "Sandeep",
      lastName: null,
      secondName: null,
      dateOfBirth: null,
      dateOfJoining: null,
      sex: null,
      city: null,
      address: null,
      familyContactNumber: null,
      bloodGroup: null,
      aadhaarCard: null,
      panCard: null,
      notificationLanguage: null,
      privateNotes: null,
      employmentType: "full_time",
      onNoticePeriod: false,
      headOfDepartmentUserIds: [],
      permissions,
      createdAt: now,
      updatedAt: now,
      lastSignInAt: now,
    } as Omit<UserDoc, "id">);
    console.log(`Created admin: ${email}`);
  }

  const legacyDemo = await col.findOne({ email: LEGACY_DEMO_ADMIN_EMAIL });
  if (legacyDemo && legacyDemo.email !== email) {
    await updateById<UserDoc>(Collections.users, legacyDemo.id, {
      role: "employee",
      status: "inactive",
      permissions: DEFAULT_PERMISSIONS_BY_ROLE.employee,
      updatedAt: now,
    });
    console.log(`Deactivated legacy demo admin: ${LEGACY_DEMO_ADMIN_EMAIL}`);
  }

  const adminUser = await col.findOne({ email });
  if (adminUser) {
    await syncEmployeeFromUser(adminUser);
  }

  const verified = adminUser ? await findById<UserDoc>(Collections.users, adminUser.id) : null;
  if (!verified || verified.role !== "admin" || !verified.passwordHash) {
    throw new Error("Failed to verify default admin account.");
  }

  console.log(`Default admin ready: ${email} / ${DEFAULT_ADMIN.password}`);
  console.log(`Position: ${DEFAULT_ADMIN.position}`);
  return verified.id;
}
