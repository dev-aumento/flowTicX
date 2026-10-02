import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet } from "react-router";
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

export function AppLayout({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const clientPortal = isClientPortalUser(user);
  const layoutMode = useLayoutMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarWidth =
    clientPortal && layoutMode !== "drawer"
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
          clientPortal
            ? "min-h-screen bg-[#F6F4F2] text-[#1E1F21] dark:bg-[#25262A] dark:text-[#F5F4F3]"
            : "min-h-screen bg-[#F8F9FA] text-[#1F2937] dark:bg-[#0d1117] dark:text-[#f3f4f6]"
        }
      >
        {clientPortal ? null : <GeofenceAutoClockOut />}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          drawerOpen={drawerOpen}
          onDrawerOpenChange={setDrawerOpen}
        />
        <div
          className="flex flex-col min-h-screen transition-[margin] duration-300"
          style={{ marginLeft: sidebarWidth }}
        >
          <Topbar
            sidebarWidth={sidebarWidth}
            showMenuButton={layoutMode === "drawer"}
            onMenuClick={() => setDrawerOpen(true)}
          />
          <main
            className={
              clientPortal
                ? "flex-1 px-5 pt-[4.25rem] pb-10 sm:px-7 sm:pt-[4.5rem] min-w-0"
                : "flex-1 p-4 pt-[4.5rem] sm:p-5 sm:pt-20 lg:p-6 lg:pt-20 min-w-0"
            }
          >
            <PlanExpiryNotice />
            {children ?? <Outlet />}
          </main>
        </div>
        <AppToaster />
        <TaskNotificationToasts />
      </div>
    </SidebarWidthContext.Provider>
  );
}
