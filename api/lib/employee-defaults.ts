import { ALL_PERMISSION_KEYS } from "@contracts/permissions";
import { Collections } from "@db/mongo/collections";
import { DEFAULT_PERMISSIONS_BY_ROLE } from "@db/mongo/types";
import { getCollection } from "../queries/connection";
import { hasMongoConfigured } from "../queries/mongo";

const SETTINGS_KEY = "employee_default_permissions";

/** Always granted to employees — not removable via admin defaults UI merge */
const CORE_EMPLOYEE_PERMISSIONS = ["projects.view"] as const;

type SettingsDoc = {
  key: string;
  permissions: string[];
  updatedAt: Date;
};

let memoryEmployeeDefaults: string[] | null = null;

function defaultEmployeePermissions() {
  return [...new Set([...CORE_EMPLOYEE_PERMISSIONS, ...DEFAULT_PERMISSIONS_BY_ROLE.employee])];
}

export async function getEmployeeDefaultPermissions(): Promise<string[]> {
  if (!hasMongoConfigured()) {
    return memoryEmployeeDefaults ?? defaultEmployeePermissions();
  }
  const col = await getCollection<SettingsDoc>(Collections.appSettings);
  const doc = await col.findOne({ key: SETTINGS_KEY });
  const base =
    doc?.permissions?.length
      ? doc.permissions.filter((p) => ALL_PERMISSION_KEYS.includes(p as never))
      : DEFAULT_PERMISSIONS_BY_ROLE.employee;

  return [...new Set([...CORE_EMPLOYEE_PERMISSIONS, ...base])];
}

export async function setEmployeeDefaultPermissions(permissions: string[]) {
  const filtered = permissions.filter((p) => ALL_PERMISSION_KEYS.includes(p as never));
  if (!hasMongoConfigured()) {
    memoryEmployeeDefaults = filtered;
    return filtered;
  }
  const col = await getCollection<SettingsDoc>(Collections.appSettings);
  await col.updateOne(
    { key: SETTINGS_KEY },
    {
      $set: {
        key: SETTINGS_KEY,
        permissions: filtered,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  return filtered;
}
