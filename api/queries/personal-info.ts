import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { EmploymentType, SafeUser, SexOption, UserDoc } from "@db/mongo/types";
import { findById } from "./mongo";
import { Collections } from "@db/mongo/collections";
import {
  calendarYmdToUtcNoon,
  parseIsoDateOnly,
  workZoneDateParts,
  type CalendarYmd,
} from "@/lib/timezone";

export function parseCalendarDateInput(value: string): Date | null {
  const parts = parseIsoDateOnly(value);
  if (!parts) return null;
  return calendarYmdToUtcNoon(parts);
}

function assertCalendarDateInRange(
  parts: CalendarYmd,
  label: string,
  minYear: number,
  maxParts: CalendarYmd,
) {
  if (parts.year < minYear) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label} year must be ${minYear} or later. Use day, then month (10 September, not 9 October).`,
    });
  }
  const afterMax =
    parts.year > maxParts.year ||
    (parts.year === maxParts.year && parts.month > maxParts.month) ||
    (parts.year === maxParts.year && parts.month === maxParts.month && parts.day > maxParts.day);
  if (afterMax) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label} cannot be in the future.`,
    });
  }
}

/** Shared fields editable by self or admin/HR. Does not include private notes. */
export const personalInfoUpdateSchema = z.object({
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  secondName: z.string().max(100).nullable().optional(),
  email: z.string().email().max(320).optional(),
  department: z.string().max(200).nullable().optional(),
  position: z.string().max(100).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  familyContactNumber: z.string().max(30).nullable().optional(),
  personalEmail: z
    .union([z.string().email().max(320), z.literal(""), z.null()])
    .optional(),
  bloodGroup: z.string().max(10).nullable().optional(),
  aadhaarCard: z.string().max(30).nullable().optional(),
  panCard: z.string().max(20).nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  dateOfJoining: z.string().nullable().optional(),
  sex: z.enum(["male", "female", "other", "prefer_not_to_say"]).nullable().optional(),
  notificationLanguage: z.string().max(20).nullable().optional(),
  employmentType: z.enum(["full_time", "intern"]).optional(),
  onNoticePeriod: z.boolean().optional(),
  headOfDepartmentUserIds: z.array(z.number()).optional(),
});

/** Self-only update schema — includes owner-private notes. */
export const selfPersonalInfoUpdateSchema = personalInfoUpdateSchema.extend({
  privateNotes: z.string().max(10_000).nullable().optional(),
});

export type PersonalInfoUpdateInput = z.infer<typeof personalInfoUpdateSchema>;
export type SelfPersonalInfoUpdateInput = z.infer<typeof selfPersonalInfoUpdateSchema>;

export type PersonalInfoRecord = {
  firstName: string | null;
  lastName: string | null;
  secondName: string | null;
  email: string | null;
  position: string | null;
  department: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  familyContactNumber: string | null;
  personalEmail: string | null;
  bloodGroup: string | null;
  aadhaarCard: string | null;
  panCard: string | null;
  dateOfBirth: Date | null;
  dateOfJoining: Date | null;
  sex: SexOption | null;
  notificationLanguage: string | null;
  employmentType: EmploymentType;
  onNoticePeriod: boolean;
  headOfDepartmentUserIds: number[];
  /** Only populated for the owning employee; never returned to admin/HR. */
  privateNotes?: string | null;
};

export type PersonalInfoView = PersonalInfoRecord & {
  headsOfDepartment: Array<{ id: number; name: string | null }>;
};

