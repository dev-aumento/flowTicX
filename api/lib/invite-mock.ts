import { nanoid } from "nanoid";
import { Invite } from "@contracts/constants";

export type MockInvite = {
  id: number;
  token: string;
  invitedBy: number;
  email: string | null;
  department: string | null;
  inviteKind: "employee" | "client";
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: Date;
  createdAt: Date;
};

let nextId = 1;
const invites = new Map<string, MockInvite>();

function expiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + Invite.expiryDays);
  return date;
}

export function mockCreateInvite(
  invitedBy: number,
  email: string,
  inviteKind: "employee" | "client" = "employee",
) {
  const token = nanoid(Invite.tokenLength);
  const invite: MockInvite = {
    id: nextId++,
    token,
    invitedBy,
    email: email.toLowerCase(),
    department: null,
    inviteKind,
    status: "pending",
    expiresAt: expiryDate(),
    createdAt: new Date(),
  };
  invites.set(token, invite);
  return invite;
}

export function mockListPendingInvites() {
  const now = new Date();
  return [...invites.values()].filter(
    (invite) => invite.status === "pending" && invite.expiresAt > now,
  );
}

export function mockGetInvite(token: string) {
  const invite = invites.get(token);
  if (!invite || invite.status !== "pending") return null;
  if (invite.expiresAt < new Date()) {
    invite.status = "expired";
    return null;
  }
  return invite;
}

export function mockRevokeInvite(id: number) {
  for (const invite of invites.values()) {
    if (invite.id === id && invite.status === "pending") {
      invite.status = "revoked";
      return true;
    }
  }
  return false;
}

export function mockAcceptInvite(token: string) {
  const invite = invites.get(token);
  if (!invite || invite.status !== "pending") return null;
  invite.status = "accepted";
  return invite;
}
