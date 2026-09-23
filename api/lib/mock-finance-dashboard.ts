export function mockFinanceDashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    currency: "USD",
    period: {
      startDate: `${year}-01-01`,
      endDate: `${year}-${month}-${day}`,
    },
    totalRevenueYtd: 248500,
    revenueYoYPct: 18,
    totalReceivedYtd: 214750,
    receivedYoYPct: 16,
    outstandingReceivable: 34250,
    outstandingMoMPct: 8,
    totalExpensesYtd: 0,
    expensesYoYPct: 0,
    netProfitYtd: 214750,
    netProfitYoYPct: 16,
    cashInBank: 0,
    revenueOverview: [
      { label: "Jan", thisYear: 14000, lastYear: 11000 },
      { label: "Feb", thisYear: 15500, lastYear: 12000 },
      { label: "Mar", thisYear: 18000, lastYear: 13500 },
      { label: "Apr", thisYear: 17200, lastYear: 14000 },
      { label: "May", thisYear: 21000, lastYear: 16000 },
      { label: "Jun", thisYear: 22500, lastYear: 17000 },
      { label: "Jul", thisYear: 24000, lastYear: 18500 },
      { label: "Aug", thisYear: 25800, lastYear: 19000 },
      { label: "Sep", thisYear: 0, lastYear: 20000 },
      { label: "Oct", thisYear: 0, lastYear: 21000 },
      { label: "Nov", thisYear: 0, lastYear: 22000 },
      { label: "Dec", thisYear: 0, lastYear: 23000 },
    ],
    incomeVsExpense: {
      income: 248500,
      expense: 0,
      incomePct: 100,
      expensePct: 0,
    },
    cashFlow: {
      daily: Array.from({ length: 30 }, (_, i) => {
        const day = i + 1;
        const wave = Math.sin((day / 30) * Math.PI * 2);
        const inflow = Math.round(1600 + wave * 900);
        return { label: String(day), net: inflow, inflow, outflow: 0 };
      }),
      net: 48600,
      inflows: 48600,
      outflows: 0,
    },
    outstandingSummary: {
      total: 34250,
      d0_30: 12450,
      d31_60: 9800,
      d61_plus: 12000,
    },
    outstandingInvoices: [
      {
        id: 1,
        invoiceNumber: "INV-2041",
        customerName: "Nexus Labs",
        dueDate: "2026-07-12",
        amount: 4800,
        daysOverdue: 29,
        currency: "USD",
      },
      {
        id: 2,
        invoiceNumber: "INV-2033",
        customerName: "BrightPath Inc",
        dueDate: "2026-06-20",
        amount: 6200,
        daysOverdue: 51,
        currency: "USD",
      },
      {
        id: 3,
        invoiceNumber: "INV-2021",
        customerName: "Orbit Media",
        dueDate: "2026-05-05",
        amount: 5800,
        daysOverdue: 97,
        currency: "USD",
      },
    ],
    recentTransactions: [
      {
        id: "1",
        date: "10 Aug 2026",
        type: "Payment Received",
        description: "INV-2050 · Acme Corp",
        amount: 5200,
        status: "Received",
        statusTone: "received" as const,
        href: "/admin/invoices",
      },
      {
        id: "3",
        date: "08 Aug 2026",
        type: "Invoice Sent",
        description: "INV-2051 · Northwind",
        amount: 3400,
        status: "Sent",
        statusTone: "sent" as const,
        href: "/admin/invoices",
      },
    ],
    expenseBreakdown: [] as Array<{ name: string; amount: number; percent: number; color: string }>,
    receivableAging: [
      { label: "0-30 days", amount: 12450, percent: 36.4 },
      { label: "31-60 days", amount: 9800, percent: 28.6 },
      { label: "61-90 days", amount: 6200, percent: 18.1 },
      { label: "90+ days", amount: 5800, percent: 16.9 },
    ],
    upcomingInvoices: [
      {
        id: 10,
        invoiceNumber: "INV-2055",
        customerName: "Acme Corp",
        dueDate: "2026-08-18",
        amount: 4200,
        currency: "USD",
      },
      {
        id: 11,
        invoiceNumber: "INV-2056",
        customerName: "Globex",
        dueDate: "2026-08-22",
        amount: 2800,
        currency: "USD",
      },
    ],
    bankAccounts: [],
  };
}
