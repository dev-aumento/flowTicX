import { useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useParams, useSearchParams, useLocation } from 'react-router'
import { toast } from 'sonner'
import { AppLayout } from './components/layout/AppLayout'
import { useAuth } from './hooks/useAuth'
import { AUTH_DISABLED, LOGIN_PATH } from './const'
import { canAccessRoute, getDefaultHomePath, getLoginPathForUser, hasAnyPermission, hasPermission } from './lib/permissions'
import { hasPlanFeature, planFeatureForPath } from './lib/plan-features'
import { readPlanEndedNotice } from './lib/plan-ended'
import { isFinanceRoleOnly, isHrUser } from './lib/leave-policy'
import { readAuthCache } from './lib/auth-cache'
import {
  buildAllTasksViewPath,
  buildMyTasksViewPath,
  parseActivityIdParam,
  parseTaskKeyParam,
} from './lib/task-notification-link'

// Pages
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import TaskChats from './pages/TaskChats'
import TimeTracking from './pages/TimeTracking'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

// Admin Pages
import AdminEmployees from './pages/admin/Employees'
import AdminDepartments from './pages/admin/Departments'
import AdminAllTasks from './pages/admin/AllTasks'
import AdminClientTasks from './pages/admin/ClientTasks'
import AdminPermissions from './pages/admin/Permissions'
import AdminPricing from './pages/admin/Pricing'
import AdminInvoices from './pages/admin/Invoices'
import AdminCustomers from './pages/admin/Customers'
import BusinessReports from './pages/admin/BusinessReports'
import BankAccountsPage from './pages/finance/BankAccountsPage'
import ChartOfAccountsPage from './pages/finance/ChartOfAccountsPage'
import EstimatesPage from './pages/finance/EstimatesPage'
import PaymentsPage from './pages/finance/PaymentsPage'
import ExpensesPage from './pages/finance/ExpensesPage'
import ContractsPage from './pages/finance/ContractsPage'
import ReceivablePage from './pages/finance/ReceivablePage'
import PayablePage from './pages/finance/PayablePage'
import TaxCompliancePage from './pages/finance/TaxCompliancePage'
import ReportsHubPage from './pages/finance/ReportsHubPage'
import Leaves from './pages/Leaves'
import LeaveManagement from './pages/LeaveManagement'
import AttendanceManagement from './pages/AttendanceManagement'
import Locations from './pages/Locations'
import OrgQrCode from './pages/OrgQrCode'
import RecentEmployees from './pages/RecentEmployees'
import InviteAccept from './pages/InviteAccept'
import Login from './pages/Login'
import FinanceLogin from './pages/FinanceLogin'
import ClientLogin from './pages/ClientLogin'
import PlatformLogin from './pages/PlatformLogin'
import PlanEnded from './pages/PlanEnded'
import { PlatformLayout } from './components/layout/PlatformLayout'
import PlatformOverview from './pages/platform/PlatformOverview'
import PlatformClients from './pages/platform/PlatformClients'
import PlatformClientDetail from './pages/platform/PlatformClientDetail'
import PlatformFinance from './pages/platform/PlatformFinance'
import PlatformPlans from './pages/platform/PlatformPlans'
import PlatformNotifications from './pages/platform/PlatformNotifications'
import PlatformSettings from './pages/platform/PlatformSettings'
import {
  ClientApprovals,
  ClientFiles,
  ClientMeetings,
  ClientMessages,
  ClientMilestones,
} from './pages/client/ClientWorkspace'
import ClientReports from './pages/client/ClientReports'
import ClientInvoices from './pages/client/ClientInvoices'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] dark:bg-[#0b1220]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-3 border-[#0EA5E9] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    </div>
  )
}

function RootEntry() {
  const { user, isLoading } = useAuth()

  if (isLoading) return <LoadingScreen />
  if (!AUTH_DISABLED && !user) {
    if (readPlanEndedNotice()) {
      return <Navigate to="/plan-ended" replace />
    }
    return <Navigate to={LOGIN_PATH} replace />
  }

  return (
    <AppLayout>
      <PermissionRoute path="/">
        <Dashboard />
      </PermissionRoute>
    </AppLayout>
  )
}

