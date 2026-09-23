import { Collections } from "@db/mongo/collections";
import { Workspace } from "@contracts/constants";
import { getCollection } from "../queries/connection";
import { hasMongoConfigured } from "../queries/mongo";
import * as mock from "./mock-store";

const SETTINGS_KEY = "organization";

type OrganizationSettingsDoc = {
  key: string;
  name: string;
  updatedAt: Date;
};

export async function getOrganizationName(): Promise<string> {
  if (!hasMongoConfigured()) {
    return mock.mockGetOrganizationName();
  }
  try {
    const col = await getCollection<OrganizationSettingsDoc>(Collections.appSettings);
    const doc = await col.findOne({ key: SETTINGS_KEY });
    const name = doc?.name?.trim();
    return name || Workspace.name;
  } catch {
    return Workspace.name;
  }
}

export async function setOrganizationName(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) return getOrganizationName();
  if (!hasMongoConfigured()) {
    return mock.mockSetOrganizationName(trimmed);
  }

  const col = await getCollection<OrganizationSettingsDoc>(Collections.appSettings);
  await col.updateOne(
    { key: SETTINGS_KEY },
    {
      $set: {
        key: SETTINGS_KEY,
        name: trimmed,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  return trimmed;
}
