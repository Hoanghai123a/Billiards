import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Page, Spinner, Text, Sheet, Box, useSnackbar } from "zmp-ui";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { walletService } from "@/api/services";
import pb from "@/api/pocketbase";
import type { WalletSummary, WalletTransaction, WalletTopup, WalletTopupPayment } from "@/api/pocketbase";
import type { WalletSpinItem, WalletSpinPrize } from "@/api/services";
import { formatVietnamDate, formatVietnamDateTime, vietnamDateBounds } from "@/utils/format";
import { normalizeTransferContent } from "@/utils/transfer";
import { readSessionCache, removeSessionCache, writeSessionCache } from "@/utils/session-cache";
import PinnedPageHeader from "@/components/pinned-page-header";

type BankApp = { appId: string; appName: string; appLogo?: string; autofill?: number };
type TopupResume = { topup: WalletTopup; payment: WalletTopupPayment };

const money = (value: number) => `${value.toLocaleString("vi-VN")}đ`;
const TOPUP_RESUME_KEY = "wallet-topup-resume";
const BANK_APP_KEY = "wallet-topup-bank-app";
const formatAmountInput = (value: string) => {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits).toLocaleString("vi-VN") : "";
};
const getAmount = (value: string) => Number(value.replace(/\D/g, "")) || 0;

