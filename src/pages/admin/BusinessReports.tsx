import { useMemo } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  BarChart3,
  Building2,
  FileText,
  Loader2,
  Wallet,
  CircleDollarSign,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/lib/permissions";
import {
  formatMoney,
  invoiceBalanceDue,
  invoicePaidAmount,
  invoiceStatusLabel,
  invoiceTotal,
  isInvoiceOutstanding,
  normalizeCurrencyCode,
  type InvoiceRecord,
} from "@/lib/invoice-store";

const COLORS = ["#10B981", "#2563EB", "#F59E0B", "#8B5CF6"];

function monthKey(dateValue: string) {
  const date = new Date(`${dateValue.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function lastNMonthKeys(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

export default function BusinessReports() {
  const { user } = useAuth();
  const canInvoices = hasPermission(user, "invoices.manage");
  const canCustomers = hasPermission(user, "customers.manage");

  const invoicesQuery = trpc.invoice.list.useQuery(undefined, { enabled: canInvoices });
  const customersQuery = trpc.customer.list.useQuery(undefined, { enabled: canCustomers });
  const { data: workspaceCurrency, isLoading: currencyLoading } =
    trpc.organization.getWorkspaceCurrency.useQuery();

  const invoices = (invoicesQuery.data ?? []) as InvoiceRecord[];
  const customers = customersQuery.data ?? [];
  const displayCurrency = normalizeCurrencyCode(workspaceCurrency?.currency);
  const loading =
    currencyLoading ||
    (canInvoices && invoicesQuery.isLoading) ||
    (canCustomers && customersQuery.isLoading);

  const report = useMemo(() => {
    const mixedCurrencies = invoices.some(
      (invoice) => normalizeCurrencyCode(invoice.currency) !== displayCurrency,
    );

    const totals = { paid: 0, outstanding: 0, draft: 0, billed: 0 };
    const statusCounts = { paid: 0, sent: 0, draft: 0, pending: 0, partial: 0 };
    const billedByCustomer = new Map<number, { id: number; name: string; amount: number }>();

    for (const invoice of invoices) {
      const amount = invoiceTotal(invoice);
      totals.billed += amount;
      if (invoice.status === "paid") statusCounts.paid += 1;
      else if (invoice.status === "sent") statusCounts.sent += 1;
      else if (invoice.status === "pending") statusCounts.pending += 1;
      else if (invoice.status === "partial") statusCounts.partial += 1;
      else statusCounts.draft += 1;
      if (invoice.status === "paid") totals.paid += amount;
      else if (isInvoiceOutstanding(invoice.status)) totals.outstanding += invoiceBalanceDue(invoice);
      else totals.draft += amount;

      const existing = billedByCustomer.get(invoice.customerId);
      if (existing) existing.amount += amount;
      else {
        billedByCustomer.set(invoice.customerId, {
          id: invoice.customerId,
          name: invoice.customerName || "Unknown client",
          amount,
        });
      }
    }

    const monthKeys = lastNMonthKeys(6);
    const billedByMonth = new Map(monthKeys.map((key) => [key, 0]));
    const paidByMonth = new Map(monthKeys.map((key) => [key, 0]));
    for (const invoice of invoices) {
      const key = monthKey(invoice.invoiceDate);
      if (!key || !billedByMonth.has(key)) continue;
      const amount = invoiceTotal(invoice);
      billedByMonth.set(key, (billedByMonth.get(key) ?? 0) + amount);
      if (invoice.status === "paid") {
        paidByMonth.set(key, (paidByMonth.get(key) ?? 0) + amount);
      } else if (invoice.status === "partial") {
        paidByMonth.set(key, (paidByMonth.get(key) ?? 0) + invoicePaidAmount(invoice));
      }
    }

    const monthly = monthKeys.map((key) => ({
      month: monthLabel(key),
      billed: billedByMonth.get(key) ?? 0,
      paid: paidByMonth.get(key) ?? 0,
    }));

    const statusChart = [
      { name: "Paid", value: statusCounts.paid, amount: totals.paid },
      { name: "Sent", value: statusCounts.sent, amount: 0 },
      { name: "Pending", value: statusCounts.pending, amount: 0 },
      { name: "Partial payment", value: statusCounts.partial, amount: 0 },
      { name: "Draft", value: statusCounts.draft, amount: totals.draft },
    ].filter((row) => row.value > 0);

    const topClients = [...billedByCustomer.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const recentInvoices = [...invoices]
      .sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)))
      .slice(0, 8);

    return {
      currency: displayCurrency,
      mixedCurrencies,
      totals,
      statusChart,
      monthly,
      topClients,
      recentInvoices,
      invoiceCount: invoices.length,
      clientCount: customers.length,
    };
  }, [invoices, customers, displayCurrency]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  };

  const stats = [
    { label: "Clients", value: String(report.clientCount), icon: Building2 },
    { label: "Invoices", value: String(report.invoiceCount), icon: FileText },
    {
      label: "Paid revenue",
      value: formatMoney(report.totals.paid, report.currency),
      icon: CircleDollarSign,
    },
    {
      label: "Outstanding",
      value: formatMoney(report.totals.outstanding, report.currency),
      icon: Wallet,
    },
  ];

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Business Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Client, invoice, and revenue totals for this workspace
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCustomers ? (
            <Link
              to="/admin/customers"
              className="h-9 px-3 rounded-lg text-sm font-medium text-[#2563EB] bg-blue-50 hover:bg-blue-100 inline-flex items-center"
            >
              Clients
            </Link>
          ) : null}
          {canInvoices ? (
            <Link
              to="/admin/invoices"
              className="h-9 px-3 rounded-lg text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] inline-flex items-center"
            >
              Invoices
            </Link>
          ) : null}
        </div>
      </motion.div>

      {report.mixedCurrencies ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Amounts are shown in {report.currency}. Some invoices use another currency.
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="bg-white border border-gray-200 rounded-xl p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={16} className="text-[#2563EB]" />
                  <span className="text-xs text-gray-500">{stat.label}</span>
                </div>
                <div className="text-xl font-bold text-[#1F2937]">{stat.value}</div>
              </div>
            ))}
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="mb-4">
                <h2 className="font-semibold text-[#1F2937]">Revenue by month</h2>
                <p className="text-xs text-gray-400 mt-0.5">Billed vs paid over the last 6 months</p>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#c2c2c2" strokeOpacity={1} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
                      formatter={(value) => formatMoney(Number(value) || 0, report.currency)}
                    />
                    <Bar dataKey="billed" fill="#93C5FD" radius={[4, 4, 0, 0]} name="Billed" />
                    <Bar dataKey="paid" fill="#2563EB" radius={[4, 4, 0, 0]} name="Paid" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-[#1F2937] mb-4">Invoice status</h2>
              {report.statusChart.length === 0 ? (
                <p className="text-sm text-gray-400 py-16 text-center">No invoices yet.</p>
              ) : (
                <>
                  <div className="h-56 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={report.statusChart}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {report.statusChart.map((_, index) => (
                            <Cell key={`status-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
                          formatter={(value, _name, item) => {
                            const amount = Number(item?.payload?.amount) || 0;
                            return [`${value} · ${formatMoney(amount, report.currency)}`, "Invoices"];
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap justify-center gap-4 mt-2">
                    {report.statusChart.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-xs text-gray-500">
                          {entry.name} ({entry.value})
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-[#1F2937]">Top clients</h2>
                <p className="text-xs text-gray-400 mt-0.5">Highest billed amounts</p>
              </div>
              {report.topClients.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 py-10">No client billing yet.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {report.topClients.map((client) => (
                    <div key={client.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="text-sm font-medium text-[#1F2937] truncate">{client.name}</div>
                      <div className="text-sm font-semibold text-[#1F2937] shrink-0">
                        {formatMoney(client.amount, report.currency)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <BarChart3 size={16} className="text-[#2563EB]" />
                <div>
                  <h2 className="font-semibold text-[#1F2937]">Recent invoices</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Latest business billing activity</p>
                </div>
              </div>
              {report.recentInvoices.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 py-10">No invoices yet.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {report.recentInvoices.map((invoice) => (
                    <Link
                      key={invoice.id}
                      to={`/admin/invoices/${invoice.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#1F2937] truncate">
                          {invoice.invoiceNumber}
                        </div>
                        <div className="text-xs text-gray-400 truncate">{invoice.customerName}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-[#1F2937]">
                          {formatMoney(invoiceTotal(invoice), invoice.currency || report.currency)}
                        </div>
                        <div className="text-xs text-gray-400">{invoiceStatusLabel(invoice.status)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </motion.div>
  );
}