function RequireAuth() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingScreen />
  if (!AUTH_DISABLED && !user) {
    if (readPlanEndedNotice()) {
      return <Navigate to="/plan-ended" replace />
    }
    const cached = readAuthCache()
    const fallback = location.pathname.startsWith('/platform') ? '/admin/login' : LOGIN_PATH
    return <Navigate to={getLoginPathForUser(cached) || fallback} replace />
  }

  return <Outlet />
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) return <LoadingScreen />
  if (!AUTH_DISABLED && user) {
    return <Navigate to={getDefaultHomePath(user)} replace />
  }

  return <>{children}</>
}

function ProtectedRoute({
  children,
  requireAdmin = false,
  requireManager = false,
  permission,
  anyPermission,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireManager?: boolean;
  permission?: string;
  anyPermission?: string[];
}) {
  const { user, isLoading } = useAuth()

  if (isLoading) return <LoadingScreen />

  if (requireAdmin && user?.role !== 'admin') {
    return <Navigate to={getDefaultHomePath(user)} replace />
  }

  if (
    requireManager &&
    (user?.role === 'employee' ||
      user?.role === 'hr' ||
      user?.role === 'client' ||
      user?.role === 'finance')
  ) {
    return <Navigate to={getDefaultHomePath(user)} replace />
  }

  if (permission && !hasPermission(user, permission)) {
    return <Navigate to={getDefaultHomePath(user)} replace />
  }

  if (anyPermission && !hasAnyPermission(user, anyPermission)) {
    return <Navigate to={getDefaultHomePath(user)} replace />
  }

  return <>{children}</>
}

