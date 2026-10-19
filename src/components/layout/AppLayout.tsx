import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { AppToaster } from "@/components/ui/app-toaster";
import { TaskNotificationToasts } from "@/components/notifications/TaskNotificationToasts";
import { SidebarWidthContext } from "@/hooks/useSidebarWidth";
import { getClientSidebarWidth, getSidebarWidth, useLayoutMode } from "@/hooks/use-layout-mode";
import { GeofenceAutoClockOut } from "@/hooks/useGeofenceAutoClockOut";
import { useAuth } from "@/hooks/useAuth";
import { isClientPortalUser } from "@/lib/client-portal";
import { isPlatformUser } from "@/lib/platform-admin";
import { PlanExpiryNotice } from "@/components/billing/PlanExpiryNotice";
import { MobileAppTabBar } from "@/components/layout/MobileAppTabBar";
import { NotificationMenu } from "@/components/layout/NotificationMenu";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AdminSearch } from "@/components/layout/Topbar";
import { isNativeApp } from "@/lib/native-shell";
import { isFinanceRoleOnly } from "@/lib/leave-policy";

export function AppLayout({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const clientPortal = isClientPortalUser(user);
  const nativeApp = isNativeApp();
  const location = useLocation();
  const nativeHome = nativeApp && location.pathname === "/";
  const nativeMenu = nativeApp && location.pathname.startsWith("/settings");
  const nativeImmersive = nativeHome || nativeMenu;
  const layoutMode = useLayoutMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarWidth = nativeApp
    ? 0
    : clientPortal && layoutMode !== "drawer"
      ? getClientSidebarWidth(sidebarCollapsed)
      : getSidebarWidth(layoutMode, sidebarCollapsed);

  useEffect(() => {
    if (layoutMode !== "drawer") {
      setDrawerOpen(false);
    }
  }, [layoutMode]);

  if (isPlatformUser(user)) {
    return <Navigate to="/platform" replace />;
  }

  return (
    <SidebarWidthContext.Provider value={sidebarWidth}>
      <div
        className={
          nativeHome
            ? "flex h-[100dvh] flex-col overflow-hidden bg-black text-white"
            : nativeMenu
              ? "min-h-[100dvh] bg-[#07080C] text-white"
            : nativeApp
            ? "min-h-screen bg-[#F4F7F8] text-[#333333] dark:bg-[#0d1117] dark:text-[#f3f4f6]"
            : clientPortal
            ? "min-h-screen bg-[#F6F4F2] text-[#1E1F21] dark:bg-[#25262A] dark:text-[#F5F4F3]"
            : "min-h-screen bg-[#F8F9FA] text-[#1F2937] dark:bg-[#0d1117] dark:text-[#f3f4f6]"
        }
      >
        {clientPortal ? null : <GeofenceAutoClockOut />}
        {nativeApp ? null : (
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((value) => !value)}
            drawerOpen={drawerOpen}
            onDrawerOpenChange={setDrawerOpen}
          />
        )}
        <div
          className={
            nativeHome
              ? "flex min-h-0 flex-1 flex-col"
              : "flex min-h-screen flex-col transition-[margin] duration-300"
          }
          style={{ marginLeft: sidebarWidth }}
        >
          {nativeApp && !nativeImmersive ? (
            <NativeAppHeader />
          ) : nativeApp ? null : (
            <Topbar
              sidebarWidth={sidebarWidth}
              showMenuButton={layoutMode === "drawer"}
              onMenuClick={() => setDrawerOpen(true)}
            />
          )}
          <main
            className={
              nativeHome
                ? "relative flex min-h-0 flex-1 flex-col overflow-hidden p-0"
                : nativeMenu
                ? "flex-1 min-w-0 p-0"
                : nativeApp
                ? "flex-1 min-w-0 px-4 pb-28 pt-[calc(4.5rem+env(safe-area-inset-top))]"
                : clientPortal
                  ? "flex-1 px-5 pt-[4.25rem] pb-10 sm:px-7 sm:pt-[4.5rem] min-w-0"
                  : "flex-1 p-4 pt-[4.5rem] sm:p-5 sm:pt-20 lg:p-6 lg:pt-20 min-w-0"
            }
          >
            {nativeImmersive ? null : <PlanExpiryNotice />}
            {children ?? <Outlet />}
          </main>
        </div>
        <AppToaster />
        <TaskNotificationToasts />
        {nativeApp ? <MobileAppTabBar /> : null}
      </div>
    </SidebarWidthContext.Provider>
  );
}
       
function NativeAppHeader() {
  const { user } = useAuth();
  const hideNotifications = isFinanceRoleOnly(user);

  return (
    <header
      className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-[#EEF1F3] bg-white px-3 dark:border-[#1E293B] dark:bg-[#111827]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        minHeight: "calc(3.25rem + env(safe-area-inset-top))",
      }}
    >
      <div className="min-w-0 flex-1">
        <AdminSearch placeholder="Search" />
      </div>
      <ThemeToggle />
      {hideNotifications ? null : <NotificationMenu />}
    </header>
  );
}
