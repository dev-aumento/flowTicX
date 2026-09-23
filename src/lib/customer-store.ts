import type { CustomerRecord } from "@/components/customers/NewCustomerForm";

export const CUSTOMERS_STORAGE_KEY = "tracker.admin.customers";
export const CUSTOMERS_MIGRATED_KEY = "tracker.admin.customers.migrated.v1";

/** Legacy localStorage shape (string ids) used before Mongo persistence. */
export type LegacyCustomerRecord = Omit<CustomerRecord, "id"> & {
  id: string | number;
};

export function loadLegacyCustomers(): LegacyCustomerRecord[] {
  try {
    const raw = localStorage.getItem(CUSTOMERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearLegacyCustomers() {
  localStorage.removeItem(CUSTOMERS_STORAGE_KEY);
}

export function hasMigratedLegacyCustomers(): boolean {
  return localStorage.getItem(CUSTOMERS_MIGRATED_KEY) === "1";
}

export function markLegacyCustomersMigrated() {
  localStorage.setItem(CUSTOMERS_MIGRATED_KEY, "1");
}