function PermissionRoute({ path, children }: { path: string; children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const feature = planFeatureForPath(path)
  const blockedByPlan = Boolean(user && feature && !hasPlanFeature(user, feature))

  useEffect(() => {
    if (!blockedByPlan) return
    toast.error("This isn't included in your plan. Upgrade your plan to use more tools or functions.")
  }, [blockedByPlan, path])

  if (isLoading) return <LoadingScreen />
  if (!canAccessRoute(user, path)) {
    return <Navigate to={getDefaultHomePath(user)} replace />
  }

  return <>{children}</>
}

/** Shared /projects/.../tasks/task=ID links open under All tasks (or My tasks if no access). */
function SharedTaskLinkRedirect() {
  const { user, isLoading } = useAuth()
  const { taskKey } = useParams()
  const [searchParams] = useSearchParams()
  const taskId = parseTaskKeyParam(taskKey)
  const activityId = parseActivityIdParam(searchParams.get('activity'))

  if (isLoading) return <LoadingScreen />
  if (!taskId) return <Navigate to="/tasks" replace />
  if (isHrUser(user) || isFinanceRoleOnly(user)) {
    return <Navigate to={getDefaultHomePath(user)} replace />
  }

  const canViewAll =
    user?.role === 'admin' || hasPermission(user, 'tasks.view_all')

  return (
    <Navigate
      to={
        canViewAll
          ? buildAllTasksViewPath(taskId, activityId)
          : buildMyTasksViewPath(taskId, activityId)
      }
      replace
    />
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootEntry />} />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />
      <Route
        path="/finance/login"
        element={
          <GuestOnly>
            <FinanceLogin />
          </GuestOnly>
        }
      />
      <Route
        path="/client/login"
        element={
          <GuestOnly>
            <ClientLogin />
          </GuestOnly>
        }
      />
      <Route
        path="/admin/login"
        element={
          <GuestOnly>
            <PlatformLogin />
          </GuestOnly>
        }
      />
      <Route path="/plan-ended" element={<PlanEnded />} />
      <Route path="/invite/:token" element={<InviteAccept />} />

      <Route element={<RequireAuth />}>
        <Route path="/platform" element={<PlatformLayout />}>
          <Route index element={<PlatformOverview />} />
          <Route path="clients" element={<PlatformClients />} />
          <Route path="clients/invited/:userId" element={<PlatformClientDetail />} />
          <Route path="clients/:organizationId" element={<PlatformClientDetail />} />
          <Route path="finance" element={<PlatformFinance />} />
          <Route path="plans" element={<PlatformPlans />} />
          <Route path="notifications" element={<PlatformNotifications />} />
          <Route path="settings" element={<PlatformSettings />} />
          <Route path="*" element={<p className="text-sm text-[#6B7280]">Page not found.</p>} />
        </Route>
        <Route element={<AppLayout />}>
          <Route path="/feed" element={
            <PermissionRoute path="/">
              <Dashboard />
            </PermissionRoute>
          } />
          <Route path="/client/approvals" element={
            <PermissionRoute path="/client/approvals">
              <ClientApprovals />
            </PermissionRoute>
          } />
          <Route path="/client/reports" element={
            <PermissionRoute path="/client/reports">
              <ClientReports />
            </PermissionRoute>
          } />
          <Route path="/client/invoices" element={
            <PermissionRoute path="/client/invoices">
              <ClientInvoices />
            </PermissionRoute>
          } />
          <Route path="/client/invoices/:invoiceId" element={
            <PermissionRoute path="/client/invoices">
              <ClientInvoices />
            </PermissionRoute>
          } />
          <Route path="/client/milestones" element={
            <PermissionRoute path="/client/milestones">
              <ClientMilestones />
            </PermissionRoute>
          } />
          <Route path="/client/files" element={
            <PermissionRoute path="/client/files">
              <ClientFiles />
            </PermissionRoute>
          } />
          <Route path="/client/meetings" element={
            <PermissionRoute path="/client/meetings">
              <ClientMeetings />
            </PermissionRoute>
          } />
          <Route path="/client/messages" element={
            <PermissionRoute path="/client/messages">
              <ClientMessages />
            </PermissionRoute>
          } />
          <Route path="/tasks" element={
            <PermissionRoute path="/tasks"><Tasks /></PermissionRoute>
          } />
          <Route path="/tasks/chats" element={<Navigate to="/task-chats" replace />} />
          <Route path="/tasks/:taskKey/*" element={
            <PermissionRoute path="/tasks"><Tasks /></PermissionRoute>
          } />
          <Route path="/tasks/task/view/:taskId/*" element={
            <PermissionRoute path="/tasks"><Tasks /></PermissionRoute>
          } />
          <Route path="/task-chats" element={
            <PermissionRoute path="/task-chats"><TaskChats /></PermissionRoute>
          } />
          <Route path="/kanban" element={<Navigate to="/tasks?view=kanban" replace />} />
          <Route path="/time-tracking" element={
            <PermissionRoute path="/time-tracking"><TimeTracking /></PermissionRoute>
          } />
          <Route path="/inbox" element={<Navigate to="/" replace />} />
          <Route path="/projects" element={
            <PermissionRoute path="/projects"><Projects /></PermissionRoute>
          } />
          <Route path="/projects/:projectSlug/tasks/:taskKey/*" element={
            <SharedTaskLinkRedirect />
          } />
          <Route path="/projects/:id" element={
            <PermissionRoute path="/projects"><ProjectDetail /></PermissionRoute>
          } />
          <Route path="/settings" element={<Settings />} />
          <Route path="/m/*" element={<Navigate to="/" replace />} />
          <Route path="/admin/hours" element={<Navigate to="/time-tracking" replace />} />
          <Route path="/working-hours" element={<Navigate to="/time-tracking" replace />} />
          <Route path="/analytics" element={
            <PermissionRoute path="/analytics">
              <Analytics />
            </PermissionRoute>
          } />
          <Route path="/leaves" element={
            <PermissionRoute path="/leaves">
              <Leaves />
            </PermissionRoute>
          } />
          <Route path="/leave" element={<Navigate to="/leaves" replace />} />
          <Route path="/leave-management" element={
            <PermissionRoute path="/leave-management">
              <LeaveManagement />
            </PermissionRoute>
          } />
          <Route path="/attendance-management" element={
            <PermissionRoute path="/attendance-management">
              <AttendanceManagement />
            </PermissionRoute>
          } />
          <Route path="/locations" element={
            <PermissionRoute path="/locations">
              <Locations />
            </PermissionRoute>
          } />
          <Route path="/qr-code" element={
            <PermissionRoute path="/qr-code">
              <OrgQrCode />
            </PermissionRoute>
          } />
          <Route path="/recent-employees" element={
            <PermissionRoute path="/recent-employees">
              <RecentEmployees />
            </PermissionRoute>
          } />

          {/* Admin Routes */}
          <Route path="/admin/employees" element={
            <PermissionRoute path="/admin/employees">
              <AdminEmployees />
            </PermissionRoute>
          } />
          <Route path="/admin/departments" element={
            <PermissionRoute path="/admin/departments">
              <AdminDepartments />
            </PermissionRoute>
          } />
          <Route path="/admin/tasks" element={
            <PermissionRoute path="/admin/tasks">
              <AdminAllTasks />
            </PermissionRoute>
          } />
          <Route path="/admin/tasks/:taskKey/*" element={
            <PermissionRoute path="/admin/tasks">
              <AdminAllTasks />
            </PermissionRoute>
          } />
          <Route path="/admin/client-tasks" element={
            <PermissionRoute path="/admin/client-tasks">
              <AdminClientTasks />
            </PermissionRoute>
          } />
          <Route path="/admin/client-tasks/:taskKey/*" element={
            <PermissionRoute path="/admin/client-tasks">
              <AdminClientTasks />
            </PermissionRoute>
          } />
          <Route path="/admin/permissions" element={
            <PermissionRoute path="/admin/permissions">
              <AdminPermissions />
            </PermissionRoute>
          } />
          <Route path="/admin/pricing" element={
            <PermissionRoute path="/admin/pricing">
              <AdminPricing />
            </PermissionRoute>
          } />
          <Route path="/admin/invoices" element={
            <PermissionRoute path="/admin/invoices">
              <AdminInvoices />
            </PermissionRoute>
          } />
          <Route path="/admin/invoices/new" element={
            <PermissionRoute path="/admin/invoices">
              <AdminInvoices />
            </PermissionRoute>
          } />
          <Route path="/admin/invoices/:invoiceId" element={
            <PermissionRoute path="/admin/invoices">
              <AdminInvoices />
            </PermissionRoute>
          } />
          <Route path="/admin/invoices/:invoiceId/edit" element={
            <PermissionRoute path="/admin/invoices">
              <AdminInvoices />
            </PermissionRoute>
          } />
          <Route path="/admin/customers" element={
            <PermissionRoute path="/admin/customers">
              <AdminCustomers />
            </PermissionRoute>
          } />
          <Route path="/admin/customers/new" element={
            <PermissionRoute path="/admin/customers">
              <AdminCustomers />
            </PermissionRoute>
          } />
          <Route path="/admin/customers/:customerId" element={
            <PermissionRoute path="/admin/customers">
              <AdminCustomers />
            </PermissionRoute>
          } />
          <Route path="/admin/customers/:customerId/edit" element={
            <PermissionRoute path="/admin/customers">
              <AdminCustomers />
            </PermissionRoute>
          } />
          <Route path="/admin/reports" element={
            <PermissionRoute path="/admin/reports">
              <BusinessReports />
            </PermissionRoute>
          } />
          <Route path="/finance/banks" element={
            <PermissionRoute path="/finance/banks">
              <BankAccountsPage />
            </PermissionRoute>
          } />
          <Route path="/finance/chart-of-accounts" element={
            <PermissionRoute path="/finance/chart-of-accounts">
              <ChartOfAccountsPage />
            </PermissionRoute>
          } />
          <Route path="/finance/estimates" element={
            <PermissionRoute path="/finance/estimates">
              <EstimatesPage />
            </PermissionRoute>
          } />
          <Route path="/finance/payments" element={
            <PermissionRoute path="/finance/payments">
              <PaymentsPage />
            </PermissionRoute>
          } />
          <Route path="/finance/expenses" element={
            <PermissionRoute path="/finance/expenses">
              <ExpensesPage />
            </PermissionRoute>
          } />
          <Route path="/finance/contracts" element={
            <PermissionRoute path="/finance/contracts">
              <ContractsPage />
            </PermissionRoute>
          } />
          <Route path="/finance/receivable" element={
            <PermissionRoute path="/finance/receivable">
              <ReceivablePage />
            </PermissionRoute>
          } />
          <Route path="/finance/payable" element={
            <PermissionRoute path="/finance/payable">
              <PayablePage />
            </PermissionRoute>
          } />
          <Route path="/finance/tax" element={
            <PermissionRoute path="/finance/tax">
              <TaxCompliancePage />
            </PermissionRoute>
          } />
          <Route path="/finance/reports" element={
            <PermissionRoute path="/finance/reports">
              <ReportsHubPage />
            </PermissionRoute>
          } />
          <Route path="/finance/profit-loss" element={
            <PermissionRoute path="/finance/profit-loss">
              <ReportsHubPage />
            </PermissionRoute>
          } />
          <Route path="/finance/cash-flow" element={
            <PermissionRoute path="/finance/cash-flow">
              <ReportsHubPage />
            </PermissionRoute>
          } />
          <Route path="/finance/balance-sheet" element={
            <PermissionRoute path="/finance/balance-sheet">
              <ReportsHubPage />
            </PermissionRoute>
          } />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
