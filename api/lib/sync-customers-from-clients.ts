import { Collections } from "@db/mongo/collections";
import type { CustomerDoc, UserDoc } from "@db/mongo/types";
import { getCollection, insertDoc } from "../queries/connection";
import { findOrganizationById } from "./tenant";

function isActiveStatus(status: string | null | undefined) {
  return String(status ?? "").toLowerCase() === "active";
}

function splitName(fullName: string | null | undefined) {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function emptyCustomerFields(): Omit<
  CustomerDoc,
  | "id"
  | "organizationId"
  | "displayName"
  | "companyName"
  | "email"
  | "firstName"
  | "lastName"
  | "mobile"
  | "workPhone"
  | "customerType"
  | "createdBy"
  | "createdAt"
  | "updatedAt"
  | "sourceUserId"
  | "sourceOrganizationId"
> {
  return {
    salutation: "",
    currency: "INR",
    hourlyRate: 0,
    gstTreatment: "unregistered_business",
    gstNumber: "",
    businessLegalName: "",
    businessTradeName: "",
    placeOfSupply: "",
    pan: "",
    taxPreference: "taxable",
    paymentTerms: "due_on_receipt",
    billingCountry: "India",
    billingAddress1: "",
    billingAddress2: "",
    billingCity: "",
    billingState: "",
    billingZip: "",
    billingPhone: "",
    shippingCountry: "India",
    shippingAddress1: "",
    shippingAddress2: "",
    shippingCity: "",
    shippingState: "",
    shippingZip: "",
    shippingPhone: "",
    contactPersons: [],
    customFieldLabel: "",
    customFieldValue: "",
    remarks: "",
  };
}

async function findExistingCustomer(
  organizationId: number,
  match: {
    sourceUserId?: number | null;
    sourceOrganizationId?: number | null;
    email?: string | null;
    displayName?: string | null;
  },
) {
  const col = await getCollection<CustomerDoc>(Collections.customers);
  const or: Record<string, unknown>[] = [];
  if (match.sourceUserId != null) {
    or.push({ sourceUserId: match.sourceUserId });
  }
  if (match.sourceOrganizationId != null) {
    or.push({ sourceOrganizationId: match.sourceOrganizationId });
  }
  const email = match.email?.trim().toLowerCase();
  if (email) {
    or.push({ email });
  }
  const name = match.displayName?.trim();
  if (name) {
    or.push({ displayName: name });
    or.push({ companyName: name });
  }
  if (or.length === 0) return null;
  return col.findOne({ organizationId, $or: or });
}

export async function ensureCustomerFromClientUser(
  organizationId: number,
  user: Pick<
    UserDoc,
    "id" | "name" | "email" | "firstName" | "lastName" | "phone" | "role"
  >,
  createdBy: number | null,
) {
  if (String(user.role ?? "").toLowerCase() !== "client") return null;

  const email = (user.email ?? "").trim().toLowerCase();
  const displayName = (user.name || email || "Client").trim();
  const firstName = user.firstName?.trim() || splitName(user.name).firstName;
  const lastName = user.lastName?.trim() || splitName(user.name).lastName;
  const existing = await findExistingCustomer(organizationId, {
    sourceUserId: user.id,
    email,
    displayName,
  });
  if (existing) return existing;

  const now = new Date();
  return insertDoc<CustomerDoc>(Collections.customers, {
    organizationId,
    ...emptyCustomerFields(),
    customerType: "business",
    firstName,
    lastName,
    companyName: displayName,
    displayName,
    email,
    workPhone: user.phone ?? "",
    mobile: user.phone ?? "",
    sourceUserId: user.id,
    sourceOrganizationId: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

async function ownerForClientOrg(org: OrganizationDoc) {
  const userCol = await getCollection<UserDoc>(Collections.users);
  const members = await userCol
    .find({ organizationId: org.id, role: { $ne: "platform" } })
    .sort({ id: 1 })
    .toArray();
  const owner =
    members.find((user) => user.id === org.createdBy) ??
    members.find((user) => String(user.role ?? "").toLowerCase() === "client") ??
    members.find((user) => String(user.role ?? "").toLowerCase() === "admin") ??
    members[0] ??
    null;
  const hasActiveMember = members.some((user) => isActiveStatus(user.status));
  return { owner, hasActiveMember };
}

export async function syncCustomersFromClients(
  organizationId: number,
  createdBy: number | null,
) {
  const org = await findOrganizationById(organizationId);
  const workspaceType = org?.workspaceType ?? "standard";
  if (workspaceType === "client" || workspaceType === "platform") {
    return;
  }

  const userCol = await getCollection<UserDoc>(Collections.users);
  const clientUsers = await userCol
    .find({ organizationId, role: "client" })
    .toArray();
  for (const user of clientUsers) {
    await ensureCustomerFromClientUser(organizationId, user, createdBy);
  }
}

export function customerActivityStatus(
  customer: Pick<CustomerDoc, "sourceUserId">,
  usersById: Map<number, Pick<UserDoc, "status">>,
): "active" | "inactive" {
  if (customer.sourceUserId == null) return "active";
  const user = usersById.get(customer.sourceUserId);
  if (!user) return "active";
  return isActiveStatus(user.status) ? "active" : "inactive";
}
