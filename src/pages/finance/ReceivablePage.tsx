import { useMemo } from "react";
import { Link } from "react-router";
import { Banknote, ExternalLink, Wallet } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { invoiceBalanceDue, invoiceTotal, isInvoiceOutstanding } from "@/lib/invoice-store";
import { Button } from "@/components/ui/button";
import {
  FinanceEmptyState,
  FinanceLoading,
  FinanceMoney,
  FinancePageHeader,
  StatusBadge,
} from "@/components/finance/FinancePageKit";

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysOverdue(dueDate: string) {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(due.getTime())) return 0;
  const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function agingTone(days: number) {
  if (days >= 60) return "danger" as const;
  if (days >= 30) return "warning" as const;
  if (days > 0) return "info" as const;
  return "success" as const;
}

function agingLabel(days: number) {
  if (days === 0) return "Current";
  if (days === 1) return "1 day overdue";
  return `${days} days overdue`;
}

export default function ReceivablePage() {
  const { data: invoices = [], isLoading } = trpc.invoice.list.useQuery();

  const receivables = useMemo(
    () => invoices.filter((inv) => isInvoiceOutstanding(inv.status)),
    [invoices],
  );

  const totalAr = useMemo(
    () => receivables.reduce((sum, inv) => sum + invoiceBalanceDue(inv), 0),
    [receivables],
  );

  if (isLoading) return <FinanceLoading />;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Accounts Receivable"
        description="Monitor outstanding customer balances and collections."
        icon={Wallet}
        extra={
          <>
            <div className="text-sm text-gray-500">
              Outstanding:{" "}
              <span className="font-semibold text-gray-800">
                <FinanceMoney value={totalAr} />
              </span>
            </div>
            <Link to="/finance/payments">
              <Button type="button" className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-1.5">
                <Banknote size={16} />
                Record payment
              </Button>
            </Link>
          </>
        }
      />

      {receivables.length === 0 ? (
        <FinanceEmptyState
          icon={Wallet}
          title="No outstanding receivables"
          description="Pending, sent, and partially paid invoices awaiting the remaining balance."
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">Invoice</th>
                <th className="text-left font-medium px-4 py-3">Customer</th>
                <th className="text-left font-medium px-4 py-3">Due date</th>
                <th className="text-left font-medium px-4 py-3">Aging</th>
                <th className="text-right font-medium px-4 py-3">Amount</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {receivables.map((inv) => {
                const overdue = daysOverdue(inv.dueDate);
                const remaining = invoiceBalanceDue(inv);
                return (
                  <tr key={inv.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-medium text-gray-800">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{inv.customerName}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(inv.dueDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={agingLabel(overdue)} tone={agingTone(overdue)} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      <FinanceMoney value={remaining} currency={inv.currency} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/invoices/${inv.id}`}
                          className="p-2 rounded-lg hover:bg-gray-50 text-[#2563EB] inline-flex items-center gap-1 text-xs font-medium"
                        >
                          View <ExternalLink size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
