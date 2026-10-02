export type UserRole =
  | "admin"
  | "manager"
  | "employee"
  | "hr"
  | "client"
  | "finance"
  | "platform";
export type WorkspaceType = "client" | "standard" | "platform";
export type SubscriptionPlan = string;
export type SubscriptionStatus = "trial" | "paid" | "unpaid" | "cancelled";
export type UserStatus = "active" | "inactive" | "suspended" | "Active" | "Inactive" | "Suspended";
export type EmploymentType = "full_time" | "intern";
export type SexOption = "male" | "female" | "other" | "prefer_not_to_say";
export type ProjectStatus = "active" | "archived" | "completed";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TimeEntrySource = "web" | "mobile" | "manual";
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

export type TaskActivityAction =
  | "created"
  | "updated"
  | "status_changed"
  | "stage_changed"
  | "priority_changed"
  | "title_changed"
  | "assigned"
  | "owner_changed"
  | "commented"
  | "time_logged"
  | "subtask_completed"
  | "tag_added"
  | "participant_added"
  | "observer_added";

export type NotificationType =
  | "task_assigned"
  | "task_updated"
  | "task_created"
  | "project_created"
  | "mention"
  | "deadline_reminder"
  | "time_approved"
  | "time_rejected"
  | "time_approval_pending"
  | "employee_joined"
  | "leave_request_pending"
  | "leave_approved"
  | "leave_rejected"
  | "leave_cancelled"
  | "holiday_reminder"
  | "plan_joined"
  | "plan_updated"
  | "plan_cancelled"
  | "plan_limit"
  | "invoice_created"
  | "invoice_updated";

export type DataTransferAction = "import" | "export";
export type DataTransferDataset = "projects" | "tasks" | "hours" | "clients";
export type DataTransferFormat = "csv" | "pdf" | "docx";

export type DataTransferLogDoc = {
  id: number;
  organizationId: number;
  userId: number;
  userName: string;
  action: DataTransferAction;
  dataset: DataTransferDataset;
  format: DataTransferFormat;
  fileName: string;
  rowCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  message: string;
  createdAt: Date;
};

export type LeaveType = "paid" | "sick" | "unpaid" | "half" | "wfh";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type TimeApprovalType = "clock_in" | "break";
export type TimeApprovalStatus = "pending" | "approved" | "rejected";

/** Billing / invoice company profile shared by admin and finance for the tenant. */
export type OrganizationBillingProfile = {
  logoDataUrl: string | null;
  name: string;
  industry: string;
  businessType: string;
  location: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  zip: string;
  state: string;
  phone: string;
  fax: string;
  website: string;
  differentPaymentAddress: boolean;
  paymentAddressLine1: string;
  paymentAddressLine2: string;
  paymentCity: string;
  paymentZip: string;
  paymentState: string;
  paymentCountry: string;
  paymentPhone: string;
  primaryContactName: string;
  primaryContactEmail: string;
  baseCurrency: string;
  fiscalYear: string;
  language: string;
  timeZone: string;
  dateFormat: string;
  companyIdType: string;
  companyIdValue: string;
  taxIdType: string;
  taxIdValue: string;
  additionalFields: Array<{ id: string; label: string; value: string }>;
  /** Invoice bank details — empty until the org fills them in Settings. */
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankSwift?: string;
};

