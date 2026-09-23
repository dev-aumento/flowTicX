import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DEPARTMENT_OPTIONS } from "@/lib/department-options";
import { trpc } from "@/providers/trpc";
import type { CustomerRecord } from "@/components/customers/NewCustomerForm";
import { InvoicePdfPreview } from "@/components/invoices/InvoicePdfPreview";
import { ProjectSearchSelect } from "@/components/tasks/ProjectSearchSelect";
import {
  formatInvoiceTaskHours,
  formatMoney,
  INVOICE_CURRENCIES,
  INVOICE_PAYMENT_STATUS_OPTIONS,
  invoiceItemFromProjectHours,
  invoiceItemFromProjectTask,
  invoiceSubTotal,
  invoiceTotal,
  lineAmount,
  nextInvoiceNumber,
  normalizeHsnSac,
  paymentStatusFromInvoice,
  PROJECT_INVOICE_LINE_TITLE,
  resolveInvoicePayment,
  type InvoiceFormValues,
  type InvoiceLineItem,
  type InvoicePaymentStatus,
  type InvoiceRecord,
} from "@/lib/invoice-store";

const fieldClass =
  "h-10 rounded-lg border border-gray-200 bg-white text-sm text-[#1F2937] focus-visible:border-[#2563EB] focus-visible:ring-[#2563EB]/30";
const selectClass = cn(
  fieldClass,
  "w-full px-3 outline-none focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/30",
);

const INVOICE_EXCLUDE_ROLE_OPTIONS = DEPARTMENT_OPTIONS.filter(
  (role) => role !== "Administrator" && role !== "HR" && role !== "Finance",
);

const TERMS = [
  { value: "due_on_receipt", label: "Due on Receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
];

function todayInputDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthStartInputDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function emptyItem(): InvoiceLineItem {
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    itemDetails: "",
    quantity: 1,
    rate: 0,
    discountPercent: 0,
    taxPercent: 0,
  };
}

/** Empty when zero so typing 5000 does not become 05000. Placeholder shows 0. */
function PlaceholderZeroInput({
  value,
  onChange,
  className,
  title,
  id,
  allowNegative = false,
  min,
}: {
  value: number;
  onChange: (next: number) => void;
  className?: string;
  title?: string;
  id?: string;
  allowNegative?: boolean;
  min?: number;
}) {
  const [text, setText] = useState(() => (value === 0 ? "" : String(value)));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setText(value === 0 ? "" : String(value));
  }, [value]);

  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      title={title}
      placeholder="0"
      value={text}
      className={className}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = Number(text);
        const next = text === "" || text === "-" || text === "." || text === "-." || !Number.isFinite(parsed)
          ? 0
          : parsed;
        const clamped = min != null ? Math.max(min, next) : next;
        onChange(clamped);
        setText(clamped === 0 ? "" : String(clamped));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          setText("");
          onChange(0);
          return;
        }
        if (allowNegative && raw === "-") {
          setText(raw);
          return;
        }
        if (raw === "." || (allowNegative && raw === "-.")) {
          setText(raw);
          return;
        }
        if (!pattern.test(raw)) return;
        setText(raw);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        onChange(min != null ? Math.max(min, parsed) : parsed);
      }}
    />
  );
}

function InvoiceRoleExcludeSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Set(value), [value]);
  const label =
    value.length === 0
      ? "None — include all roles"
      : value.length <= 2
        ? value.join(", ")
        : `${value.slice(0, 2).join(", ")} +${value.length - 2}`;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            selectClass,
            "flex items-center justify-between gap-2 text-left",
          )}
          aria-label="Roles to exclude from timers"
        >
          <span className={cn("truncate", value.length === 0 && "text-gray-400")}>
            {label}
          </span>
          <ChevronDown size={14} className="shrink-0 text-gray-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(100%,280px)] p-2 rounded-xl border border-gray-200 bg-white shadow-lg"
        sideOffset={6}
      >
        <p className="px-2 pt-1 pb-2 text-[11px] text-gray-500">
          Hours from selected designations are left out of automatic timers.
        </p>
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {INVOICE_EXCLUDE_ROLE_OPTIONS.map((role) => {
            const checked = selected.has(role);
            return (
              <label
                key={role}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => {
                    onChange(
                      checked ? value.filter((item) => item !== role) : [...value, role],
                    );
                  }}
                />
                <span className="flex-1">{role}</span>
                {checked ? <Check size={12} className="text-[#2563EB]" /> : null}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type NewInvoiceFormProps = {
  onCancel: () => void;
  onSave: (invoice: InvoiceFormValues) => void | Promise<void>;
  initialInvoice?: InvoiceRecord;
  customers: CustomerRecord[];
  existingInvoices?: Pick<InvoiceRecord, "invoiceNumber">[];
  saving?: boolean;
};

export function NewInvoiceForm({
  onCancel,
  onSave,
  initialInvoice,
  customers,
  existingInvoices = [],
  saving = false,
}: NewInvoiceFormProps) {
  const isEditing = Boolean(initialInvoice);
  const [customerId, setCustomerId] = useState<number | "">(
    initialInvoice?.customerId ?? "",
  );
  const [invoiceNumber, setInvoiceNumber] = useState(
    () => initialInvoice?.invoiceNumber ?? nextInvoiceNumber(existingInvoices),
  );
  const [orderNumber, setOrderNumber] = useState(initialInvoice?.orderNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initialInvoice?.invoiceDate ?? todayInputDate());
  const [periodStart, setPeriodStart] = useState(
    initialInvoice?.periodStart || initialInvoice?.invoiceDate || monthStartInputDate(),
  );
  const [periodEnd, setPeriodEnd] = useState(
    initialInvoice?.periodEnd || initialInvoice?.invoiceDate || todayInputDate(),
  );
  const [terms, setTerms] = useState(initialInvoice?.terms ?? "due_on_receipt");
  const [dueDate, setDueDate] = useState(initialInvoice?.dueDate ?? todayInputDate());
  const [salesperson, setSalesperson] = useState(initialInvoice?.salesperson ?? "");
  const [hsnSac, setHsnSac] = useState(() => normalizeHsnSac(initialInvoice?.hsnSac ?? ""));
  const [currency, setCurrency] = useState(
    () => initialInvoice?.currency || "INR",
  );
  const [items, setItems] = useState<InvoiceLineItem[]>(
    () => (initialInvoice?.items?.length ? initialInvoice.items : [emptyItem()]),
  );
  const [customerNotes, setCustomerNotes] = useState(
    initialInvoice?.customerNotes ?? "Thanks for your business.",
  );
  const [shippingCharges, setShippingCharges] = useState(initialInvoice?.shippingCharges ?? 0);
  const [taxMode, setTaxMode] = useState<"tds" | "tcs" | "none">(initialInvoice?.taxMode ?? "none");
  const [taxPercent, setTaxPercent] = useState(initialInvoice?.taxPercent ?? 0);
  const [adjustment, setAdjustment] = useState(initialInvoice?.adjustment ?? 0);
  const [roundOff, setRoundOff] = useState(initialInvoice?.roundOff ?? false);
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus>(
    () => paymentStatusFromInvoice(initialInvoice?.status),
  );
  const [amountPaidInput, setAmountPaidInput] = useState(
    () => Number(initialInvoice?.amountPaid) || 0,
  );
  const [error, setError] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<"manual" | "automatic">(
    initialInvoice?.autoInvoiceType ? "automatic" : "manual",
  );
  const [autoInvoiceType, setAutoInvoiceType] = useState<"task" | "project">(
    initialInvoice?.autoInvoiceType === "project" ? "project" : "task",
  );
  const [projectId, setProjectId] = useState<number | undefined>(
    initialInvoice?.projectId ?? undefined,
  );
  const [excludeDepartments, setExcludeDepartments] = useState<string[]>(
    () => initialInvoice?.excludeDepartments ?? [],
  );
  const filledProjectRef = useRef<number | null>(null);
  const filledHoursRef = useRef<string | null>(null);
  const itemsDirtyRef = useRef(false);
  const projectLineTitleRef = useRef(PROJECT_INVOICE_LINE_TITLE);
  const skipInitialAutoFillRef = useRef(
    Boolean(initialInvoice?.projectId && initialInvoice?.autoInvoiceType),
  );

  const periodValid = Boolean(periodStart && periodEnd && periodStart <= periodEnd);

  const { data: projectsData } = trpc.project.listForPicker.useQuery(undefined, {
    enabled: entryMode === "automatic",
  });
  const excludeSignature = excludeDepartments.slice().sort().join("|");
  const { data: taskLines, isLoading: loadingTaskLines } =
    trpc.invoice.listProjectTaskLines.useQuery(
      { projectId: projectId!, periodStart, periodEnd, excludeDepartments },
      {
        enabled: entryMode === "automatic" && projectId != null && periodValid,
        staleTime: 0,
        refetchOnMount: "always",
      },
    );

  const taskHoursSignature = useMemo(() => {
    if (!taskLines?.tasks) return "";
    return taskLines.tasks.map((task) => `${task.id}:${task.hours}`).join("|");
  }, [taskLines]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId],
  );
  const hourlyRate = Math.max(0, Number(selectedCustomer?.hourlyRate) || 0);
  const hourlyRateRef = useRef(hourlyRate);
  hourlyRateRef.current = hourlyRate;

  const projects = useMemo(() => {
    const all = projectsData ?? [];
    if (!selectedCustomer) return all;
    const names = [selectedCustomer.displayName, selectedCustomer.companyName]
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    if (names.length === 0) return all;
    const matched = all.filter((project) => {
      const clientName = (project.clientName ?? "").trim().toLowerCase();
      return clientName && names.some((name) => clientName === name || clientName.includes(name));
    });
    return matched.length > 0 ? matched : all;
  }, [projectsData, selectedCustomer]);
  const subTotal = invoiceSubTotal(items);
  const total = invoiceTotal({
    items,
    shippingCharges,
    taxMode,
    taxPercent,
    adjustment,
    roundOff,
  });
  const amountPaid =
    paymentStatus === "paid"
      ? total
      : paymentStatus === "partial"
        ? Math.max(0, Number(amountPaidInput) || 0)
        : 0;
  const balanceDue = Math.max(0, total - amountPaid);
  const igstAmount =
    taxMode === "none" && taxPercent > 0
      ? (subTotal * Number(taxPercent)) / 100
      : 0;
  const tdsTcsAmount =
    (taxMode === "tds" || taxMode === "tcs") && taxPercent > 0
      ? (subTotal * Number(taxPercent)) / 100
      : 0;

  useEffect(() => {
    if (entryMode !== "automatic") {
      filledProjectRef.current = null;
      filledHoursRef.current = null;
      return;
    }
    if (projectId == null || loadingTaskLines || !taskLines || !periodValid) return;
    const fillKey = `${projectId}:${autoInvoiceType}:${periodStart}:${periodEnd}:${taskHoursSignature}:${hourlyRate}:${excludeSignature}`;
    if (skipInitialAutoFillRef.current) {
      skipInitialAutoFillRef.current = false;
      filledHoursRef.current = fillKey;
      filledProjectRef.current = projectId;
      return;
    }
    if (filledHoursRef.current === fillKey) return;
    filledProjectRef.current = projectId;
    filledHoursRef.current = fillKey;
    if (autoInvoiceType === "project") {
      const totalHours = taskLines.tasks.reduce((sum, task) => sum + task.hours, 0);
      setItems((prev) => {
        const existingId = prev.length === 1 ? prev[0]?.id : undefined;
        return [
          invoiceItemFromProjectHours(
            totalHours,
            hourlyRateRef.current,
            projectLineTitleRef.current || PROJECT_INVOICE_LINE_TITLE,
            existingId,
          ),
        ];
      });
    } else {
      itemsDirtyRef.current = false;
      const nextItems = taskLines.tasks.map((task) =>
        invoiceItemFromProjectTask(task, hourlyRateRef.current),
      );
      setItems(nextItems.length > 0 ? nextItems : [emptyItem()]);
    }
    setError(null);
  }, [
    autoInvoiceType,
    entryMode,
    hourlyRate,
    isEditing,
    loadingTaskLines,
    periodEnd,
    periodStart,
    periodValid,
    projectId,
    taskHoursSignature,
    taskLines,
    excludeSignature,
  ]);

  const previewInvoice = useMemo<InvoiceRecord | null>(() => {
    const previewItems = items.filter((item) => item.itemDetails.trim());
    if (!selectedCustomer && previewItems.length === 0 && !invoiceNumber.trim()) {
      return null;
    }
    return {
      id: initialInvoice?.id ?? 0,
      invoiceNumber: invoiceNumber.trim() || "Aumento/—",
      orderNumber: orderNumber.trim(),
      customerId: typeof customerId === "number" ? customerId : 0,
      customerName: selectedCustomer?.displayName || "Select a customer",
      currency,
      invoiceDate: invoiceDate || todayInputDate(),
      periodStart,
      periodEnd,
      terms,
      dueDate: dueDate || invoiceDate || todayInputDate(),
      salesperson: salesperson.trim(),
      hsnSac,
      items: previewItems.length > 0 ? previewItems : [
        {
          id: "preview_placeholder",
          itemDetails: "Item details will appear here",
          quantity: 0,
          rate: 0,
          discountPercent: 0,
          taxPercent: 0,
        },
      ],
      customerNotes,
      shippingCharges: Number(shippingCharges) || 0,
      taxMode,
      taxPercent: Number(taxPercent) || 0,
      adjustment: Number(adjustment) || 0,
      roundOff,
      status: paymentStatus,
      amountPaid,
      createdAt: initialInvoice?.createdAt ?? new Date().toISOString(),
    };
  }, [
    adjustment,
    amountPaid,
    customerId,
    customerNotes,
    currency,
    dueDate,
    initialInvoice?.createdAt,
    initialInvoice?.id,
    invoiceDate,
    invoiceNumber,
    items,
    hsnSac,
    orderNumber,
    paymentStatus,
    periodEnd,
    periodStart,
    roundOff,
    salesperson,
    selectedCustomer,
    shippingCharges,
    taxMode,
    taxPercent,
    terms,
  ]);

  function updateItem(id: string, patch: Partial<InvoiceLineItem>) {
    itemsDirtyRef.current = true;
    if (patch.itemDetails !== undefined && autoInvoiceType === "project") {
      projectLineTitleRef.current = patch.itemDetails;
    }
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeItem(id: string) {
    itemsDirtyRef.current = true;
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((item) => item.id !== id)));
  }

  function selectEntryMode(next: "manual" | "automatic") {
    setEntryMode(next);
    setError(null);
    if (next === "automatic") {
      filledProjectRef.current = null;
      filledHoursRef.current = null;
      skipInitialAutoFillRef.current = false;
      itemsDirtyRef.current = false;
      projectLineTitleRef.current = PROJECT_INVOICE_LINE_TITLE;
    }
  }

  function selectAutoInvoiceType(next: "task" | "project") {
    setAutoInvoiceType(next);
    setError(null);
    filledProjectRef.current = null;
    filledHoursRef.current = null;
    skipInitialAutoFillRef.current = false;
    itemsDirtyRef.current = false;
    projectLineTitleRef.current = PROJECT_INVOICE_LINE_TITLE;
  }

  async function persist(asDraft: boolean) {
    if (customerId === "" || !selectedCustomer) {
      setError("Please select a customer.");
      return;
    }
    if (!invoiceNumber.trim()) {
      setError("Invoice number is required.");
      return;
    }
    if (!invoiceDate) {
      setError("Invoice date is required.");
      return;
    }
    if (!periodStart || !periodEnd) {
      setError("Select the invoice start date and end date.");
      return;
    }
    if (periodStart > periodEnd) {
      setError("End date must be on or after the start date.");
      return;
    }
    if (entryMode === "automatic" && projectId == null) {
      setError("Select a project for automatic invoices.");
      return;
    }
    const validItems = items.filter((item) => item.itemDetails.trim());
    if (validItems.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (!asDraft && paymentStatus === "partial") {
      if (amountPaid <= 0) {
        setError("Enter how much has been paid for a partial payment.");
        return;
      }
      if (amountPaid >= total && total > 0) {
        setError("Partial payment must be less than the invoice total.");
        return;
      }
    }

    const payment = resolveInvoicePayment({
      status: asDraft ? "draft" : paymentStatus,
      amountPaid,
      total,
    });

    await onSave({
      id: initialInvoice?.id,
      invoiceNumber: invoiceNumber.trim(),
      orderNumber: orderNumber.trim(),
      customerId,
      customerName: selectedCustomer.displayName,
      currency,
      invoiceDate,
      periodStart,
      periodEnd,
      terms,
      dueDate: dueDate || invoiceDate,
      salesperson: salesperson.trim(),
      hsnSac,
      items: validItems.map((item) => ({ ...item, taxPercent: 0 })),
      customerNotes,
      shippingCharges: Number(shippingCharges) || 0,
      taxMode,
      taxPercent: Number(taxPercent) || 0,
      adjustment: Number(adjustment) || 0,
      roundOff,
      status: payment.status,
      amountPaid: payment.amountPaid,
      projectId: entryMode === "automatic" ? projectId ?? null : null,
      excludeDepartments: entryMode === "automatic" ? excludeDepartments : [],
      autoInvoiceType: entryMode === "automatic" ? autoInvoiceType : null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">
            {isEditing ? "Edit Invoice" : "New Invoice"}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isEditing
              ? "Update invoice details and line items"
              : "Create and save a customer invoice"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="border-gray-200 text-gray-600"
        >
          <X size={16} />
          Close
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start min-w-0">
        <div className="space-y-5 min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 gap-5">
              <div>
                <Label className="text-sm font-medium mb-1.5 block">
                  Customer Name *
                </Label>
                <select
                  value={customerId === "" ? "" : String(customerId)}
                  onChange={(e) => {
                    const nextId = e.target.value ? Number(e.target.value) : "";
                    setCustomerId(nextId);
                    if (typeof nextId === "number") {
                      const customer = customers.find((c) => c.id === nextId);
                      if (customer?.currency) setCurrency(customer.currency);
                    }
                    setError(null);
                  }}
                  className={cn(selectClass, "w-full")}
                >
                  <option value="">Select or add a customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    Invoice# *
                  </Label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    Currency
                  </Label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className={selectClass}
                  >
                    {INVOICE_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                    {!INVOICE_CURRENCIES.some((c) => c.code === currency) && currency ? (
                      <option value={currency}>{currency}</option>
                    ) : null}
                  </select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    Order Number
                  </Label>
                  <Input
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  HSN/SAC
                </Label>
                <Input
                  value={hsnSac}
                  onChange={(e) => setHsnSac(normalizeHsnSac(e.target.value))}
                  placeholder="e.g. 998314"
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(fieldClass, "uppercase font-mono tracking-wide")}
                />
              </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Start date *
                </Label>
                <Input
                  type="date"
                  value={periodStart}
                  max={periodEnd || undefined}
                  onChange={(e) => {
                    setPeriodStart(e.target.value);
                    filledHoursRef.current = null;
                    setError(null);
                  }}
                  className={fieldClass}
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  End date *
                </Label>
                <Input
                  type="date"
                  value={periodEnd}
                  min={periodStart || undefined}
                  onChange={(e) => {
                    setPeriodEnd(e.target.value);
                    filledHoursRef.current = null;
                    setError(null);
                  }}
                  className={fieldClass}
                />
              </div>
              <p className="sm:col-span-2 text-xs text-gray-500 -mt-2">
                The invoice covers work between these dates. Automatic hours come from timers run in this period, including on tasks created earlier.
              </p>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Invoice Date *
                </Label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">Terms</Label>
                <select
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  className={selectClass}
                >
                  {TERMS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Salesperson
                </Label>
                <Input
                  value={salesperson}
                  onChange={(e) => setSalesperson(e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#1F2937]">Line items</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {entryMode === "automatic"
                        ? autoInvoiceType === "project"
                          ? "Timers from all project tasks in the selected dates are summed into one line. You can edit the title and hours."
                          : "Each task is a line item with hours logged in the selected dates. Rate comes from the client's hourly rate. You can still edit any row."
                        : "Add items and amounts yourself."}
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5"
                    role="radiogroup"
                    aria-label="Invoice item entry mode"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={entryMode === "manual"}
                      onClick={() => selectEntryMode("manual")}
                      className={cn(
                        "h-8 px-3 rounded-md text-xs font-semibold transition-colors",
                        entryMode === "manual"
                          ? "bg-white text-[#1F2937] shadow-sm"
                          : "text-gray-500 hover:text-gray-700",
                      )}
                    >
                      Manually
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={entryMode === "automatic"}
                      onClick={() => selectEntryMode("automatic")}
                      className={cn(
                        "h-8 px-3 rounded-md text-xs font-semibold transition-colors",
                        entryMode === "automatic"
                          ? "bg-white text-[#1F2937] shadow-sm"
                          : "text-gray-500 hover:text-gray-700",
                      )}
                    >
                      Automatically
                    </button>
                  </div>
                </div>
                {entryMode === "automatic" ? (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                        Project *
                      </Label>
                      <ProjectSearchSelect
                        projects={projects}
                        value={projectId ?? null}
                        onValueChange={(id) => {
                          if (id !== projectId) {
                            filledProjectRef.current = null;
                            filledHoursRef.current = null;
                            skipInitialAutoFillRef.current = false;
                            itemsDirtyRef.current = false;
                            projectLineTitleRef.current = PROJECT_INVOICE_LINE_TITLE;
                          }
                          setProjectId(id);
                          setError(null);
                        }}
                        placeholder="Select a project"
                        searchPlaceholder="Search projects…"
                        allowClear
                      />
                      {customerId === "" ? (
                        <p className="text-xs text-amber-600 mt-1.5">
                          Select a customer first so the project list and hourly rate can be applied.
                        </p>
                      ) : hourlyRate <= 0 ? (
                        <p className="text-xs text-amber-600 mt-1.5">
                          This client has no hourly rate yet. Add it in Clients, or edit the rate on each row.
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500 mt-1.5">
                          Hourly rate from client: {formatMoney(hourlyRate, currency)}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                        Invoice type *
                      </Label>
                      <div
                        className="flex flex-wrap items-center gap-1 rounded-lg bg-gray-100 p-0.5 w-fit"
                        role="radiogroup"
                        aria-label="Automatic invoice type"
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={autoInvoiceType === "task"}
                          onClick={() => selectAutoInvoiceType("task")}
                          className={cn(
                            "h-8 px-3 rounded-md text-xs font-semibold transition-colors",
                            autoInvoiceType === "task"
                              ? "bg-white text-[#1F2937] shadow-sm"
                              : "text-gray-500 hover:text-gray-700",
                          )}
                        >
                          Task based
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={autoInvoiceType === "project"}
                          onClick={() => selectAutoInvoiceType("project")}
                          className={cn(
                            "h-8 px-3 rounded-md text-xs font-semibold transition-colors",
                            autoInvoiceType === "project"
                              ? "bg-white text-[#1F2937] shadow-sm"
                              : "text-gray-500 hover:text-gray-700",
                          )}
                        >
                          Project based
                        </button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                        Roles to exclude
                      </Label>
                      <InvoiceRoleExcludeSelect
                        value={excludeDepartments}
                        onChange={(next) => {
                          setExcludeDepartments(next);
                          filledHoursRef.current = null;
                          skipInitialAutoFillRef.current = false;
                          setError(null);
                        }}
                      />
                      <p className="text-xs text-gray-500 mt-1.5">
                        Select designations such as QA so their timer hours are not billed.
                      </p>
                    </div>
                    {!periodValid ? (
                      <p className="text-xs text-amber-600">
                        Select a valid start and end date to load hours for this period.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {entryMode === "automatic" && loadingTaskLines ? (
                  <p className="text-xs text-gray-500">Loading project tasks…</p>
                ) : null}
                {entryMode === "automatic" &&
                projectId != null &&
                !loadingTaskLines &&
                (taskLines?.tasks.length ?? 0) === 0 ? (
                  <p className="text-xs text-amber-600">
                    This project has no tasks yet. Add items below, or pick another project.
                  </p>
                ) : null}
              </div>
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:grid grid-cols-[minmax(0,2fr)_88px_90px_80px_90px_36px] gap-2">
              <span>Item Details</span>
              <span>{entryMode === "automatic" ? "Hours" : "Qty"}</span>
              <span>Rate</span>
              <span>Disc %</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            <div className="divide-y divide-gray-100">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-3 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_88px_90px_80px_90px_36px] gap-2 items-center"
                >
                  <Input
                    value={item.itemDetails}
                    onChange={(e) => updateItem(item.id, { itemDetails: e.target.value })}
                    placeholder="Type or click to select an item"
                    className={fieldClass}
                  />
                  <PlaceholderZeroInput
                    min={0}
                    value={item.quantity}
                    title={
                      entryMode === "automatic" ? formatInvoiceTaskHours(item.quantity) : undefined
                    }
                    onChange={(quantity) => updateItem(item.id, { quantity })}
                    className={fieldClass}
                  />
                  <PlaceholderZeroInput
                    min={0}
                    value={item.rate}
                    onChange={(rate) => updateItem(item.id, { rate })}
                    className={fieldClass}
                  />
                  <PlaceholderZeroInput
                    min={0}
                    value={item.discountPercent}
                    onChange={(discountPercent) => updateItem(item.id, { discountPercent })}
                    className={fieldClass}
                  />
                  <div className="text-sm font-medium text-gray-700 text-right">
                    {formatMoney(lineAmount(item), currency)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="justify-self-end text-gray-400 hover:text-red-500"
                    aria-label="Remove item"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  itemsDirtyRef.current = true;
                  setItems((prev) => [
                    ...prev,
                    entryMode === "automatic" ? { ...emptyItem(), rate: hourlyRate } : emptyItem(),
                  ]);
                }}
                className="border-gray-200 text-gray-700 gap-2"
              >
                <Plus size={16} />
                Add New Row
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <Label className="text-sm font-medium text-gray-700">Customer Notes</Label>
              <Textarea
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                rows={3}
                className="rounded-lg border-gray-200"
              />
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Sub Total</span>
                <span className="font-medium text-gray-800">{formatMoney(subTotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm text-gray-600">Shipping Charges</Label>
                <PlaceholderZeroInput
                  min={0}
                  value={shippingCharges}
                  onChange={setShippingCharges}
                  className={cn(fieldClass, "max-w-[140px]")}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={taxMode} onChange={(e) => setTaxMode(e.target.value as "tds" | "tcs" | "none")} className={cn(selectClass, "w-[110px]")}>
                  <option value="none">Tax</option>
                  <option value="tds">TDS</option>
                  <option value="tcs">TCS</option>
                </select>
                <PlaceholderZeroInput
                  min={0}
                  value={taxPercent}
                  onChange={setTaxPercent}
                  className={cn(fieldClass, "w-[90px]")}
                />
                <span className="text-sm text-gray-500">%</span>
                {taxMode === "none" && taxPercent > 0 ? (
                  <span className="ml-auto text-sm font-medium text-gray-800">
                    {formatMoney(igstAmount, currency)}
                  </span>
                ) : null}
                {(taxMode === "tds" || taxMode === "tcs") && taxPercent > 0 ? (
                  <span className="ml-auto text-sm font-medium text-gray-800">
                    {taxMode === "tds" ? "-" : "+"}
                    {formatMoney(tdsTcsAmount, currency)}
                  </span>
                ) : null}
              </div>
              {taxMode === "none" && taxPercent > 0 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">IGST ({taxPercent}%)</span>
                  <span className="font-medium text-gray-800">{formatMoney(igstAmount, currency)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm text-gray-600">Adjustment</Label>
                <PlaceholderZeroInput
                  allowNegative
                  value={adjustment}
                  onChange={setAdjustment}
                  className={cn(fieldClass, "max-w-[140px]")}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} className="accent-[#2563EB]"/>
                Round Off
              </label>
              <div className="space-y-2">
                <Label className="text-sm text-gray-600" htmlFor="invoice-payment-status">
                  Payment status
                </Label>
                <select
                  id="invoice-payment-status"
                  value={paymentStatus}
                  onChange={(e) => {
                    const next = e.target.value as InvoicePaymentStatus;
                    setPaymentStatus(next);
                    if (next === "pending" || next === "sent") setAmountPaidInput(0);
                    if (next === "paid") setAmountPaidInput(total);
                  }}
                  className={cn(selectClass, "bg-white")}
                >
                  {INVOICE_PAYMENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {paymentStatus === "partial" ? (
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm text-gray-600" htmlFor="invoice-amount-paid">
                    Amount paid
                  </Label>
                  <PlaceholderZeroInput
                    id="invoice-amount-paid"
                    min={0}
                    value={amountPaidInput}
                    onChange={setAmountPaidInput}
                    className={cn(fieldClass, "max-w-[140px]")}
                  />
                </div>
              ) : null}
              <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-base font-semibold text-[#1F2937]">
                  Total ({currency})
                </span>
                <span className="text-xl font-bold text-[#1F2937]">{formatMoney(total, currency)}</span>
              </div>
              {amountPaid > 0 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 font-medium">Payment Made</span>
                  <span className="font-medium text-red-600">
                    (-) {formatMoney(amountPaid, currency)}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-[#1F2937]">Balance Due</span>
                <span className="text-base font-bold text-[#1F2937]">
                  {formatMoney(balanceDue, currency)}
                </span>
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-2 pb-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => void persist(true)} className="border-gray-200 text-gray-700">
              {saving ? "Saving…" : isEditing ? "Update as Draft" : "Save as Draft"}
            </Button>
            <Button type="button" disabled={saving} onClick={() => void persist(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
              {saving ? "Saving…" : isEditing ? "Update" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} className="border-gray-200 text-gray-600">
              Cancel
            </Button>
          </div>
        </div>

        <InvoicePdfPreview
          invoice={previewInvoice}
          customer={selectedCustomer ?? null}
          useCurrentDate
          className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)]"
        />
      </div>
    </div>
  );
}
