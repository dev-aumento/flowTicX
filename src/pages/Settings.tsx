import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { RoleBadge } from "@/components/shared/StatusBadge";
import { AvatarPickerModal } from "@/components/settings/AvatarPickerModal";
import { PersonalInformationPanel } from "@/components/settings/PersonalInformationPanel";
import { OrganizationProfilePanel } from "@/components/settings/OrganizationProfilePanel";
import { PlanSettingsPanel } from "@/components/settings/PlanSettingsPanel";
import { writeProfilePrefs } from "@/lib/profile-prefs";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_PREF_ITEMS,
  readNotificationPrefs,
  writeNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/notification-prefs";
import { WORK_TIMEZONE, WORK_TIMEZONE_LABEL } from "@/lib/timezone";
import { INVOICE_CURRENCIES, normalizeCurrencyCode } from "@/lib/invoice-store";
import { departmentSelectOptions, departmentSelectScopeForRole } from "@/lib/department-options";
import { isFinanceRoleOnly } from "@/lib/leave-policy";
import { isClientPortalUser } from "@/lib/client-portal";
import { hasPermission } from "@/lib/permissions";
import { motion } from "framer-motion";
import {
  User,
  Building2,
  BellRing,
  Camera,
  Check,
  Loader2,
  IdCard,
  Landmark,
  Tags,
  CreditCard,
} from "lucide-react";
import { TaskStatusLabelsPanel } from "@/components/settings/TaskStatusLabelsPanel";

const TABS = [
  { key: "profile", label: "Profile", icon: User },
  { key: "personal", label: "Personal Information", icon: IdCard },
  { key: "workspace", label: "Workspace", icon: Building2 },
  { key: "task-status", label: "Task statuses", icon: Tags },
  { key: "notifications", label: "Notifications", icon: BellRing },
  { key: "organization", label: "Organization Profile", icon: Landmark, adminOnly: true },
  { key: "plans", label: "Plans", icon: CreditCard, adminOnly: true },
] as const;

const FINANCE_HIDDEN_TABS = new Set(["personal", "workspace", "notifications"]);

const WORKSPACE_KEY = "settings-workspace";

type ProfileForm = {
  name: string;
  avatar: string | null;
  department: string;
};

type WorkspaceForm = {
  startTime: string;
  endTime: string;
  timezone: string;
  currency: string;
};

const DEFAULT_WORKSPACE: WorkspaceForm = {
  startTime: "09:00",
  endTime: "21:00",
  timezone: WORK_TIMEZONE,
  currency: "INR",
};