/** Tenant / workspace that owns users, projects, tasks, and related data. */
export type OrganizationDoc = {
  id: number;
  name: string;
  /**
   * Client workspaces use the Asana-style client portal for every member
   * (owner and invited teammates). Staff CRM orgs stay "standard".
   * Platform orgs belong to Aaso master admins and are excluded from the customer list.
   */
  workspaceType?: WorkspaceType;
  /** Product plan assigned by the Aaso master admin. */
  plan?: SubscriptionPlan;
  planStatus?: SubscriptionStatus;
  /** Recurring amount in INR. */
  subscriptionAmount?: number;
  purchasedAt?: Date | null;
  /** Inclusive start of the current plan window. */
  planStartsAt?: Date | null;
  /** Inclusive end of the current plan window. */
  planExpiresAt?: Date | null;
  planCancelledAt?: Date | null;
  planCancelReason?: string | null;
  planNotes?: string | null;
  /** Company details used on invoices (admin-maintained, shared with finance). */
  billingProfile?: OrganizationBillingProfile | null;
  /** Custom names for task workflow statuses shown across the workspace. */
  taskStatusLabels?: {
    todo?: string;
    in_progress?: string;
    review?: string;
    done?: string;
    deferred?: string;
  } | null;
  /** Custom names for kanban pipeline statuses (To Do, In Designing, …). */
  pipelineStageLabelOverrides?: Record<string, string> | null;
  /** Optional CRM logo for the platform console (data URL). */
  logoDataUrl?: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Catalog plan sold by the Aaso platform. */
export type SubscriptionPlanDoc = {
  id: number;
  slug: string;
  name: string;
  /** Price in INR. */
  amount: number;
  /** Price in USD for people outside India. */
  amountUsd?: number | null;
  /** month = 30 days, year = 365 days. Missing values follow durationDays. */
  billingInterval?: "month" | "year" | null;
  description: string;
  durationDays: number;
  featureKeys: string[];
  sortOrder: number;
  /** Project, seat, and storage caps. Null on a field means unlimited. */
  limits?: {
    projects: number | null;
    teamMembers: number | null;
    storageGb: number | null;
  } | null;
  highlightKeys?: string[] | null;
  badge?: string | null;
  ctaLabel?: string | null;
  storageLabel?: string | null;
  entitlementsConfigured?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UserDoc = {
  id: number;
  /** Tenant this user belongs to. Null only for legacy rows before migration. */
  organizationId: number | null;
  unionId: string;
  name: string | null;
  email: string | null;
  passwordHash: string | null;
  avatar: string | null;
  role: UserRole;
  status: UserStatus;
  department: string | null;
  position: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  secondName: string | null;
  dateOfBirth: Date | null;
  dateOfJoining: Date | null;
  sex: SexOption | null;
  city: string | null;
  address: string | null;
  familyContactNumber: string | null;
  /** Personal/emergency email (separate from work login email). */
  personalEmail: string | null;
  bloodGroup: string | null;
  /** Aadhaar card number (plain text). Visible to employee, HR, and admin. */
  aadhaarCard: string | null;
  /** PAN card number (plain text). Visible to employee, HR, and admin. */
  panCard: string | null;
  notificationLanguage: string | null;
  /** Owner-only private notes; never expose via SafeUser or admin personal-info APIs. */
  privateNotes: string | null;
  /**
   * `intern` → 6-month no-PL window (3 internship + 3 probation).
   * `full_time` (default) → 3-month probation no-PL window.
   */
  employmentType: EmploymentType;
  /**
   * When true, employee is serving notice. Current + future months get no paid leave.
   * Editable by admin, HR, and project managers (manager role).
   */
  onNoticePeriod: boolean;
  /** Days the employee must serve, counted from the day notice was started. */
  noticePeriodDays?: number | null;
  /** End of the last notice day (IST). After this, the badge is removed and the user is inactive. */
  noticePeriodEndsAt?: Date | null;
  headOfDepartmentUserIds: number[];
  permissions: string[];
  /** Manual order on the Employees admin list (lower = higher). */
  sortOrder?: number;
  /**
   * Invited client portal: show task time tracking only when true.
   * Defaults to hidden when unset.
   */
  clientCanViewTimeTracking?: boolean;
  /**
   * Invited client portal: show task due dates only when true.
   * Defaults to hidden when unset.
   */
  clientCanViewDueDate?: boolean;
  /**
   * Invited client portal: assignee/participant picker is limited to these staff user ids.
   * Empty/unset means no employees are offered.
   */
  assignedEmployeeIds?: number[];
  createdAt: Date;
  updatedAt: Date;
  lastSignInAt: Date;
};

export type SafeUser = Omit<UserDoc, "passwordHash" | "privateNotes"> & {
  /** True when the user's organization is a client portal workspace. Not stored on the user document. */
  clientWorkspace?: boolean;
  /** True when this is a `role: client` user inside a staff CRM (not a standalone client org). */
  invitedStaffClient?: boolean;
};

export type InviteKind = "employee" | "client";

export type EmployeeInviteDoc = {
  id: number;
  organizationId: number;
  token: string;
  invitedBy: number;
  /** Invited email address (required for new invites). */
  email: string | null;
  department: string | null;
  /** Who this invite creates. Older invites without this field are employees. */
  inviteKind?: InviteKind;
  status: InviteStatus;
  acceptedUserId: number | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
};

/** Joined employee profile — linked to users collection for login */
export type EmployeeDoc = {
  id: number;
  organizationId: number | null;
  userId: number;
  inviteId: number | null;
  name: string;
  email: string;
  passwordHash: string;
  avatar: string | null;
  department: string | null;
  position: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  secondName: string | null;
  dateOfBirth: Date | null;
  dateOfJoining: Date | null;
  sex: SexOption | null;
  city: string | null;
  address: string | null;
  familyContactNumber: string | null;
  personalEmail: string | null;
  bloodGroup: string | null;
  aadhaarCard: string | null;
  panCard: string | null;
  notificationLanguage: string | null;
  employmentType: EmploymentType;
  onNoticePeriod: boolean;
  noticePeriodDays?: number | null;
  noticePeriodEndsAt?: Date | null;
  headOfDepartmentUserIds: number[];
  status: UserStatus;
  permissions: string[];
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type SafeEmployee = Omit<EmployeeDoc, "passwordHash">;

export type ProjectDoc = {
  id: number;
  organizationId: number | null;
  name: string;
  description: string | null;
  clientName: string | null;
  status: ProjectStatus;
  color: string | null;
  icon: string | null;
  /** Extra kanban/list sections appended after the default pipeline stages. */
  customPipelineStages?: Array<{ key: string; label: string; color: string }> | null;
  /** Display-name overrides for any stage key (defaults + custom). Keys are unchanged. */
  pipelineStageLabelOverrides?: Record<string, string> | null;
  /** Built-in stage keys hidden from this project's kanban/list (To Do / Finished cannot be hidden). */
  hiddenPipelineStageKeys?: string[] | null;
  /** Ordered stage keys for this project's kanban columns. Missing keys are appended in default order. */
  pipelineStageOrder?: string[] | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectMemberDoc = {
  id: number;
  projectId: number;
  userId: number;
  joinedAt: Date;
};

export type TaskDoc = {
  id: number;
  organizationId: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  stage: string;
  priority: TaskPriority;
  assigneeId: number | null;
  projectId: number | null;
  createdBy: number | null;
  dueDate: Date | null;
  estimatedHours: string | null;
  actualHours: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskParticipantDoc = {
  id: number;
  taskId: number;
  userId: number;
  role: "participant" | "observer";
  createdAt: Date;
};

export type SubtaskDoc = {
  id: number;
  taskId: number;
  title: string;
  completed: boolean;
  position: number;
  createdAt: Date;
};

export type TaskTagDoc = {
  id: number;
  name: string;
  color: string | null;
  createdAt: Date;
};

export type TaskTagRelationDoc = {
  id: number;
  taskId: number;
  tagId: number;
};

export type TimeEntryDoc = {
  id: number;
  organizationId: number | null;
  userId: number;
  taskId: number | null;
  projectId: number | null;
  clockIn: Date;
  clockOut: Date | null;
  duration: number | null;
  /** Precise attendance duration in seconds (source of truth when set). */
  durationSeconds: number | null;
  note: string | null;
  source: TimeEntrySource;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskActivityDoc = {
  id: number;
  taskId: number;
  userId: number | null;
  action: TaskActivityAction;
  oldValue: string | null;
  newValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type TaskAttachmentDoc = {
  id: number;
  taskId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** @deprecated Legacy inline storage. Prefer gridFsId. */
  dataBase64?: string;
  /** GridFS ObjectId hex string for binary payload. */
  gridFsId?: string;
  /**
   * When false, attachment is comment/chat/description media only
   * and must not appear in the task Files section.
   * Missing/undefined means listed (legacy attachments).
   */
  listedInFiles?: boolean;
  uploadedBy: number | null;
  createdAt: Date;
};

/** HR/employee files on personal information (offer letter, ID scans, PDFs, etc.). */
export type EmployeeDocumentDoc = {
  id: number;
  organizationId: number | null;
  userId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** Optional label e.g. "Offer letter", "PAN card". */
  label: string | null;
  gridFsId: string;
  uploadedBy: number | null;
  createdAt: Date;
};

/** Manual records of employees who left the company (HR Recent Employees). */
export type FormerEmployeeDoc = {
  id: number;
  organizationId: number | null;
  name: string;
  email: string | null;
  department: string | null;
  position: string | null;
  joiningDate: string;
  resignationDate: string;
  servedNoticePeriod: boolean;
  /** Days of notice served when servedNoticePeriod is true. */
  noticePeriodDays: number | null;
  lastWorkingDay: string;
  reasonForLeaving: string;
  notes: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FormerEmployeeDocumentDoc = {
  id: number;
  organizationId: number | null;
  formerEmployeeId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  label: string | null;
  gridFsId: string;
  uploadedBy: number | null;
  createdAt: Date;
};

export type NotificationDoc = {
  id: number;
  organizationId: number | null;
  userId: number;
  actorId: number | null;
  type: NotificationType;
  title: string;
  message: string;
  taskId: number | null;
  projectId?: number | null;
  approvalRequestId?: number | null;
  activityId?: number | null;
  leaveRequestId?: number | null;
  holidayId?: number | null;
  /** Invoice this payment/status event refers to. */
  invoiceId?: number | null;
  /** Deep-link path for the recipient (e.g. client invoice). */
  link?: string | null;
  /** Customer workspace this plan event refers to (for master-admin links). */
  relatedOrganizationId?: number | null;
  read: boolean;
  createdAt: Date;
};

export type LeaveRequestDoc = {
  id: number;
  organizationId: number | null;
  userId: number;
  leaveType: LeaveType;
  /** True for half-day sick (and mirrored for leaveType "half"). */
  isHalfDay?: boolean | null;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  reviewedBy: number | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicHolidayDoc = {
  id: number;
  organizationId: number | null;
  /** YYYY-MM-DD (work-zone calendar date). */
  date: string;
  name: string;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Office / site geofence used to restrict employee clock-in. */
export type WorkLocationDoc = {
  id: number;
  organizationId: number | null;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  /** Geofence radius in meters. */
  radiusMeters: number;
  archived: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** One attendance QR token per organization (printed / downloaded by HR/admin). */
export type OrgAttendanceQrDoc = {
  id: number;
  organizationId: number;
  /** High-entropy secret encoded in the QR. */
  token: string;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrgAttendanceQrActivityAction =
  | "created"
  | "regenerated"
  | "downloaded";

/** Audit trail for org attendance QR actions (HR/admin). */
export type OrgAttendanceQrActivityDoc = {
  id: number;
  organizationId: number;
  action: OrgAttendanceQrActivityAction;
  userId: number;
  /** Display name snapshot at the time of the action. */
  userName: string;
  createdAt: Date;
};

/**
 * Manual monthly leave usage set by HR/admin.
 * Effective paid days used = max(auto from approved leaves, paidDaysUsed).
 */
export type LeaveUsageOverrideDoc = {
  id: number;
  organizationId: number | null;
  userId: number;
  year: number;
  /** 1–12 */
  month: number;
  /** Paid leave days counted as used for the month (0, 0.5, 1, …). */
  paidDaysUsed: number;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TimeApprovalRequestDoc = {
  id: number;
  organizationId: number | null;
  userId: number;
  type: TimeApprovalType;
  status: TimeApprovalStatus;
  reason: string;
  workSessionId: number | null;
  timeEntryId: number | null;
  workBreakId: number | null;
  originalClockIn: Date | null;
  originalBreakStart: Date | null;
  originalBreakEnd: Date | null;
  requestedClockIn: Date | null;
  requestedBreakStart: Date | null;
  requestedBreakEnd: Date | null;
  reviewedBy: number | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerContactPerson = {
  salutation: string;
  firstName: string;
  lastName: string;
  email: string;
  workPhone: string;
  mobile: string;
};

export type CustomerDoc = {
  id: number;
  organizationId: number;
  customerType: "business" | "individual";
  salutation: string;
  firstName: string;
  lastName: string;
  companyName: string;
  displayName: string;
  currency: string;
  /** Hourly billing rate used on automatic invoices. */
  hourlyRate?: number;
  email: string;
  workPhone: string;
  mobile: string;
  gstTreatment?: string;
  gstNumber: string;
  businessLegalName?: string;
  businessTradeName?: string;
  placeOfSupply: string;
  pan: string;
  taxPreference: "taxable" | "tax_exempt";
  paymentTerms: string;
  billingCountry: string;
  billingAddress1: string;
  billingAddress2: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingPhone: string;
  shippingCountry: string;
  shippingAddress1: string;
  shippingAddress2: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingPhone: string;
  contactPersons: CustomerContactPerson[];
  customFieldLabel: string;
  customFieldValue: string;
  remarks: string;
  /** Linked client-role user in this CRM org. */
  sourceUserId?: number | null;
  /** Linked client-portal organization represented by this customer. */
  sourceOrganizationId?: number | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceLineItemDoc = {
  id: string;
  itemDetails: string;
  quantity: number;
  rate: number;
  discountPercent: number;
  taxPercent: number;
};

export type InvoiceDoc = {
  id: number;
  organizationId: number;
  invoiceNumber: string;
  orderNumber: string;
  customerId: number;
  customerName: string;
  invoiceDate: string;
  /** Billing period the invoice covers (YYYY-MM-DD). */
  periodStart?: string;
  periodEnd?: string;
  terms: string;
  dueDate: string;
  salesperson: string;
  /** GST HSN (goods) or SAC (services) code applied to all line items. */
  hsnSac?: string;
  items: InvoiceLineItemDoc[];
  customerNotes: string;
  shippingCharges: number;
  taxMode: "tds" | "tcs" | "none";
  taxPercent: number;
  adjustment: number;
  roundOff: boolean;
  currency?: string;
  status: "draft" | "pending" | "sent" | "partial" | "paid";
  amountPaid?: number;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  projectId?: number | null;
  excludeDepartments?: string[];
  autoInvoiceType?: "task" | "project" | null;
};

export type BankAccountDoc = {
  id: number;
  organizationId: number;
  name: string;
  bankName: string;
  accountNumber: string;
  accountType: "current" | "savings" | "cash" | "other";
  currency: string;
  openingBalance: number;
  currentBalance: number;
  ifscOrSwift: string;
  branch: string;
  isActive: boolean;
  notes: string;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LedgerAccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type LedgerAccountDoc = {
  id: number;
  organizationId: number;
  code: string;
  name: string;
  type: LedgerAccountType;
  description: string;
  isSystem: boolean;
  isActive: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EstimateDoc = {
  id: number;
  organizationId: number;
  estimateNumber: string;
  customerId: number | null;
  customerName: string;
  estimateDate: string;
  validUntil: string;
  currency: string;
  items: InvoiceLineItemDoc[];
  notes: string;
  taxPercent: number;
  adjustment: number;
  status: "draft" | "sent" | "accepted" | "declined" | "converted";
  convertedInvoiceId: number | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentDoc = {
  id: number;
  organizationId: number;
  invoiceId: number | null;
  customerId: number | null;
  customerName: string;
  amount: number;
  paymentDate: string;
  method: "bank_transfer" | "upi" | "cash" | "cheque" | "card" | "other";
  bankAccountId: number | null;
  reference: string;
  notes: string;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExpenseDoc = {
  id: number;
  organizationId: number;
  expenseDate: string;
  vendorName: string;
  category: string;
  ledgerAccountId: number | null;
  amount: number;
  taxAmount: number;
  currency: string;
  paymentMethod: "bank_transfer" | "upi" | "cash" | "cheque" | "card" | "other";
  bankAccountId: number | null;
  status: "draft" | "recorded";
  notes: string;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ContractDoc = {
  id: number;
  organizationId: number;
  customerId: number | null;
  customerName: string;
  title: string;
  startDate: string;
  endDate: string;
  value: number;
  currency: string;
  billingTerms: string;
  status: "draft" | "active" | "expired" | "cancelled";
  notes: string;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VendorBillDoc = {
  id: number;
  organizationId: number;
  vendorName: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  category: string;
  status: "open" | "paid" | "void";
  paidAt: string | null;
  notes: string;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkSessionDoc = {
  id: number;
  userId: number;
  startTime: Date;
  endTime: Date | null;
  active: boolean;
  paused: boolean;
  accumulatedWorkSeconds: number;
  breakStartedAt: Date | null;
  workSegmentStartedAt: Date | null;
  createdAt: Date;
};

export type WorkBreakDoc = {
  id: number;
  userId: number;
  workSessionId: number;
  timeEntryId: number | null;
  startTime: Date;
  endTime: Date | null;
  reason: string | null;
  manuallyEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<UserRole, string[]> = {
  admin: [
    "dashboard.view",
    "tasks.view_all",
    "tasks.view_client",
    "tasks.create",
    "tasks.edit_all",
    "tasks.change_assignee",
    "tasks.delete",
    "projects.view",
    "projects.manage",
    "time.view_team",
    "time.edit_all",
    "time.edit_own",
    "employees.view",
    "employees.manage",
    "departments.view",
    "leaves.manage",
    "attendance.manage",
    "permissions.manage",
    "settings.task_status",
    "invoices.manage",
    "customers.manage",
    "reports.view",
    "analytics.view",
    "profile.head_of_department",
  ],
  manager: [
    "dashboard.view",
    "tasks.view_all",
    "tasks.view_client",
    "tasks.create",
    "tasks.edit_all",
    "tasks.change_assignee",
    "projects.manage",
    "time.view_team",
    "time.edit_own",
    "employees.view",
    "departments.view",
    "analytics.view",
  ],
  hr: [
    "dashboard.view",
    "time.edit_own",
    "time.view_team",
    "employees.view",
    "employees.manage",
    "departments.view",
    "leaves.manage",
    "attendance.manage",
  ],
  employee: [
    "dashboard.view",
    "tasks.view_own",
    "tasks.create",
    "tasks.edit_own",
    "time.edit_own",
    "projects.view",
  ],
  client: [
    "dashboard.view",
    "projects.view",
    "projects.manage",
    "tasks.view_all",
    "tasks.create",
    "tasks.edit_all",
    "tasks.change_assignee",
    "employees.manage",
  ],
  finance: [
    "dashboard.view",
    "invoices.manage",
    "customers.manage",
  ],
  platform: [],
};

/** Personal calendar notes / reminders on admin & project-manager dashboards. */
export type DashboardReminderDoc = {
  id: number;
  organizationId: number;
  userId: number;
  title: string;
  note: string | null;
  /** YYYY-MM-DD in the work zone. */
  dateKey: string;
  /** Optional wall time HH:mm (24h). */
  time: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
};
