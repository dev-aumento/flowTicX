import { Collections } from "@db/mongo/collections";
import type { CustomerDoc, InvoiceDoc, NotificationDoc, UserDoc } from "@db/mongo/types";
import { findById, getCollection, hasMongoConfigured, insertDoc } from "../queries/connection";
import { invoiceStatusLabel } from "@/lib/invoice-store";

type InvoiceNotifyInput = {
  invoice: InvoiceDoc;
  actorId: number | null;
  previousStatus?: string | null;
  previousAmountPaid?: number | null;
};

async function recipientIdsForCustomer(customer: CustomerDoc | null): Promise<Map<number, number | null>> {
  const recipients = new Map<number, number | null>();
  if (!customer) return recipients;

  if (customer.sourceUserId != null) {
    recipients.set(customer.sourceUserId, customer.organizationId ?? null);
  }

  const sourceOrgId = customer.sourceOrganizationId;
  if (sourceOrgId == null) return recipients;

  const usersCol = await getCollection<UserDoc>(Collections.users);
  const members = await usersCol
    .find({ organizationId: sourceOrgId, status: "active" })
    .project({ id: 1, organizationId: 1 })
    .toArray();
  for (const member of members) {
    recipients.set(member.id, member.organizationId ?? sourceOrgId);
  }
  return recipients;
}

export async function notifyInvoiceClients(input: InvoiceNotifyInput) {
  if (!hasMongoConfigured()) return;
  if (String(input.invoice.status ?? "") === "draft") return;

  const previousStatus = String(input.previousStatus ?? "");
  const nextStatus = String(input.invoice.status ?? "");
  const previousPaid = Number(input.previousAmountPaid) || 0;
  const nextPaid = Number(input.invoice.amountPaid) || 0;
  const statusChanged = previousStatus !== nextStatus;
  const paidChanged = previousPaid !== nextPaid;
  if (input.previousStatus != null && !statusChanged && !paidChanged) return;

  const customer = await findById<CustomerDoc>(Collections.customers, input.invoice.customerId);
  const recipients = await recipientIdsForCustomer(customer);
  if (input.actorId != null) recipients.delete(input.actorId);
  if (recipients.size === 0) return;

  const statusLabel = invoiceStatusLabel(input.invoice.status);
  const created = input.previousStatus == null;
  const title = created ? "New invoice" : "Invoice payment updated";
  const message = created
    ? `${input.invoice.invoiceNumber} is ${statusLabel.toLowerCase()}.`
    : `${input.invoice.invoiceNumber} payment status is now ${statusLabel.toLowerCase()}.`;
  const now = new Date();
  const type = created ? "invoice_created" : "invoice_updated";

  await Promise.all(
    [...recipients.entries()].map(([userId, organizationId]) =>
      insertDoc<NotificationDoc>(Collections.notifications, {
        userId,
        organizationId,
        actorId: input.actorId,
        type,
        title,
        message,
        taskId: null,
        invoiceId: input.invoice.id,
        link: `/client/invoices/${input.invoice.id}`,
        read: false,
        createdAt: now,
      }),
    ),
  );
}

export function queueInvoiceClientNotification(input: InvoiceNotifyInput) {
  void notifyInvoiceClients(input).catch((error) => {
    console.error("[notify-invoice-clients]", error);
  });
}
