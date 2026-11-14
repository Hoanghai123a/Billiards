import { useEffect, useState } from "react";
import { Avatar, Icon, Page, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { adminNotificationService, billPaymentService, walletService } from "@/api/services";
import type { AdminNotification, BillPaymentSettings, WalletSummary } from "@/api/pocketbase";

type VietQrBank = { code: string; bin: string; name: string; shortName: string; isTransfer: number };

const PAGE_CLASS =
  "flex flex-col bg-white pb-[calc(env(safe-area-inset-bottom,0px)+96px)] dark:bg-black";

function AccountPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<BillPaymentSettings>({ bankId: "", accountNumber: "", accountName: "", sepayVirtualAccount: "", sepayBankCode: "" });
  const [paymentSettingsLoading, setPaymentSettingsLoading] = useState(false);
  const [paymentSettingsError, setPaymentSettingsError] = useState("");
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [banks, setBanks] = useState<VietQrBank[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [banksError, setBanksError] = useState("");
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();

  useEffect(() => {
    if (!isAuthenticated) {
      setWallet(null);
      return;
    }
    let active = true;
    const refreshWallet = () => walletService.getMine().then((summary) => {
      if (active) setWallet(summary);
    }).catch(() => {});
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshWallet();
    };
    void refreshWallet();
    const timer = window.setInterval(refreshWhenVisible, 5000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "admin") return;
    let active = true;
    setPaymentSettingsLoading(true);
    billPaymentService.getSettings().then((settings) => {
      if (active) setPaymentSettings(settings);
    }).catch((error) => {
      if (active) setPaymentSettingsError(error?.response?.message || error?.message || "Không thể tải tài khoản nhận tiền");
    }).then(() => {
      if (active) setPaymentSettingsLoading(false);
    });
    return () => { active = false; };
  }, [isAuthenticated, user?.id, user?.role]);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "admin") return;
    let active = true;
    const loadNotifications = () => adminNotificationService.list().then((result) => { if (active) setNotifications(result.items); }).catch(() => {});
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isAuthenticated, user?.role]);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "admin") {
      setBanksLoading(false);
      return;
    }
    let active = true;
    setBanksLoading(true);
    setBanksError("");
    fetch("https://api.vietqr.io/v2/banks").then(async (response) => {
      if (!response.ok) throw new Error("Không thể tải danh sách ngân hàng");
      return response.json() as Promise<{ data?: VietQrBank[] }>;
    }).then(({ data }) => {
      const supportedBanks = (Array.isArray(data) ? data : [])
        .filter((bank) => bank.isTransfer === 1 && /^\d{6}$/.test(String(bank.bin ?? "")) && /ngân hàng|tmcp|\bbank\b/i.test(String(bank.name ?? "").normalize("NFC")))
        .sort((a, b) => String(a.shortName ?? "").localeCompare(String(b.shortName ?? ""), "vi"));
      if (!supportedBanks.length) throw new Error("Danh sách ngân hàng VietQR trống");
      if (active) setBanks(supportedBanks);
    }).catch(() => {
      if (active) setBanksError("Không tải được danh sách ngân hàng VietQR. Hãy kiểm tra kết nối rồi tải lại trang.");
    }).finally(() => {
      if (active) setBanksLoading(false);
    });
    return () => { active = false; };
  }, [isAuthenticated, user?.role]);

  const paymentBankId = String(paymentSettings.bankId ?? "");
  const selectedBank = banks.find((bank) => paymentBankId && (bank.bin === paymentBankId || String(bank.code ?? "").toLowerCase() === paymentBankId.toLowerCase()));
  const hasPaymentDetails = !!(paymentSettings.bankId || paymentSettings.accountNumber || paymentSettings.accountName);

  const savePaymentSettings = async () => {
    setSavingPaymentSettings(true);
    setPaymentSettingsError("");
    try {
      setPaymentSettings(await billPaymentService.saveSettings({ ...paymentSettings, bankId: selectedBank?.bin || "", sepayBankCode: selectedBank?.code || paymentSettings.sepayBankCode }));
      openSnackbar({ text: "Đã lưu tài khoản nhận tiền QR", type: "success", position: "top" });
    } catch (error: any) {
      const message = error?.response?.message || error?.response?.data?.error || error?.message || "Không thể lưu tài khoản nhận tiền";
      setPaymentSettingsError(message);
      openSnackbar({ text: message, type: "error", position: "top" });
    } finally {
      setSavingPaymentSettings(false);
    }
  };

  const handleLogout = () => {
    logout();
    openSnackbar({
      text: "Đã đăng xuất",
      type: "success",
      position: "top",
    });
    navigate("/login");
  };

  if (isLoading) {
    return (
      <Page className={PAGE_CLASS + " items-center justify-center"}>
        <Spinner />
      </Page>
    );
  }

  if (!isAuthenticated || !user) {
    navigate("/login");
    return null;
  }

  return (
    <Page className={PAGE_CLASS}>
      <div className="flex items-start gap-3 px-4 py-4 pt-12 border-b border-black/5 dark:border-white/10">
        <Avatar size={64}>
          {user.username.charAt(0).toUpperCase()}
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Text.Title size="small" className="truncate">
            {user.fullname || user.username}
          </Text.Title>
          {user.email && (
            <Text
              size="xSmall"
              className="truncate text-[#767a7f] dark:text-[#8f9499]"
            >
              {user.email}
            </Text>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {user.role === "admin" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e8ba02]/15 px-2 py-1 text-[11px] font-semibold text-[#8a6d00] dark:bg-[#e8ba02]/20 dark:text-[#e8ba02]">
                <Icon icon="zi-star-solid" size={12} />
                Admin
              </span>
            )}
            {user.verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-1 text-[11px] font-semibold text-green-700 dark:bg-green-500/20 dark:text-green-400">
                <Icon icon="zi-check-circle-solid" size={12} />
                Đã xác thực
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label="Đăng xuất"
          className="flex shrink-0 items-center gap-1 py-1 text-red-500"
        >
          <Icon icon="zi-leave" />
          <Text size="xSmall">Đăng xuất</Text>
        </button>
      </div>

      <div className="flex-1">
        <div className="px-4 py-4">
          <Text.Title size="small">Thông tin tài khoản</Text.Title>

          <div className="mt-4 space-y-3">
            <section className="rounded-2xl bg-slate-50 p-4 dark:bg-white/10">
              <button type="button" onClick={() => navigate("/account/wallet")} className="w-full text-left">
                <div className="flex items-center justify-between"><Text size="small">Tài khoản chính</Text><Text size="small" className="font-semibold text-green-600">{(wallet?.mainBalance || 0).toLocaleString("vi-VN")}đ</Text></div>
                <div className="mt-3 flex items-center justify-between"><Text size="small">Tài khoản khuyến mại</Text><Text size="small" className="font-semibold text-orange-500">{(wallet?.promoBalance || 0).toLocaleString("vi-VN")}đ</Text></div>
              </button>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Text size="xSmall" className="text-[#767a7f]">Xem chi tiết và lịch sử ví</Text>
                <button type="button" onClick={() => navigate("/account/wallet?topup=1")} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg bg-green-600 px-3 text-sm font-semibold text-white">
                  <Icon icon="zi-plus" size={16} />
                  Nạp tiền
                </button>
              </div>
            </section>
            <button type="button" onClick={() => navigate("/account/xu")} className="flex w-full items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-left dark:border-amber-900 dark:bg-amber-950/30">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Icon icon="zi-star-solid" /></span>
              <span className="min-w-0 flex-1"><Text size="small" className="font-semibold">Xu thưởng</Text><Text size="xSmall" className="mt-1 block text-slate-600 dark:text-slate-300">Điểm danh, giới thiệu bạn bè và đổi quà</Text></span>
              <Icon icon="zi-chevron-right" className="shrink-0 text-slate-500" />
            </button>
            <div className="flex items-center justify-between py-3 border-b border-black/5 dark:border-white/10">
              <Text size="small" className="text-[#767a7f] dark:text-[#8f9499]">
                Tên đăng nhập
              </Text>
              <Text size="small">{user.username}</Text>
            </div>

            {user.phone && (
              <div className="flex items-center justify-between py-3 border-b border-black/5 dark:border-white/10">
                <Text size="small" className="text-[#767a7f] dark:text-[#8f9499]">Số điện thoại</Text>
                <Text size="small">{user.phone}</Text>
              </div>
            )}

            {user.email && (
              <div className="flex items-center justify-between py-3 border-b border-black/5 dark:border-white/10">
                <Text size="small" className="text-[#767a7f] dark:text-[#8f9499]">
                  Email
                </Text>
                <Text size="small">{user.email}</Text>
              </div>
            )}

            <div className="flex items-center justify-between py-3 border-b border-black/5 dark:border-white/10">
              <Text size="small" className="text-[#767a7f] dark:text-[#8f9499]">
                Vai trò
              </Text>
              <Text size="small" className="capitalize">
                {user.role || "user"}
              </Text>
            </div>

          </div>
          {user.role === "admin" && <section className="mt-5 space-y-3 border-t border-black/5 pt-4 dark:border-white/10">
            <div><Text.Title size="small">Tài khoản nhận tiền</Text.Title><Text size="xSmall" className="mt-1 block text-[#767a7f] dark:text-[#8f9499]">Tài khoản ngân hàng dùng cho bill và VA SePay dùng riêng để nạp ví.</Text></div>
            {paymentSettingsLoading ? <div className="flex justify-center py-4"><Spinner /></div> : <>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Ngân hàng nhận tiền (BIN VietQR)<select value={selectedBank?.bin || ""} onChange={(event) => setPaymentSettings((current) => ({ ...current, bankId: event.target.value }))} disabled={banksLoading || !banks.length} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="">{banksLoading ? "Đang tải ngân hàng..." : "Chọn ngân hàng"}</option>{banks.map((bank) => <option key={bank.bin} value={bank.bin}>{bank.shortName} · {bank.bin}</option>)}</select></label>
              {banksError && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{banksError}</div>}
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Số tài khoản<input autoComplete="off" inputMode="numeric" value={paymentSettings.accountNumber} onChange={(event) => setPaymentSettings((current) => ({ ...current, accountNumber: event.target.value }))} placeholder="Số tài khoản nhận tiền" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Tên chủ tài khoản<input autoComplete="off" value={paymentSettings.accountName} onChange={(event) => setPaymentSettings((current) => ({ ...current, accountName: event.target.value }))} placeholder="Tên in trên tài khoản ngân hàng" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Số tài khoản ảo SePay dùng để nạp ví<input autoComplete="off" value={paymentSettings.sepayVirtualAccount} onChange={(event) => setPaymentSettings((current) => ({ ...current, sepayVirtualAccount: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))} placeholder="Ví dụ: 96247JQK98" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label>
              {paymentSettingsError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{paymentSettingsError}</div>}
              <button type="button" disabled={savingPaymentSettings || banksLoading || (hasPaymentDetails && !selectedBank)} onClick={() => void savePaymentSettings()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{savingPaymentSettings && <Spinner />}Lưu tài khoản nhận tiền</button>
            </>}
          </section>}
          {user.role === "admin" && notifications.length > 0 && <section className="mt-5 space-y-2 border-t border-amber-200 pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Thông báo thanh toán</Text.Title><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{notifications.length} mới</span></div>{notifications.map((item) => <button key={item.id} type="button" onClick={async () => { try { await adminNotificationService.markRead(item.id); setNotifications((current) => current.filter((notification) => notification.id !== item.id)); if (item.referenceId) navigate(`/bills/${item.referenceId}`); } catch (error: any) { openSnackbar({ text: error?.response?.message || error?.response?.data?.error || "Không thể mở thông báo này", type: "error", position: "top" }); } }} className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-left"><Text size="small" className="font-semibold text-amber-950">{item.title}</Text><Text size="xSmall" className="mt-1 block text-amber-900">{item.body}</Text></button>)}</section>}
          {user.role === "admin" && <button type="button" onClick={() => navigate("/admin/registration")} className="mt-4 flex w-full items-center justify-between rounded-lg border border-green-200 px-4 py-3 text-left text-green-700"><span>Duyệt tài khoản</span><Icon icon="zi-arrow-right" /></button>}
          {user.role === "admin" && <button type="button" onClick={() => navigate("/admin")} className="mt-4 flex w-full items-center justify-between rounded-lg border border-emerald-200 px-4 py-3 text-left text-emerald-800"><span>Dashboard quản trị</span><Icon icon="zi-arrow-right" /></button>}
          {user.role === "admin" && <button type="button" onClick={() => navigate("/admin/wallets")} className="mt-4 flex w-full items-center justify-between rounded-xl border border-green-200 px-4 py-3 text-left text-green-700"><span>Quản lý ví user</span><Icon icon="zi-arrow-right" /></button>}
          {user.role === "admin" && <button type="button" onClick={() => navigate("/admin/xu")} className="mt-3 flex w-full items-center justify-between rounded-lg border border-amber-200 px-4 py-3 text-left text-amber-800"><span>Quản lý Xu</span><Icon icon="zi-arrow-right" /></button>}
          {user.role === "admin" && <button type="button" onClick={() => navigate("/admin/promotions")} className="mt-3 flex w-full items-center justify-between rounded-lg border border-emerald-200 px-4 py-3 text-left text-emerald-800"><span>Chương trình khuyến mại</span><Icon icon="zi-arrow-right" /></button>}
        </div>
      </div>

    </Page>
  );
}

export default AccountPage;
