import { Link } from "react-router";
import { Receipt, Scale } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  FinanceLoading,
  FinanceMoney,
  FinancePageHeader,
} from "@/components/finance/FinancePageKit";

function SummaryCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-red-600"
        : "text-gray-800";
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${valueClass}`}>
        <FinanceMoney value={value} />
      </p>
      {hint ? <p className="text-xs text-gray-400 mt-1">{hint}</p> : null}
    </div>
  );
}

export default function TaxCompliancePage() {
  const { data, isLoading } = trpc.finance.reports.summary.useQuery();

  if (isLoading || !data) return <FinanceLoading />;

  const netTaxPosition = data.taxCollected - (data.expenses > 0 ? Math.round(data.expenses * 0.18) : 0);

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Tax & Compliance"
        description="GST, TDS/TCS, and compliance summaries for your books."
        icon={Scale}
        extra={
          <Link
            to="/finance/reports"
            className="text-sm text-[#2563EB] hover:underline font-medium"
          >
            View all reports →
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Tax collected"
          value={data.taxCollected}
          hint="From invoice line taxes"
        />
        <SummaryCard label="Income" value={data.income} hint="Sent & paid invoices" />
        <SummaryCard label="Expenses" value={data.expenses} hint="Recorded expenses" tone="negative" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-2">Compliance snapshot</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between border-b border-gray-50 pb-2">
            <dt className="text-gray-500">Taxable income (approx.)</dt>
            <dd className="font-medium text-gray-800">
              <FinanceMoney value={data.income} />
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-50 pb-2">
            <dt className="text-gray-500">Tax collected on sales</dt>
            <dd className="font-medium text-gray-800">
              <FinanceMoney value={data.taxCollected} />
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-50 pb-2">
            <dt className="text-gray-500">Total deductible expenses</dt>
            <dd className="font-medium text-gray-800">
              <FinanceMoney value={data.expenses} />
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-50 pb-2">
            <dt className="text-gray-500">Net tax position (est.)</dt>
            <dd className={`font-medium ${netTaxPosition >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              <FinanceMoney value={netTaxPosition} />
            </dd>
          </div>
        </dl>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
          <Receipt size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-800">Expense breakdown by category</h2>
        </div>
        {data.expenseBreakdown.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-8 text-center">
            No recorded expenses yet. Add expenses to see category breakdown.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 py-2">Category</th>
                <th className="text-right font-medium px-4 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.expenseBreakdown.map((row) => (
                <tr key={row.name} className="border-t border-gray-50">
                  <td className="px-4 py-2.5 text-gray-700">{row.name}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-800">
                    <FinanceMoney value={row.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800">
        This page provides a working summary from your live books. Consult your tax advisor before
        filing returns — export detailed reports from{" "}
        <Link to="/finance/reports" className="font-semibold underline">
          Financial Reports
        </Link>
        .
      </div>
    </div>
  );
}
