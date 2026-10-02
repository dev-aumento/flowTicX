/** Numeric allowances and checklist lines for a subscription plan. */

export type PlanLimits = {
  /** Null means unlimited. */
  projects: number | null;
  teamMembers: number | null;
  storageGb: number | null;
};

export type PlanHighlight = {
  key: string;
  label: string;
  group: "feature" | "support";
  /** Workspace modules this line turns on. */
  featureKeys?: string[];
  /** Also enable the checklist of these plan slugs ("Everything in …"). */
  includes?: string[];
};

export const PLAN_HIGHLIGHTS: PlanHighlight[] = [
  { key: "tasks_kanban", label: "Tasks & Kanban boards", group: "feature", featureKeys: ["tasks"] },
  { key: "time_basic", label: "Basic time tracking & logs", group: "feature", featureKeys: ["time_tracking"] },
  { key: "client_portal_limited", label: "Client portal (limited access)", group: "feature", featureKeys: ["client_portal"] },
  { key: "mobile", label: "Mobile app access (iOS & Android)", group: "feature" },
  { key: "project_summaries", label: "Standard project summaries", group: "feature" },
  { key: "tasks_gantt", label: "Tasks, Kanban & interactive Gantt", group: "feature", featureKeys: ["tasks"] },
  { key: "time_team", label: "Time tracking & team timesheets", group: "feature", featureKeys: ["time_tracking"] },
  { key: "client_portal_full", label: "Full client portal with file share", group: "feature", featureKeys: ["client_portal", "files"] },
  { key: "attendance_leave", label: "Attendance & leave tracking", group: "feature", featureKeys: ["attendance", "leave"] },
  { key: "crm_basic", label: "Basic CRM & client contact book", group: "feature", featureKeys: ["customers"] },
  { key: "finance_summaries", label: "Financial summaries & dashboards", group: "feature", featureKeys: ["finance"] },
  { key: "native_apps", label: "Mobile & desktop native apps", group: "feature" },
  { key: "includes_starter", label: "Everything in Starter", group: "feature", includes: ["starter"] },
  { key: "crm_advanced", label: "Advanced CRM & pipeline deals", group: "feature", featureKeys: ["customers"] },
  { key: "profitability", label: "Project profitability & margin forecasting", group: "feature", featureKeys: ["analytics"] },
  { key: "invoicing", label: "Automated invoicing & Stripe sync", group: "feature", featureKeys: ["invoices"] },
  { key: "workflows", label: "No-code workflow automations", group: "feature", featureKeys: ["tasks"] },
  { key: "expenses", label: "Expense & vendor receipt tracking", group: "feature", featureKeys: ["finance"] },
  { key: "ai_summaries", label: "AI summaries & predictive workload", group: "feature" },
  { key: "integrations", label: "Deep integrations (Slack, Google, Zoom)", group: "feature", featureKeys: ["meetings"] },
  { key: "includes_growth", label: "Everything in Growth", group: "feature", includes: ["growth"] },
  { key: "hr_advanced", label: "Advanced HR & People Operations", group: "feature", featureKeys: ["hr"] },
  { key: "custom_roles", label: "Custom roles, permissions & access", group: "feature", featureKeys: ["permissions"] },
  { key: "multi_workspace", label: "Multi-workspace & subsidiary setup", group: "feature" },
  { key: "api_webhooks", label: "REST API & Webhook connectors", group: "feature" },
  { key: "white_label", label: "White-label client portal & custom domain", group: "feature", featureKeys: ["client_portal"] },
  { key: "audit_logs", label: "Full audit logs & security governance", group: "feature" },
  { key: "includes_business", label: "Everything in Business", group: "feature", includes: ["business"] },
  { key: "sso", label: "Enterprise SSO & SCIM provisioning", group: "feature" },
  { key: "dedicated_db", label: "Dedicated database infrastructure", group: "feature" },
  { key: "ai_copilot", label: "Advanced AI copilot & resource forecasting", group: "feature" },
  { key: "erp", label: "Bespoke custom ERP integrations", group: "feature" },
  { key: "custom_bi", label: "Custom BI reports & analytics", group: "feature", featureKeys: ["analytics"] },
  { key: "community_support", label: "Community forum support", group: "support" },
  { key: "email_support", label: "Standard email support (24h response)", group: "support" },
  { key: "priority_support", label: "Priority live chat & email support", group: "support" },
  { key: "onboarding", label: "Dedicated onboarding specialist", group: "support" },
  { key: "sla_995", label: "99.5% uptime SLA option", group: "support" },
  { key: "tam", label: "Dedicated technical account manager", group: "support" },
  { key: "sla_999", label: "99.9% guaranteed uptime SLA", group: "support" },
  { key: "priority_247", label: "24/7 round-the-clock priority escalation", group: "support" },
];

