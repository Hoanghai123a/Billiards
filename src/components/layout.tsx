import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { SnackbarProvider } from "zmp-ui";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import TabBar from "./taskbar";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { StaffQueueProvider } from "@/contexts/StaffQueueContext";

const HomePage = lazy(() => import("@/pages/index"));
const AccountPage = lazy(() => import("@/pages/account"));
const PlayingPage = lazy(() => import("@/pages/playing"));
const TablesPage = lazy(() => import("@/pages/tables"));
const LoginPage = lazy(() => import("@/pages/login"));
const WalletPage = lazy(() => import("@/pages/wallet"));
const AdminWalletsPage = lazy(() => import("@/pages/admin-wallets"));
const AdminWalletTopupsPage = lazy(() => import("@/pages/admin-wallet-topups"));
const AdminWalletSpinPage = lazy(() => import("@/pages/admin-wallet-spin"));
const AdminWalletPromoSettingsPage = lazy(() => import("@/pages/admin-wallet-promo-settings"));
const AdminRegistrationPage = lazy(() => import("@/pages/admin-registration"));
const AdminStaffPage = lazy(() => import("@/pages/admin-staff"));
const AdminAttendancePage = lazy(() => import("@/pages/admin-attendance"));
const AdminAuditLogsPage = lazy(() => import("@/pages/admin-audit-logs"));
const AdminProductsPage = lazy(() => import("@/pages/admin-products"));
const AdminBillHistoryPage = lazy(() => import("@/pages/admin-bill-history"));
const AdminReportsPage = lazy(() => import("@/pages/admin-reports"));
const XuPage = lazy(() => import("@/pages/xu"));
const AdminXuPage = lazy(() => import("@/pages/admin-xu"));
const AdminPromotionsPage = lazy(() => import("@/pages/admin-promotions"));
const AdminCustomerSegmentsPage = lazy(() => import("@/pages/admin-customer-segments"));
const AdminDashboardPage = lazy(() => import("@/pages/admin-dashboard"));
const AdminInventoryPage = lazy(() => import("@/pages/admin-inventory"));
const AdminInventorySettingsPage = lazy(() => import("@/pages/admin-inventory-settings"));
const AdminSettingsPage = lazy(() => import("@/pages/admin-settings"));
const StaffQueuePage = lazy(() => import("@/pages/staff-queue"));
const PublicBillPage = lazy(() => import("@/pages/public-bill"));

function LoadingScreen() {
  return <div role="status" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-600">Đang tải...</div>;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ứng dụng gặp lỗi:", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <section role="alert" className="w-full max-w-sm rounded-lg border border-rose-200 bg-white p-5 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Không thể hiển thị trang</h1>
          <p className="mt-2 text-sm text-slate-600">Kết nối hoặc dữ liệu tải trang có thể đã bị gián đoạn.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white">
            Tải lại ứng dụng
          </button>
        </section>
      </main>
    );
  }
}

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/public-tables" element={<PublicBillPage />} />
        <Route path="/public-tables/:tableId" element={<PublicBillPage />} />
        <Route
          path="/"
          element={<Navigate to="/home" replace />}
        />
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <TablesPage />
            </ProtectedRoute>
          }
        />
        <Route path="/news" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route path="/account/wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
        <Route path="/account/xu" element={<ProtectedRoute><XuPage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/staff/queue" element={<ProtectedRoute><StaffQueuePage /></ProtectedRoute>} />
        <Route path="/admin/inventory" element={<ProtectedRoute><AdminInventoryPage /></ProtectedRoute>} />
        <Route path="/admin/inventory/settings" element={<ProtectedRoute><AdminInventorySettingsPage /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute><AdminSettingsPage /></ProtectedRoute>} />
        <Route path="/admin/wallets" element={<ProtectedRoute><AdminWalletsPage /></ProtectedRoute>} />
        <Route path="/admin/wallet-topups" element={<ProtectedRoute><AdminWalletTopupsPage /></ProtectedRoute>} />
        <Route path="/admin/wallet-spin" element={<ProtectedRoute><AdminWalletSpinPage /></ProtectedRoute>} />
        <Route path="/admin/wallet-promo" element={<ProtectedRoute><AdminWalletPromoSettingsPage /></ProtectedRoute>} />
        <Route path="/admin/xu" element={<ProtectedRoute><AdminXuPage /></ProtectedRoute>} />
        <Route path="/admin/registration" element={<ProtectedRoute><AdminRegistrationPage /></ProtectedRoute>} />
        <Route path="/admin/staff" element={<ProtectedRoute><AdminStaffPage /></ProtectedRoute>} />
        <Route path="/admin/attendance" element={<ProtectedRoute><AdminAttendancePage /></ProtectedRoute>} />
        <Route path="/admin/audit-logs" element={<ProtectedRoute><AdminAuditLogsPage /></ProtectedRoute>} />
        <Route path="/admin/products" element={<ProtectedRoute><AdminProductsPage /></ProtectedRoute>} />
        <Route path="/admin/bill-history" element={<ProtectedRoute><AdminBillHistoryPage /></ProtectedRoute>} />
        <Route path="/admin/reports" element={<ProtectedRoute><AdminReportsPage /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><AdminReportsPage /></ProtectedRoute>} />
        <Route path="/admin/promotions" element={<ProtectedRoute><AdminPromotionsPage /></ProtectedRoute>} />
        <Route path="/admin/customer-segments" element={<ProtectedRoute><AdminCustomerSegmentsPage /></ProtectedRoute>} />
        <Route
          path="/bills/:billId"
          element={
            <ProtectedRoute>
              <PlayingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/:tableId"
          element={
            <ProtectedRoute>
              <PlayingPage />
            </ProtectedRoute>
          }
        />
        </Routes>
      </Suspense>
      <TabBar />
    </>
  );
}

const Layout = () => {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <SnackbarProvider>
          <AuthProvider>
            <StaffQueueProvider>
              <AppRoutes />
            </StaffQueueProvider>
          </AuthProvider>
        </SnackbarProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
};
export default Layout;
