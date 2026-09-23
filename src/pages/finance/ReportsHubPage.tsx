import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  Landmark,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  FinanceLoading,
  FinanceMoney,
  FinancePageHeader,
} from "@/components/finance/FinancePageKit";

type ReportSection = "profit-loss" | "cash-flow" | "balance-sheet";

const SECTIONS: { id: ReportSection; label: string; icon: typeof TrendingUp }[] = [
  { id: "profit-loss", label: "Profit & Loss", icon: TrendingUp },
  { id: "cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { id: "balance-sheet", label: "Balance Sheet", icon: Landmark },
];

const SECTION_PATHS: Record<ReportSection, string> = {
  "profit-loss": "/finance/profit-loss",
  "cash-flow": "/finance/cash-flow",
  "balance-sheet": "/finance/balance-sheet",
};

const QUICK_LINKS = [
  { to: "/finance/receivable", label: "Accounts Receivable", icon: Wallet },
  { to: "/finance/payable", label: "Accounts Payable", icon: Receipt },
  { to: "/finance/payments", label: "Payments", icon: ArrowLeftRight },
  { to: "/finance/expenses", label: "Expenses", icon: Receipt },
  { to: "/finance/banks", label: "Bank Accounts", icon: Building2 },
  { to: "/finance/tax", label: "Tax & Compliance", icon: BarChart3 },
];

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

function sectionFromPathname(pathname: string): ReportSection {
  if (pathname.includes("/cash-flow")) return "cash-flow";
  if (pathname.includes("/balance-sheet")) return "balance-sheet";
  if (pathname.includes("/profit-loss")) return "profit-loss";
  return "profit-loss";
}

export default function ReportsHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = sectionFromPathname(location.pathname);

  const { data, isLoading } = trpc.finance.reports.summary.useQuery();

  const equity = useMemo(() => {
    if (!data) return 0;
    return data.cashInBank + data.accountsReceivable - data.accountsPayable;
  }, [data]);

  useEffect(() => {
    if (isLoading || !data) return;
    const el = document.getElementById(activeTab);
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeTab, isLoading, data]);

  function selectSection(id: ReportSection) {
    navigate(SECTION_PATHS[id]);
  }

  if (isLoading || !data) return <FinanceLoading />;

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Financial Reports"
        description="Profit & loss, cash flow, and balance sheet from your live books."
        icon={BarChart3}
      />

      <div className="flex flex-wrap gap-2 sticky top-0 z-10 bg-gray-50/95 backdrop-blur py-2 -mx-1 px-1">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectSection(id)}
            className={`h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${
              activeTab === id
                ? "bg-[#2563EB] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <section id="profit-loss" className="scroll-mt-24 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <TrendingUp size={18} className="text-[#2563EB]" />
          Profit & Loss
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard label="Income" value={data.income} hint="Sent & paid invoices" />
          <SummaryCard
            label="Expenses"
            value={data.expenses}
            hint="Recorded expenses"
            tone="negative"
          />
          <SummaryCard
            label="Net profit"
            value={data.netProfit}
            hint="Received minus expenses"
            tone={data.netProfit >= 0 ? "positive" : "negative"}
          />
        </div>
        {data.expenseBreakdown.length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Expense breakdown</h3>
            </div>
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
                    <td className="px-4 py-2.5 text-right font-semibold">
                      <FinanceMoney value={row.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section id="cash-flow" className="scroll-mt-24 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <ArrowLeftRight size={18} className="text-[#2563EB]" />
          Cash Flow
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SummaryCard
            label="Cash in bank"
            value={data.cashInBank}
            hint="Sum of bank account balances"
          />
          <SummaryCard
            label="Payments received"
            value={data.received}
            hint="Total recorded payments"
            tone="positive"
          />
        </div>
        {data.bankAccounts.length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Bank accounts</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Account</th>
                  <th className="text-left font-medium px-4 py-2">Bank</th>
                  <th className="text-right font-medium px-4 py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.bankAccounts.map((bank) => (
                  <tr key={bank.id} className="border-t border-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{bank.name}</td>
                    <td className="px-4 py-2.5 text-gray-500">{bank.bankName}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      <FinanceMoney value={bank.balance} currency={bank.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section id="balance-sheet" className="scroll-mt-24 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Landmark size={18} className="text-[#2563EB]" />
          Balance Sheet
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Accounts receivable"
            value={data.accountsReceivable}
            hint="Sent invoices outstanding"
          />
          <SummaryCard
            label="Accounts payable"
            value={data.accountsPayable}
            hint="Open vendor bills"
            tone="negative"
          />
          <SummaryCard label="Cash" value={data.cashInBank} hint="Bank balances" />
          <SummaryCard
            label="Equity (plug)"
            value={equity}
            hint="Cash + AR − AP"
            tone={equity >= 0 ? "positive" : "negative"}
          />
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm text-sm">
          <h3 className="font-semibold text-gray-800 mb-3">Balance sheet equation</h3>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-gray-500">Cash in bank</dt>
              <dd className="font-medium">
                <FinanceMoney value={data.cashInBank} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">+ Accounts receivable</dt>
              <dd className="font-medium">
                <FinanceMoney value={data.accountsReceivable} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">− Accounts payable</dt>
              <dd className="font-medium text-red-600">
                <FinanceMoney value={data.accountsPayable} />
              </dd>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold text-gray-800">
              <dt>= Equity (plug)</dt>
              <dd>
                <FinanceMoney value={equity} />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Quick links</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:border-[#2563EB]/30 hover:bg-blue-50/30 inline-flex items-center gap-2 transition-colors"
            >
              <Icon size={16} className="text-[#2563EB]" />
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