export default function WalletPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { openSnackbar } = useSnackbar();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [topups, setTopups] = useState<WalletTopup[]>([]);
  const [spinData, setSpinData] = useState<{ minTopup: number; prizes: WalletSpinPrize[]; items: WalletSpinItem[] }>({ minTopup: 0, prizes: [], items: [] });
  const [spinningTopup, setSpinningTopup] = useState("");
  const [activeSpin, setActiveSpin] = useState<{ id: string } | null>(null);
  const [spinningSession, setSpinningSession] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmountInput, setTopupAmountInput] = useState("100.000");
  const [topup, setTopup] = useState<WalletTopup | null>(null);
  const [topupPayment, setTopupPayment] = useState<WalletTopupPayment | null>(null);
  const [topupBusy, setTopupBusy] = useState(false);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [bankApps, setBankApps] = useState<BankApp[]>([]);
  const [bankAppsLoading, setBankAppsLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [type, setType] = useState<"all" | "main" | "promo">("all");
  const [direction, setDirection] = useState<"all" | "credit" | "debit">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const confirmedTransfer = useRef(false);
  const topupAmount = getAmount(topupAmountInput);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let refreshing = false;
    let refreshQueued = false;
    let refreshTimer: number | undefined;
    const refreshWallet = async (initial = false) => {
      if (refreshing) { refreshQueued = true; return; }
      refreshing = true;
      try {
        do {
          refreshQueued = false;
          const [summary, history, topupHistory, spins, sessions] = await Promise.all([walletService.getMine(), walletService.getMyTransactions(), walletService.getMyTopups(), walletService.getSpins(), walletService.getSpinSessions()]);
          if (!active) return;
          setWallet(summary);
          setTransactions(history.items);
          setHistoryPage(1);
          setHistoryTotal(history.totalItems);
          setTopups(topupHistory.items);
          setSpinData(spins);
          setActiveSpin(sessions[0] ? { id: sessions[0].id } : null);
          setTopup((current) => topupHistory.items.find((item) => item.id === current?.id) || current);
        } while (refreshQueued && active);
      } catch {
        if (initial && active) setError("Không thể tải thông tin ví. Vui lòng thử lại.");
      } finally {
        refreshing = false;
        if (initial && active) setLoading(false);
      }
    };
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshWallet(), 250);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshWallet();
    };
    void refreshWallet(true);
    const walletSubscription = pb.collection("wallets").subscribe("*", ({ record }) => {
      if (record.user === user.id) scheduleRefresh();
    });
    const transactionSubscription = pb.collection("wallet_transactions").subscribe("*", ({ record }) => {
      if (record.user === user.id) scheduleRefresh();
    });
    void walletSubscription.catch((subscriptionError) => console.warn("Không thể theo dõi số dư ví realtime:", subscriptionError));
    void transactionSubscription.catch((subscriptionError) => console.warn("Không thể theo dõi giao dịch ví realtime:", subscriptionError));
    const timer = window.setInterval(refreshWhenVisible, 60000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void walletSubscription.then((unsubscribe) => unsubscribe()).catch(() => {});
      void transactionSubscription.then((unsubscribe) => unsubscribe()).catch(() => {});
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const subscription = pb.collection("wallet_spin_sessions").subscribe("*", ({ action, record }) => {
      if (!active || record.user !== user.id) return;
      if (action === "create" && record.status === "pending") setActiveSpin({ id: record.id });
      if (action === "update" && record.status !== "pending") setActiveSpin((current) => current?.id === record.id ? null : current);
    });
    return () => { active = false; void subscription.then((unsubscribe) => unsubscribe()).catch(() => {}); };
  }, [user?.id]);

  useEffect(() => {
    if (!topupOpen || topup?.status !== "paid") return;
    confirmedTransfer.current = true;
    removeSessionCache(TOPUP_RESUME_KEY);
    setTopupOpen(false);
    openSnackbar({ text: `Nạp tiền thành công. Ví đã được cộng ${money(topup.amount)}.`, type: "success", position: "top" });
  }, [openSnackbar, topup?.amount, topup?.status, topupOpen]);

  useEffect(() => {
    if (loading) return;
    try {
      window.localStorage.removeItem(TOPUP_RESUME_KEY);
      window.localStorage.removeItem(BANK_APP_KEY);
    } catch {}
    const topupId = searchParams.get("topupId");
    if (topupId) {
      try {
        const saved = readSessionCache<TopupResume>(TOPUP_RESUME_KEY, 15 * 60 * 1000);
        if (saved?.topup.id === topupId) {
          confirmedTransfer.current = false;
          setTopup(saved.topup);
          setTopupPayment(saved.payment);
          setTopupOpen(true);
          navigate("/account/wallet", { replace: true });
          return;
        }
      } catch {}
    }
    if (searchParams.get("topup") === "1") {
      openTopup();
      navigate("/account/wallet", { replace: true });
    }
  }, [loading, searchParams]);

  const openTopup = () => {
    confirmedTransfer.current = false;
    setTopup(null);
    setTopupPayment(null);
    setError("");
    setTopupOpen(true);
  };

  const loadMoreHistory = async () => {
    if (historyLoading || transactions.length >= historyTotal) return;
    setHistoryLoading(true);
    try {
      const next = await walletService.getMyTransactions(historyPage + 1);
      setTransactions((current) => [...current, ...next.items]);
      setHistoryPage(next.page);
      setHistoryTotal(next.totalItems);
    } catch (loadError: any) {
      openSnackbar({ text: loadError?.response?.message || loadError?.response?.data?.error || "Không thể tải thêm lịch sử giao dịch", type: "error", position: "top" });
    } finally {
      setHistoryLoading(false);
    }
  };

  const createTopup = async () => {
    if (!Number.isInteger(topupAmount) || topupAmount < 1000) return setError("Số tiền nạp tối thiểu là 1.000đ.");
    setTopupBusy(true);
    setError("");
    try {
      const result = await walletService.createTopup({ amount: topupAmount, idempotencyKey: `topup-${user?.id || "user"}-${Date.now()}` });
      setTopup(result.topup);
      setTopupPayment(result.payment);
      setTopups((current) => [result.topup, ...current.filter((item) => item.id !== result.topup.id)]);
    } catch (requestError: any) {
      setError(requestError?.response?.message || requestError?.response?.data?.error || "Không thể tạo yêu cầu nạp tiền.");
    } finally {
      setTopupBusy(false);
    }
  };

  const spin = async (topupId: string) => {
    setSpinningTopup(topupId);
    try {
      const result = await walletService.spinTopup(topupId);
      openSnackbar({ text: result.prizeAmount > 0 ? `Bạn trúng ${result.prizeName}: ${money(result.prizeAmount)}!` : result.prizeName, type: result.prizeAmount > 0 ? "success" : "warning", position: "top" });
      const [summary, spins] = await Promise.all([walletService.getMine(), walletService.getSpins()]);
      setWallet(summary);
      setSpinData(spins);
    } catch (error: any) {
      openSnackbar({ text: error?.response?.data?.error || "Không thể quay số, vui lòng thử lại", type: "error", position: "top" });
    } finally { setSpinningTopup(""); }
  };
  const spinAdminSession = async () => {
    if (!activeSpin) return;
    setSpinningSession(true);
    try {
      const result = await walletService.spinSession(activeSpin.id);
      setActiveSpin(null);
      openSnackbar({ text: result.prizeAmount > 0 ? `Bạn trúng ${result.prizeName}: ${money(result.prizeAmount)}!` : result.prizeName, type: result.prizeAmount > 0 ? "success" : "warning", position: "top" });
      setWallet(await walletService.getMine());
    } catch (error: any) { openSnackbar({ text: error?.response?.data?.error || "Không thể quay số, vui lòng thử lại", type: "error", position: "top" }); }
    finally { setSpinningSession(false); }
  };

  const closeTopup = async () => {
    if (topupBusy) return;
    setTopupOpen(false);
    removeSessionCache(TOPUP_RESUME_KEY);
    if (!topup || confirmedTransfer.current || topup.status !== "pending") return;
    setTopupBusy(true);
    try {
      const result = await walletService.cancelTopup(topup.id);
      setTopups((current) => result.topup.status === "expired"
        ? current.filter((item) => item.id !== topup.id)
        : current.map((item) => item.id === topup.id ? { ...item, ...result.topup } : item));
    } catch {
      // A webhook may have completed the top-up while the sheet was open.
    } finally {
      setTopupBusy(false);
    }
  };

  const confirmTransfer = () => {
    confirmedTransfer.current = true;
    removeSessionCache(TOPUP_RESUME_KEY);
    setTopupOpen(false);
    openSnackbar({ text: "Đã ghi nhận. Ví sẽ được cộng tự động khi ngân hàng xác nhận giao dịch.", type: "success", position: "top" });
  };

  const topupQrUrl = topup && topupPayment
    ? topupPayment.qrCodeImage || `https://vietqr.app/img?${new URLSearchParams({ bank: topupPayment.bankId, acc: topupPayment.accountNumber, template: "compact", amount: String(topup.amount), des: normalizeTransferContent(topup.transferCode), showinfo: "true", holder: topupPayment.accountName })}`
    : "";
  const statusLabel: Record<string, string> = { pending: "Chờ ngân hàng xác nhận", paid: "Đã cộng tiền", rejected: "Đã từ chối", expired: "Chưa thanh toán" };

  const transferUrl = (appId: string) => {
    if (!topup || !topupPayment) return "";
    const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
    const returnUrl = `${window.location.origin}/account/wallet?topupId=${topup.id}`;
    return `https://dl.vietqr.io/pay?app=${encode(appId)}&am=${topup.amount}&tn=${encode(normalizeTransferContent(topup.transferCode))}&ba=${topupPayment.accountNumber}@${topupPayment.bankId.toLowerCase()}&bn=${encode(topupPayment.accountName)}&url=${returnUrl}`;
  };

  const openBankTransfer = async () => {
    try { window.localStorage.removeItem(BANK_APP_KEY); } catch {}
    const savedAppId = readSessionCache<string>(BANK_APP_KEY, 30 * 24 * 60 * 60 * 1000);
    if (savedAppId) {
      writeSessionCache(TOPUP_RESUME_KEY, { topup, payment: topupPayment });
      window.location.assign(transferUrl(savedAppId));
      return;
    }
    setBankPickerOpen(true);
    if (bankApps.length || bankAppsLoading) return;
    setBankAppsLoading(true);
    try {
      const isIos = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
      const response = await fetch(`https://api.vietqr.io/v2/${isIos ? "ios" : "android"}-app-deeplinks`);
      const data = await response.json() as { apps?: BankApp[] };
      const apps = (data.apps || []).filter((app) => app.appId && app.appName && Number(app.autofill) === 1);
      if (!apps.length) throw new Error("Không có ứng dụng hỗ trợ");
      setBankApps(apps);
    } catch {
      setBankPickerOpen(false);
      openSnackbar({ text: "Không tải được danh sách ứng dụng ngân hàng. Bạn vẫn có thể quét mã QR để thanh toán.", type: "warning", position: "top" });
    } finally {
      setBankAppsLoading(false);
    }
  };

  const selectBankApp = (appId: string) => {
    writeSessionCache(BANK_APP_KEY, appId);
    writeSessionCache(TOPUP_RESUME_KEY, { topup, payment: topupPayment });
    setBankPickerOpen(false);
    window.location.assign(transferUrl(appId));
  };

  const visibleTransactions = useMemo(() => transactions.filter((item) => {
    const created = new Date(item.created).getTime();
    const from = fromDate ? vietnamDateBounds(fromDate) : -Infinity;
    const to = toDate ? vietnamDateBounds(toDate, true) : Infinity;
    return created >= from && created <= to && (type === "all" || item.wallet_type === type) && (direction === "all" || item.direction === direction);
  }), [transactions, type, direction, fromDate, toDate]);

  if (loading) return <Page className="flex items-center justify-center bg-slate-50"><Spinner /></Page>;

  return (
    <Page className="min-h-screen bg-slate-50 pb-24 dark:bg-black">
      {activeSpin && <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/60 px-4"><section className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 text-center shadow-xl"><Text.Title size="small">Bạn được mời quay số</Text.Title><Text size="small" className="block text-slate-600">Admin đã bật một lượt quay cho bạn.</Text><div className="grid grid-cols-2 gap-2">{spinData.prizes.slice(0, 6).map((prize, index) => <div key={`${prize.name}-${index}`} className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-2 text-xs"><strong className="block truncate">{prize.name}</strong><span>{money(prize.amount)}</span></div>)}</div><button type="button" disabled={spinningSession} onClick={() => void spinAdminSession()} className="min-h-12 w-full rounded-xl bg-amber-500 text-sm font-semibold text-white disabled:opacity-60">{spinningSession ? "Đang quay..." : "Quay ngay"}</button></section></div>}
      <PinnedPageHeader className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 pb-3 pt-12 dark:border-white/10 dark:bg-black">
        <button type="button" aria-label="Quay lại" onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-white/10"><Icon icon="zi-arrow-left" /></button>
        <Text.Title size="small" className="flex-1">Ví tài khoản</Text.Title>
        <button type="button" onClick={openTopup} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white">Nạp tiền</button>
      </PinnedPageHeader>
      <main className="space-y-4 px-4 py-4">
        {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"><Text size="xSmall" className="text-slate-500">Tài khoản chính</Text><Text.Title className="mt-2 text-green-600">{money(wallet?.mainBalance || 0)}</Text.Title></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"><Text size="xSmall" className="text-slate-500">Tài khoản khuyến mại</Text><Text.Title className="mt-2 text-orange-500">{money(wallet?.promoBalance || 0)}</Text.Title></div>
        </section>
        {topups.length > 0 && <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"><div className="mb-3 flex items-center justify-between"><Text.Title size="small">Yêu cầu nạp gần đây</Text.Title><Text size="xSmall" className="text-slate-500">{topups.length}</Text></div><div className="space-y-3">{topups.slice(0, 3).map((item) => <div key={item.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-white/10"><div className="min-w-0"><Text size="small" className="font-semibold">{money(item.amount)}</Text><Text size="xSmall" className="mt-1 block text-slate-500">Mã chuyển khoản: {item.transferCode}</Text></div><Text size="xSmall" className={item.status === "paid" ? "text-green-600" : item.status === "rejected" ? "text-red-600" : "text-orange-600"}>{statusLabel[item.status]}</Text></div>)}</div></section>}
        {spinData.minTopup > 0 && spinData.prizes.length > 0 && <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><Icon icon="zi-star" className="text-amber-600" /><Text.Title size="small">Quay số nạp tiền</Text.Title></div><Text size="xSmall" className="block text-slate-600">Nạp từ {money(spinData.minTopup)} để nhận một lượt quay cho mỗi giao dịch.</Text><div className="grid grid-cols-2 gap-2">{spinData.prizes.map((prize, index) => <div key={`${prize.name}-${index}`} className="rounded-lg border border-amber-100 bg-white px-3 py-2"><Text size="xSmall" className="block truncate font-semibold">{prize.name}</Text><Text size="xSmall" className="text-slate-500">{money(prize.amount)} · {prize.probability}%</Text></div>)}</div><div className="space-y-2">{spinData.items.slice(0, 5).map((item) => <div key={item.topupId} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"><div className="min-w-0"><Text size="xSmall" className="block font-medium">Nạp {money(item.amount)}</Text>{item.result && <Text size="xSmall" className="block truncate text-emerald-700">{item.result.prizeName}{item.result.prizeAmount > 0 ? ` · +${money(item.result.prizeAmount)}` : ""}</Text>}</div>{item.result ? <Text size="xSmall" className="text-slate-500">Đã quay</Text> : item.eligible ? <button type="button" disabled={!!spinningTopup} onClick={() => void spin(item.topupId)} className="min-h-9 shrink-0 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-white disabled:opacity-60">{spinningTopup === item.topupId ? "Đang quay..." : "Quay ngay"}</button> : <Text size="xSmall" className="text-slate-400">Chưa đủ điều kiện</Text>}</div>)}</div></section>}
        <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"><div className="mb-3 flex items-center justify-between"><Text.Title size="small">Khuyến mại sắp hết hạn</Text.Title><Icon icon="zi-star" className="text-orange-500" /></div>{wallet?.promoLots.length ? wallet.promoLots.map((lot) => <div key={lot.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0 dark:border-white/10"><div><Text size="small">Còn {money(lot.remainingAmount)}</Text><Text size="xSmall" className="text-slate-500">Hết hạn {formatVietnamDate(lot.expiresAt)}</Text></div><Text size="xSmall" className="text-orange-600">Ưu tiên dùng trước</Text></div>) : <Text size="small" className="text-slate-500">Không có lô khuyến mại còn hạn.</Text>}</section>
        <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"><div className="mb-2 flex items-center justify-between"><Text.Title size="small">Lịch sử giao dịch</Text.Title><button type="button" aria-label="Lọc lịch sử" onClick={() => setFilterOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-white/10"><Icon icon="zi-filter" /></button></div>{visibleTransactions.length ? visibleTransactions.map((item) => <div key={item.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0 dark:border-white/10"><div className="min-w-0"><Text size="small" className="truncate">{item.reason}</Text><Text size="xSmall" className="text-slate-500">{formatVietnamDateTime(item.created)} · {item.wallet_type === "promo" ? "Khuyến mại" : "Tài khoản chính"}</Text></div><Text size="small" className={item.direction === "credit" ? "font-semibold text-green-600" : "font-semibold text-red-500"}>{item.direction === "credit" ? "+" : "-"}{money(item.amount)}</Text></div>) : <Text size="small" className="text-slate-500">Chưa có giao dịch phù hợp.</Text>}{transactions.length < historyTotal && <button type="button" disabled={historyLoading} onClick={() => void loadMoreHistory()} className="mt-3 w-full rounded-lg border py-2 text-sm text-green-700 disabled:opacity-50">{historyLoading ? "Đang tải..." : "Xem thêm"}</button>}</section>
      </main>
      <Sheet visible={topupOpen} onClose={() => void closeTopup()} autoHeight swipeToClose unmountOnClose><Box className="max-h-[88vh] space-y-4 overflow-y-auto px-4 pb-8 pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Nạp tiền vào ví</Text.Title><button aria-label="Đóng nạp tiền" onClick={() => void closeTopup()} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>{!topup ? <><Text size="small" className="text-slate-600">Nhập số tiền cần nạp. Tài khoản nhận, mã QR và nội dung chuyển khoản được tạo tự động.</Text><label className="block text-sm font-medium">Số tiền nạp<input type="text" inputMode="numeric" value={topupAmountInput} onChange={(event) => setTopupAmountInput(formatAmountInput(event.target.value))} placeholder="Ví dụ: 100.000" className="mt-2 min-h-12 w-full rounded-lg border px-3 text-right text-lg font-semibold" /></label>{topupAmount > 0 && <Text size="xSmall" className="block text-right text-slate-500">{money(topupAmount)}</Text>}<button type="button" disabled={topupBusy} onClick={() => void createTopup()} className="min-h-12 w-full rounded-xl bg-green-600 px-4 font-semibold text-white disabled:opacity-60">{topupBusy ? "Đang tạo yêu cầu..." : "Tạo yêu cầu nạp"}</button></> : <div className="space-y-4"><div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">Chuyển đúng <strong>{money(topup.amount)}</strong> với nội dung <strong>{topup.transferCode}</strong>.</div>{topupQrUrl && <img src={topupQrUrl} alt="Mã QR nạp tiền vào ví" className="mx-auto aspect-square w-56 rounded-lg border bg-white object-contain" />}<div className="space-y-1 text-center"><Text size="small" className="font-semibold">{topupPayment?.accountName}</Text><Text size="xSmall" className="text-slate-600">{topupPayment?.bankId} · {topupPayment?.accountNumber}</Text></div>{topup.status === "paid" ? <><div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-800">Đã nhận xác nhận từ Tingee và cộng {money(topup.amount)} vào ví.</div><button type="button" onClick={() => void closeTopup()} className="min-h-12 w-full rounded-xl bg-green-600 text-sm font-semibold text-white">Hoàn tất</button></> : <><Text size="xSmall" className="block text-center text-slate-500">Sau khi chuyển khoản, bấm Thanh toán để hệ thống chờ ngân hàng xác nhận.</Text><div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => void closeTopup()} className="min-h-12 rounded-xl border border-slate-300 text-sm font-semibold leading-tight text-slate-700">Đóng</button><button type="button" onClick={() => void openBankTransfer()} className="min-h-12 rounded-xl border border-emerald-600 px-2 text-sm font-semibold leading-tight text-emerald-700">Chuyển khoản</button><button type="button" onClick={confirmTransfer} className="min-h-12 rounded-xl bg-green-600 px-2 text-sm font-semibold leading-tight text-white">Thanh toán</button></div></>}</div>}</Box></Sheet>
      <Sheet visible={bankPickerOpen} onClose={() => setBankPickerOpen(false)} autoHeight swipeToClose unmountOnClose><Box className="max-h-[80vh] space-y-3 overflow-y-auto px-4 pb-8 pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Chọn ứng dụng ngân hàng</Text.Title><button aria-label="Đóng danh sách ngân hàng" onClick={() => setBankPickerOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><Text size="xSmall" className="block text-slate-500">Ứng dụng được chọn sẽ tự điền số tiền và nội dung chuyển khoản, đồng thời được ghi nhớ cho lần sau.</Text>{bankAppsLoading ? <div className="flex justify-center py-8"><Spinner /></div> : bankApps.map((app) => <button key={app.appId} type="button" onClick={() => selectBankApp(app.appId)} className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 text-left"><span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-slate-100">{app.appLogo ? <img src={app.appLogo} alt="" className="h-full w-full object-cover" /> : <Icon icon="zi-wallet" />}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{app.appName}</span><Icon icon="zi-chevron-right" className="text-slate-400" /></button>)}</Box></Sheet>
      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} autoHeight><Box className="space-y-4 px-4 pb-8 pt-4"><Text.Title size="small">Lọc lịch sử</Text.Title><label className="block text-sm">Loại tiền<select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="mt-2 w-full rounded-lg border p-3"><option value="all">Tất cả</option><option value="main">Tài khoản chính</option><option value="promo">Khuyến mại</option></select></label><label className="block text-sm">Loại giao dịch<select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)} className="mt-2 w-full rounded-lg border p-3"><option value="all">Tất cả</option><option value="credit">Tăng tiền</option><option value="debit">Giảm tiền</option></select></label><div className="grid grid-cols-2 gap-2"><label className="text-sm">Từ ngày<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label><label className="text-sm">Đến ngày<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label></div><button type="button" onClick={() => setFilterOpen(false)} className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white">Áp dụng</button></Box></Sheet>
    </Page>
  );
}