function readWorkspacePrefs(): WorkspaceForm {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    const parsed = raw ? { ...DEFAULT_WORKSPACE, ...JSON.parse(raw) } : DEFAULT_WORKSPACE;
    return {
      ...parsed,
      timezone: WORK_TIMEZONE,
      currency: normalizeCurrencyCode(parsed.currency),
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

function sameNotificationPrefs(a: NotificationPrefs, b: NotificationPrefs) {
  return NOTIFICATION_PREF_ITEMS.every((item) => a[item.key] === b[item.key]);
}

async function invalidateProfileViews(utils: ReturnType<typeof trpc.useUtils>) {
  await Promise.all([
    utils.auth.me.invalidate(),
    utils.auth.getPersonalInfo.invalidate(),
    utils.user.listForPicker.invalidate(),
    utils.user.list.invalidate(),
    utils.project.list.invalidate(),
    utils.task.list.invalidate(),
    utils.task.getById.invalidate(),
    utils.dashboard.getStats.invalidate(),
    utils.dashboard.getHrDashboard.invalidate(),
    utils.timeEntry.getTeamHours.invalidate(),
  ]);
}

export default function Settings() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const financeOnly = isFinanceRoleOnly(user);
  const clientPortal = isClientPortalUser(user);
  const [activeTab, setActiveTab] = useState("profile");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const [profileForm, setProfileForm] = useState<ProfileForm>({
    name: "",
    avatar: null,
    department: "",
  });
  const [savedProfile, setSavedProfile] = useState<ProfileForm>({
    name: "",
    avatar: null,
    department: "",
  });

  const [workspaceForm, setWorkspaceForm] = useState<WorkspaceForm>(readWorkspacePrefs);
  const [savedWorkspace, setSavedWorkspace] = useState<WorkspaceForm>(readWorkspacePrefs);
  const { data: workspaceCurrency } = trpc.organization.getWorkspaceCurrency.useQuery();
  const updateCurrencyMutation = trpc.organization.updateWorkspaceCurrency.useMutation({
    onSuccess: async (result) => {
      const currency = result.currency;
      setWorkspaceForm((prev) => ({ ...prev, currency }));
      setSavedWorkspace((prev) => ({ ...prev, currency }));
      await Promise.all([
        utils.organization.getWorkspaceCurrency.invalidate(),
        utils.organization.getBillingProfile.invalidate(),
        utils.dashboard.getHrDashboard.invalidate(),
      ]);
    },
    onError: (error) => {
      setSaveError(error.message || "Could not save workspace currency.");
    },
  });
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(
    () => ({ ...DEFAULT_NOTIFICATION_PREFS }),
  );
  const [savedNotificationPrefs, setSavedNotificationPrefs] = useState<NotificationPrefs>(
    () => ({ ...DEFAULT_NOTIFICATION_PREFS }),
  );

  useEffect(() => {
    if (!user) return;
    const nextProfile = {
      name: user.name ?? "",
      avatar: user.avatar ?? null,
      department: user.department ?? "",
    };
    setProfileForm(nextProfile);
    setSavedProfile(nextProfile);
    const nextNotifications = readNotificationPrefs(user.id);
    setNotificationPrefs(nextNotifications);
    setSavedNotificationPrefs(nextNotifications);
  }, [user]);

  useEffect(() => {
    if (!workspaceCurrency?.currency) return;
    const currency = normalizeCurrencyCode(workspaceCurrency.currency);
    setSavedWorkspace((prev) =>
      prev.currency === currency ? prev : { ...prev, currency },
    );
    setWorkspaceForm((prev) => {
      if (prev.currency !== savedWorkspace.currency) return prev;
      return prev.currency === currency ? prev : { ...prev, currency };
    });
  }, [workspaceCurrency?.currency, savedWorkspace.currency]);

  useEffect(() => {
    if (user?.role !== "admin" && (activeTab === "organization" || activeTab === "plans")) {
      setActiveTab("profile");
      return;
    }
    if (
      activeTab === "task-status" &&
      (!hasPermission(user, "settings.task_status") ||
        isClientPortalUser(user) ||
        financeOnly)
    ) {
      setActiveTab("profile");
      return;
    }
    if (isClientPortalUser(user) && activeTab === "workspace") {
      setActiveTab("profile");
      return;
    }
    if (financeOnly && FINANCE_HIDDEN_TABS.has(activeTab)) {
      setActiveTab("profile");
    }
  }, [user, financeOnly, activeTab]);

  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: async (updatedUser) => {
      utils.auth.me.setData(undefined, updatedUser);
      writeProfilePrefs(updatedUser.id, {
        name: updatedUser.name,
        email: updatedUser.email,
        position: updatedUser.position,
        phone: updatedUser.phone,
      });

      const nextProfile = {
        name: updatedUser.name ?? "",
        avatar: updatedUser.avatar ?? null,
        department: updatedUser.department ?? "",
      };
      setProfileForm(nextProfile);
      setSavedProfile(nextProfile);

      await invalidateProfileViews(utils);

      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (error) => {
      setSaveError(error.message || "Could not save changes.");
    },
  });

  const isSaving = updateProfileMutation.isPending || updateCurrencyMutation.isPending;

  const profileDirty = useMemo(() => {
    return (
      profileForm.name.trim() !== savedProfile.name.trim() ||
      (!clientPortal &&
        (profileForm.department.trim() || "") !== (savedProfile.department.trim() || "")) ||
      (profileForm.avatar ?? null) !== (savedProfile.avatar ?? null)
    );
  }, [profileForm, savedProfile, clientPortal]);

  const canEditCurrency = workspaceCurrency?.canEdit === true;

  const workspaceDirty = useMemo(() => {
    return (
      workspaceForm.startTime !== savedWorkspace.startTime ||
      workspaceForm.endTime !== savedWorkspace.endTime ||
      (canEditCurrency && workspaceForm.currency !== savedWorkspace.currency)
    );
  }, [workspaceForm, savedWorkspace, canEditCurrency]);

  const notificationsDirty = useMemo(
    () => !sameNotificationPrefs(notificationPrefs, savedNotificationPrefs),
    [notificationPrefs, savedNotificationPrefs],
  );

  const canSave =
    activeTab === "profile"
      ? profileDirty && profileForm.name.trim().length > 0
      : activeTab === "workspace"
        ? workspaceDirty
        : activeTab === "notifications"
          ? notificationsDirty
          : false;

  const handleAvatarSelect = (avatarUrl: string) => {
    setProfileForm((prev) => ({ ...prev, avatar: avatarUrl }));
    setAvatarPickerOpen(false);
    setSaveError(null);
    updateProfileMutation.mutate({ avatar: avatarUrl });
  };

  const handleSaveProfile = async () => {
    setSaveError(null);
    if (!profileForm.name.trim()) {
      setSaveError("Name is required.");
      return;
    }

    try {
      await updateProfileMutation.mutateAsync({
        name: profileForm.name.trim(),
        avatar: profileForm.avatar,
        ...(clientPortal ? {} : { department: profileForm.department.trim() || null }),
      });
    } catch {
      // Errors are handled in mutation onError handlers.
    }
  };

  const handleSaveWorkspace = async () => {
    const next = {
      ...workspaceForm,
      timezone: WORK_TIMEZONE,
      currency: normalizeCurrencyCode(workspaceForm.currency),
    };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next));
    setWorkspaceForm(next);
    setSaveError(null);

    const canEditCurrencySave = workspaceCurrency?.canEdit === true;
    if (canEditCurrencySave && next.currency !== savedWorkspace.currency) {
      try {
        await updateCurrencyMutation.mutateAsync({ currency: next.currency });
      } catch {
        return;
      }
    }

    setSavedWorkspace(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveNotifications = () => {
    if (!user) {
      setSaveError("You must be signed in to save notification preferences.");
      return;
    }
    writeNotificationPrefs(user.id, notificationPrefs);
    setSavedNotificationPrefs({ ...notificationPrefs });
    setSaveError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSave = () => {
    if (!canSave || isSaving) return;
    if (activeTab === "profile") void handleSaveProfile();
    else if (activeTab === "workspace") void handleSaveWorkspace();
    else if (activeTab === "notifications") handleSaveNotifications();
  };

  const visibleTabs = TABS.filter((tab) => {
    if ("adminOnly" in tab && tab.adminOnly && user?.role !== "admin") return false;
    if (tab.key === "task-status") {
      return (
        hasPermission(user, "settings.task_status") &&
        !isClientPortalUser(user) &&
        !financeOnly
      );
    }
    if (isClientPortalUser(user) && tab.key === "workspace") return false;
    if (financeOnly && FINANCE_HIDDEN_TABS.has(tab.key)) return false;
    return true;
  });

  const showSaveButton =
    activeTab === "profile" ||
    activeTab === "workspace" ||
    activeTab === "notifications";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F2937]">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account and preferences</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col lg:flex-row min-h-0 lg:min-h-[500px]">
        <div className="lg:w-56 border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50/50 flex-shrink-0 overflow-x-auto">
          <nav className="flex lg:flex-col min-w-max lg:min-w-0">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSaveError(null);
                  setSaved(false);
                }}
                className={`flex items-center gap-2 lg:gap-3 px-3 sm:px-4 py-2.5 lg:py-3 text-sm font-medium transition-all whitespace-nowrap lg:w-full ${
                  activeTab === tab.key
                    ? "bg-white text-[#2563EB] border-b-[3px] lg:border-b-0 lg:border-l-[3px] border-[#2563EB]"
                    : "text-gray-600 hover:bg-white/60 border-b-[3px] lg:border-b-0 lg:border-l-[3px] border-transparent"
                }`}
              >
                <tab.icon size={18} className="flex-shrink-0" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 p-4 sm:p-6 min-w-0 overflow-x-hidden">
          {activeTab === "profile" && (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h2 className="text-lg font-semibold text-[#1F2937]">Profile Settings</h2>

              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
                <UserAvatar name={profileForm.name || user?.name} avatar={profileForm.avatar} size={80} />
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setAvatarPickerOpen(true)}
                    className="h-9 px-4 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <Camera size={14} /> Change Avatar
                  </button>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Choose a preset or upload an image. Your avatar is saved to your account immediately.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                  {!financeOnly ? (
                    <p className="text-xs text-gray-400 mt-1">
                      Contact details are managed under Personal information.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="profile-email">
                    Email
                  </label>
                  <input
                    id="profile-email"
                    type="email"
                    value={user?.email ?? ""}
                    disabled
                    readOnly
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Email cannot be changed after it is set.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <div className="h-10 flex items-center">
                    <RoleBadge role={user?.role || "employee"} />
                  </div>
                </div>
                {clientPortal ? null : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="profile-department">
                    Department
                  </label>
                  <select
                    id="profile-department"
                    value={profileForm.department}
                    onChange={(e) =>
                      setProfileForm((prev) => ({ ...prev, department: e.target.value }))
                    }
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white"
                  >
                    <option value="">Select department…</option>
                    {departmentSelectOptions(
                      profileForm.department,
                      departmentSelectScopeForRole(user?.role),
                    ).map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                  {!financeOnly ? (
                    <p className="text-xs text-gray-400 mt-1">
                      Shown in the Projects table for projects you create.
                    </p>
                  ) : null}
                </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "personal" && !financeOnly ? (
            <PersonalInformationPanel
              onSaved={() => {
                setSaveError(null);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              }}
              onError={setSaveError}
            />
          ) : null}

          {activeTab === "workspace" && !financeOnly ? (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h2 className="text-lg font-semibold text-[#1F2937]">Workspace Settings</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Working Hours</label>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="time"
                      value={workspaceForm.startTime}
                      onChange={(e) => setWorkspaceForm((prev) => ({ ...prev, startTime: e.target.value }))}
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm"
                    />
                    <input
                      type="time"
                      value={workspaceForm.endTime}
                      onChange={(e) => setWorkspaceForm((prev) => ({ ...prev, endTime: e.target.value }))}
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
                  <input
                    type="text"
                    value={WORK_TIMEZONE_LABEL}
                    disabled
                    readOnly
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="workspace-currency">
                    Currency
                  </label>
                  <select
                    id="workspace-currency"
                    value={workspaceForm.currency}
                    disabled={!canEditCurrency}
                    onChange={(e) =>
                      setWorkspaceForm((prev) => ({
                        ...prev,
                        currency: normalizeCurrencyCode(e.target.value),
                      }))
                    }
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
                  >
                    {INVOICE_CURRENCIES.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Used for amounts on the admin dashboard, including invoices and revenue.
                  </p>
                </div>
              </div>
            </motion.div>
          ) : null}

          {activeTab === "notifications" && !financeOnly ? (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h2 className="text-lg font-semibold text-[#1F2937]">Notification Preferences</h2>

              <div className="space-y-4">
                {NOTIFICATION_PREF_ITEMS.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={notificationPrefs[item.key]}
                      onChange={(e) =>
                        setNotificationPrefs((prev) => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="w-4 h-4 mt-0.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-800">{item.label}</div>
                      <div className="text-xs text-gray-400">{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </motion.div>
          ) : null}

          {activeTab === "organization" && user?.role === "admin" ? (
            <OrganizationProfilePanel
              onSaved={() => {
                setSaveError(null);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              }}
              onError={setSaveError}
            />
          ) : null}

          {activeTab === "plans" && user?.role === "admin" ? <PlanSettingsPanel /> : null}

          {activeTab === "task-status" ? (
            <TaskStatusLabelsPanel
              onSaved={() => {
                setSaveError(null);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              }}
              onError={setSaveError}
            />
          ) : null}

          {saveError ? <p className="text-sm text-red-500">{saveError}</p> : null}

          {showSaveButton ? (
            <div className="pt-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave || isSaving}
                className="h-10 px-6 bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Saving...
                  </>
                ) : saved && !canSave ? (
                  <>
                    <Check size={16} /> Saved
                  </>
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <AvatarPickerModal
        open={avatarPickerOpen}
        name={profileForm.name || user?.name}
        currentAvatar={profileForm.avatar}
        onClose={() => setAvatarPickerOpen(false)}
        onSelect={handleAvatarSelect}
      />
    </motion.div>
  );
}