const HIGHLIGHT_KEYS = new Set(PLAN_HIGHLIGHTS.map((item) => item.key));

export type PlanEntitlementPreset = {
  limits: PlanLimits;
  highlightKeys: string[];
  badge: string | null;
  ctaLabel: string;
  storageLabel: string | null;
};

const FREE: PlanEntitlementPreset = {
  limits: { projects: 3, teamMembers: 5, storageGb: 1 },
  highlightKeys: [
    "tasks_kanban",
    "time_basic",
    "client_portal_limited",
    "mobile",
    "project_summaries",
    "community_support",
  ],
  badge: "Free tier",
  ctaLabel: "Get Started Free",
  storageLabel: "1 GB cloud storage",
};

export const PLAN_ENTITLEMENT_PRESETS: Record<string, PlanEntitlementPreset> = {
  trial: FREE,
  free: FREE,
  starter: {
    limits: { projects: null, teamMembers: 10, storageGb: 5 },
    highlightKeys: [
      "tasks_gantt",
      "time_team",
      "client_portal_full",
      "attendance_leave",
      "crm_basic",
      "finance_summaries",
      "native_apps",
      "email_support",
    ],
    badge: null,
    ctaLabel: "Start Free Trial",
    storageLabel: "5 GB secure cloud storage",
  },
  growth: {
    limits: { projects: null, teamMembers: 25, storageGb: 25 },
    highlightKeys: [
      "includes_starter",
      "crm_advanced",
      "profitability",
      "invoicing",
      "workflows",
      "expenses",
      "ai_summaries",
      "integrations",
      "priority_support",
    ],
    badge: "Most popular",
    ctaLabel: "Get Started Now",
    storageLabel: "25 GB fast cloud storage",
  },
  business: {
    limits: { projects: null, teamMembers: 50, storageGb: 100 },
    highlightKeys: [
      "includes_growth",
      "hr_advanced",
      "custom_roles",
      "multi_workspace",
      "api_webhooks",
      "white_label",
      "audit_logs",
      "onboarding",
      "sla_995",
    ],
    badge: null,
    ctaLabel: "Start Free Trial",
    storageLabel: "100 GB cloud storage",
  },
  enterprise: {
    limits: { projects: null, teamMembers: 100, storageGb: 500 },
    highlightKeys: [
      "includes_business",
      "sso",
      "dedicated_db",
      "ai_copilot",
      "erp",
      "custom_bi",
      "tam",
      "sla_999",
      "priority_247",
    ],
    badge: null,
    ctaLabel: "Start Free Trial",
    storageLabel: "500 GB cloud storage",
  },
};

export function defaultEntitlement(slug: string): PlanEntitlementPreset {
  return (
    PLAN_ENTITLEMENT_PRESETS[slug] ?? {
      limits: { projects: null, teamMembers: null, storageGb: null },
      highlightKeys: [],
      badge: null,
      ctaLabel: "Select plan",
      storageLabel: null,
    }
  );
}

export function sanitizeHighlightKeys(keys: string[]) {
  return [...new Set(keys.map((key) => key.trim()).filter((key) => HIGHLIGHT_KEYS.has(key)))];
}

type HighlightSource = { slug: string; highlightKeys: string[] };