export function splitDisplayName(name: string | null | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function buildDisplayName(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null,
) {
  const combined = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ");
  return combined || fallback?.trim() || null;
}

export function buildPersonalInfoUserPatch(
  input: PersonalInfoUpdateInput | SelfPersonalInfoUpdateInput,
  existingUser: Pick<UserDoc, "firstName" | "lastName" | "name" | "email">,
  options?: { allowEmailChange?: boolean },
): Partial<UserDoc> {
  const patch: Partial<UserDoc> = {
    updatedAt: new Date(),
  };

  if (input.firstName !== undefined) patch.firstName = input.firstName;
  if (input.lastName !== undefined) patch.lastName = input.lastName;
  if (input.secondName !== undefined) patch.secondName = input.secondName;
  if (input.email !== undefined) {
    const next = input.email.trim().toLowerCase();
    const current = existingUser.email?.trim().toLowerCase() ?? "";
    const mayChange = options?.allowEmailChange || !current;
    if (next && mayChange && next !== current) patch.email = next;
  }
  if (input.department !== undefined) patch.department = input.department;
  if (input.position !== undefined) patch.position = input.position;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.city !== undefined) patch.city = input.city;
  if (input.address !== undefined) patch.address = input.address;
  if (input.familyContactNumber !== undefined) {
    patch.familyContactNumber = input.familyContactNumber;
  }
  if (input.personalEmail !== undefined) {
    const value =
      typeof input.personalEmail === "string" ? input.personalEmail.trim() : input.personalEmail;
    patch.personalEmail = value ? value : null;
  }
  if (input.bloodGroup !== undefined) patch.bloodGroup = input.bloodGroup;
  if (input.aadhaarCard !== undefined) patch.aadhaarCard = input.aadhaarCard;
  if (input.panCard !== undefined) patch.panCard = input.panCard;
  if (input.sex !== undefined) patch.sex = input.sex;
  if (input.notificationLanguage !== undefined) {
    patch.notificationLanguage = input.notificationLanguage;
  }
  if (input.employmentType !== undefined) {
    patch.employmentType = input.employmentType;
  }
  if (input.onNoticePeriod !== undefined) {
    patch.onNoticePeriod = input.onNoticePeriod;
  }
  if (input.headOfDepartmentUserIds !== undefined) {
    patch.headOfDepartmentUserIds = input.headOfDepartmentUserIds;
  }
  const today = workZoneDateParts(new Date());
  if (input.dateOfBirth !== undefined) {
    if (!input.dateOfBirth) {
      patch.dateOfBirth = null;
    } else {
      const parts = parseIsoDateOnly(input.dateOfBirth);
      if (!parts) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a valid date of birth (day, month, and year).",
        });
      }
      assertCalendarDateInRange(parts, "Date of birth", 1920, today);
      patch.dateOfBirth = calendarYmdToUtcNoon(parts);
    }
  }
  if (input.dateOfJoining !== undefined) {
    if (!input.dateOfJoining) {
      patch.dateOfJoining = null;
    } else {
      const parts = parseIsoDateOnly(input.dateOfJoining);
      if (!parts) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a valid date of joining (day, month, and year).",
        });
      }
      assertCalendarDateInRange(parts, "Date of joining", 1980, today);
      patch.dateOfJoining = calendarYmdToUtcNoon(parts);
    }
  }
  if ("privateNotes" in input && input.privateNotes !== undefined) {
    patch.privateNotes = input.privateNotes;
  }

  const nextFirst = input.firstName !== undefined ? input.firstName : existingUser.firstName;
  const nextLast = input.lastName !== undefined ? input.lastName : existingUser.lastName;
  if (input.firstName !== undefined || input.lastName !== undefined) {
    patch.name = buildDisplayName(nextFirst, nextLast, existingUser.name);
  }

  return patch;
}

export function personalFieldsFromUser(
  user: SafeUser | UserDoc,
  options?: { includePrivateNotes?: boolean },
): PersonalInfoRecord {
  const split = splitDisplayName(user.name);
  const record: PersonalInfoRecord = {
    firstName: user.firstName ?? split.firstName ?? null,
    lastName: user.lastName ?? split.lastName ?? null,
    secondName: user.secondName ?? null,
    email: user.email ?? null,
    position: user.position ?? null,
    department: user.department ?? null,
    phone: user.phone ?? null,
    city: user.city ?? null,
    address: user.address ?? null,
    familyContactNumber: user.familyContactNumber ?? null,
    personalEmail: user.personalEmail ?? null,
    bloodGroup: user.bloodGroup ?? null,
    aadhaarCard: user.aadhaarCard ?? null,
    panCard: user.panCard ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    dateOfJoining: user.dateOfJoining ?? null,
    sex: user.sex ?? null,
    notificationLanguage: user.notificationLanguage ?? null,
    employmentType: user.employmentType === "intern" ? "intern" : "full_time",
    onNoticePeriod: Boolean(user.onNoticePeriod),
    headOfDepartmentUserIds: user.headOfDepartmentUserIds ?? [],
  };

  if (options?.includePrivateNotes && "privateNotes" in user) {
    record.privateNotes = (user as UserDoc).privateNotes ?? null;
  }

  return record;
}

export async function resolveHeadsOfDepartment(userIds: number[]) {
  const unique = [...new Set(userIds.filter((id) => id > 0))];
  const heads = await Promise.all(
    unique.map(async (id) => {
      const user = await findById<UserDoc>(Collections.users, id);
      return user ? { id: user.id, name: user.name } : null;
    }),
  );
  return heads.filter((h): h is { id: number; name: string | null } => h != null);
}

export async function toPersonalInfoView(
  user: SafeUser | UserDoc,
  options?: { includePrivateNotes?: boolean },
): Promise<PersonalInfoView> {
  const record = personalFieldsFromUser(user, options);
  const headsOfDepartment = await resolveHeadsOfDepartment(record.headOfDepartmentUserIds);
  return { ...record, headsOfDepartment };
}

/** Strip private notes from any personal-info payload (admin/HR responses). */
export function stripPrivateNotes<T extends { privateNotes?: string | null }>(
  view: T,
): Omit<T, "privateNotes"> {
  const { privateNotes: _privateNotes, ...rest } = view;
  return rest;
}