function presetHighlights(slug: string) {
  const key = slug === "free" ? "trial" : slug;
  return PLAN_ENTITLEMENT_PRESETS[key]?.highlightKeys ?? PLAN_ENTITLEMENT_PRESETS[slug]?.highlightKeys ?? [];
}

function highlightsForIncludedSlug(slug: string, plans?: HighlightSource[]) {
  const normalized = slug === "free" ? "trial" : slug;
  const match = plans?.find((plan) => plan.slug === normalized || (normalized === "trial" && plan.slug === "free"));
  if (match) return match.highlightKeys;
  return presetHighlights(normalized);
}

/** Module keys unlocked by the checklist, including "Everything in …" plans. */
export function deriveFeatureKeys(
  highlightKeys: string[],
  limits: PlanLimits,
  plans?: HighlightSource[],
) {
  const features = new Set<string>();
  const seenIncludes = new Set<string>();

  function add(keys: string[]) {
    for (const key of keys) {
      const item = PLAN_HIGHLIGHTS.find((entry) => entry.key === key);
      if (!item) continue;
      for (const feature of item.featureKeys ?? []) features.add(feature);
      for (const slug of item.includes ?? []) {
        if (seenIncludes.has(slug)) continue;
        seenIncludes.add(slug);
        add(highlightsForIncludedSlug(slug, plans));
      }
    }
  }

  add(highlightKeys);
  if (limits.projects !== 0) features.add("projects");
  // Team directory is on every plan. Seat count is limits.teamMembers.
  if (limits.teamMembers !== 0) features.add("employees");
  return [...features];
}

export function resolvePlanEntitlement(input: {
  slug: string;
  limits?: PlanLimits | null;
  highlightKeys?: string[] | null;
  badge?: string | null;
  ctaLabel?: string | null;
  storageLabel?: string | null;
  entitlementsConfigured?: boolean | null;
}) {
  const preset = defaultEntitlement(input.slug);
  const configured = input.entitlementsConfigured === true;
  const highlightKeys = configured
    ? sanitizeHighlightKeys(input.highlightKeys ?? [])
    : preset.highlightKeys;
  const limits = input.limits ?? preset.limits;
  return {
    limits,
    highlightKeys,
    badge: configured ? (input.badge?.trim() || null) : preset.badge,
    ctaLabel: (configured ? input.ctaLabel?.trim() : preset.ctaLabel) || preset.ctaLabel,
    storageLabel: configured ? (input.storageLabel?.trim() || null) : preset.storageLabel,
    entitlementsConfigured: configured,
  };
}

export function storageLine(limits: PlanLimits, storageLabel?: string | null) {
  if (limits.storageGb == null) return "Unlimited cloud storage";
  const custom = storageLabel?.trim();
  if (custom) return custom;
  return `${limits.storageGb} GB cloud storage`;
}

export function projectAllowanceLine(limits: PlanLimits) {
  if (limits.projects == null) return "Unlimited projects & clients";
  if (limits.projects === 1) return "1 active project";
  return `${limits.projects} active projects`;
}

export function teamMemberLabel(limit: number | null) {
  if (limit == null) return "Unlimited team members";
  return `Up to ${limit} team members`;
}

export function planChecklist(plan: {
  limits: PlanLimits;
  highlightKeys: string[];
  storageLabel?: string | null;
}) {
  const selected = new Set(plan.highlightKeys);
  const features = PLAN_HIGHLIGHTS.filter((item) => item.group === "feature" && selected.has(item.key));
  const support = PLAN_HIGHLIGHTS.filter((item) => item.group === "support" && selected.has(item.key));
  return [
    projectAllowanceLine(plan.limits),
    ...features.map((item) => item.label),
    storageLine(plan.limits, plan.storageLabel),
    ...support.map((item) => item.label),
  ];
}

export function isPopularPlan(plan: { slug?: string; badge?: string | null }) {
  return /most popular/i.test(plan.badge ?? "") || plan.slug === "growth";
}
