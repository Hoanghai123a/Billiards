import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";

import { billPaymentService, tableBillingService } from "@/api/services";
import { useAuth } from "@/contexts/AuthContext";
import { roundBillQrAmount } from "@/utils/format";
import { normalizeTransferContent } from "@/utils/transfer";
import type { TableBill, TableBillProduct } from "@/api/pocketbase";
import { formatVietnamDateTime } from "@/utils/format";

const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString("vi-VN")}đ`;
const hourQuantity = (value: number) => {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
};

export default function PublicBillPage() {
  const { tableId: routeTableId = "" } = useParams<{ tableId: string }>();
  const [searchParams] = useSearchParams();
  const storeId = searchParams.get("store") || "";
  const [tableId, setTableId] = useState(routeTableId);
  const tableStorageKey = storeId ? `billiard:public-table:${storeId}` : "";
  const [bill, setBill] = useState<TableBill | null>(null);
  const [unpaidBills, setUnpaidBills] = useState<TableBill[]>([]);
  const [menu, setMenu] = useState<TableBillProduct[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [storeName, setStoreName] = useState("H2 Billiards");
  const [tableName, setTableName] = useState("Bàn");
  const [payment, setPayment] = useState({ bankId: "", accountNumber: "", accountName: "", tingeeVirtualAccount: "" });
  const [paymentQr, setPaymentQr] = useState("");
  const [billQrs, setBillQrs] = useState<Record<string, string>>({});
  const [combinedPaymentQr, setCombinedPaymentQr] = useState("");
  const [qrSelection, setQrSelection] = useState<"current" | "all">("current");
  const [accountPaymentOpen, setAccountPaymentOpen] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walletPaymentOpen, setWalletPaymentOpen] = useState(false);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [bankApps, setBankApps] = useState<{ appId: string; appName: string; appLogo?: string }[]>([]);
  const [bankAppsLoading, setBankAppsLoading] = useState(false);
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false);
  const [tableQuery, setTableQuery] = useState("");
  const [selectedTableId, setSelectedTableId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const adminPasswordRef = useRef<HTMLInputElement>(null);
  const [tableSwitchBusy, setTableSwitchBusy] = useState(false);
  const [vietQrBanks, setVietQrBanks] = useState<{ code: string; bin: string }[]>([]);
  const { openSnackbar } = useSnackbar();
  const { user } = useAuth();

  const load = () => tableBillingService.getPublicDetail(tableId).then((result) => {
      setError("");
      const normalizedUnpaidBills = (result.unpaidBills || []).map((item) => ({ ...item, items: Array.isArray(item.items) ? item.items : [] }));
      setUnpaidBills(normalizedUnpaidBills);
      const latest = result.bill ? { ...result.bill, items: Array.isArray(result.bill.items) ? result.bill.items : [] } : null;
      const nextBill = latest && !["paid", "cancelled"].includes(latest.status) ? latest : normalizedUnpaidBills[0] || latest;
      setBill(nextBill);
      if (nextBill?.status === "wallet_pending" && nextBill.paymentMethod === "transfer") setAccountPaymentOpen(true);
      setMenu(result.menu || []);
      setStoreName(result.storeName || "H2 Billiards");
      setTableName(result.tableName || "Bàn");
      const nextPayment = result.payment || { bankId: "", accountNumber: "", accountName: "", tingeeVirtualAccount: "" };
      billPaymentService.cacheSettings(storeId, nextPayment);
      setPayment(nextPayment);
      setLoaded(true);
    }).catch((reason) => {
      setError(reason?.response?.data?.error || "Không tìm thấy hóa đơn hoặc đường dẫn đã hết hiệu lực.");
      setLoaded(true);
    });
  useEffect(() => {
    if (!storeId) { setError("Link xem bill chưa có mã cửa hàng."); setLoaded(true); return; }
    const cachedPayment = billPaymentService.getCachedSettings(storeId);
    if (cachedPayment) setPayment(cachedPayment);
    tableBillingService.getPublicTables(storeId).then((result) => {
      const nextTables = result.tables || [];
      setTables(nextTables);
      const saved = tableStorageKey ? localStorage.getItem(tableStorageKey) : "";
      const preferred = [saved, routeTableId].find((id) => id && nextTables.some((table) => table.id === id)) || "";
      if (preferred !== tableId) { setLoaded(false); setTableId(preferred); }
      else if (!preferred) { setBill(null); setLoaded(true); setTablePickerOpen(true); }
    }).catch((reason) => {
      setTables([]);
      setError(reason?.response?.data?.error || "Không thể tải danh sách bàn.");
      setLoaded(true);
    });
  }, [storeId]);
  useEffect(() => {
    if (!tableId) return;
    let active = true;
    let timer = 0;
    const refresh = () => {
      if (!active) return;
      if (document.visibilityState !== "visible") {
        timer = window.setTimeout(refresh, 5000);
        return;
      }
      void load().finally(() => {
        if (active) timer = window.setTimeout(refresh, 5000);
      });
    };
    setLoaded(false);
    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [tableId]);

  const selectTable = async (nextTableId: string) => {
    if (!nextTableId || nextTableId === tableId) return setTablePickerOpen(false);
    setTableSwitchBusy(true);
    try {
      await tableBillingService.switchPublicTable(storeId, nextTableId, adminPassword);
      setTableId(nextTableId);
      if (tableStorageKey) localStorage.setItem(tableStorageKey, nextTableId);
      setAdminPassword("");
      setTablePickerOpen(false);
      setAdminPasswordOpen(false);
      setAccountPaymentOpen(false);
      setLoaded(false);
    } catch (reason: any) {
      openSnackbar({ text: reason?.response?.data?.error || "Mật khẩu admin không đúng hoặc không thể đổi bàn", type: "error", position: "top" });
    } finally { setTableSwitchBusy(false); }
  };

  const openTablePicker = () => {
    setTableQuery("");
    setSelectedTableId("");
    setAdminPassword("");
    setAdminPasswordOpen(false);
    setTablePickerOpen(true);
  };

  const leavePublicBill = () => {
    window.history.back();
    window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      window.close();
      window.setTimeout(() => {
        if (document.visibilityState === "visible") openSnackbar({ text: "Trình duyệt không cho phép tự đóng tab. Vui lòng dùng nút đóng hoặc quay lại của trình duyệt.", type: "info", position: "top" });
      }, 200);
    }, 150);
  };

  useEffect(() => {
    if (!adminPasswordOpen || !selectedTableId || selectedTableId === tableId) return;
    adminPasswordRef.current?.focus();
  }, [adminPasswordOpen, selectedTableId, tableId]);

  useEffect(() => {
    if (!accountPaymentOpen) {
      setPaymentQr(""); setBillQrs({}); setCombinedPaymentQr("");
      return;
    }
    if (!unpaidBills.length || (!payment.tingeeVirtualAccount && !(payment.bankId && payment.accountNumber && payment.accountName))) {
      setPaymentQr(""); setBillQrs({}); setCombinedPaymentQr(""); return;
    }
    let active = true;
    const createQr = (item: TableBill, amount: number, content: string) => billPaymentService.getQrFast({ tableId, billId: item.id, amount, content }, payment).then((result) => [item.id, result.qrCodeImage] as const).catch(() => [item.id, ""] as const);
    const billRequests = unpaidBills.map((item) => createQr(item, roundBillQrAmount(item.requestedAmount || item.totalAmount), normalizeTransferContent(`Bill ${item.tableName} ${item.id}`)));
    const totalAmount = roundBillQrAmount(unpaidBills.reduce((sum, item) => sum + (item.requestedAmount || item.totalAmount), 0));
    Promise.all([Promise.all(billRequests), createQr(unpaidBills[0], totalAmount, normalizeTransferContent(`Thanh toan tat ca bill ${unpaidBills.map((item) => item.id).join(" ")}`))]).then(([results, combined]) => {
      if (!active) return;
      const next = Object.fromEntries(results);
      setBillQrs(next);
      setPaymentQr(bill ? next[bill.id] || "" : "");
      setCombinedPaymentQr(combined[1]);
    });
    return () => { active = false; };
  }, [accountPaymentOpen, bill?.id, payment.accountName, payment.accountNumber, payment.bankId, payment.tingeeVirtualAccount, tableId, unpaidBills]);

  const requestPayment = async () => {
    setBusy(true);
    try {
      if (!bill) return;
      await tableBillingService.requestPublicTransfer(tableId, bill.id);
      await load();
      openSnackbar({ text: "Đã báo yêu cầu thanh toán tài khoản đến cửa hàng", type: "success", position: "top" });
    } catch (reason: any) {
      openSnackbar({ text: reason?.response?.data?.error || "Không thể gửi yêu cầu thanh toán", type: "error", position: "top" });
    } finally { setBusy(false); }
  };

  const continuePlaying = async () => {
    if (!bill) return;
    setBusy(true);
    try {
      const result = await tableBillingService.continuePublicPlaying(tableId, bill.id);
      setBill(result.bill);
      setAccountPaymentOpen(false);
      await load();
      openSnackbar({ text: "Đã tiếp tục chơi. Thời gian chờ thanh toán vẫn được tính liên tục.", type: "success", position: "top" });
    } catch (reason: any) {
      openSnackbar({ text: reason?.response?.data?.error || "Không thể tiếp tục chơi", type: "error", position: "top" });
      void load();
    } finally { setBusy(false); }
  };

  const payWithWallet = async () => {
    if (!bill || !user || user.role !== "user") return;
    setBusy(true);
    try {
      const result = await tableBillingService.payPublicBillWithWallet(bill.id);
      setBill({ ...result.bill, tableName: bill.tableName });
      setWalletPaymentOpen(false);
      openSnackbar({ text: `Đã thanh toán ${money(result.bill.totalAmount)} bằng ví. Bàn đã được kết thúc.`, type: "success", position: "top" });
    } catch (reason: any) {
      openSnackbar({ text: reason?.response?.data?.error || reason?.response?.data?.message || "Không thể thanh toán bằng ví", type: "error", position: "top" });
      void load();
    } finally { setBusy(false); }
  };

  const openBankPicker = async () => {
    setBankPickerOpen(true);
    if ((bankApps.length && vietQrBanks.length) || bankAppsLoading) return;
    setBankAppsLoading(true);
    try {
      const isIos = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
      const [appsResponse, banksResponse] = await Promise.all([
        fetch(`https://api.vietqr.io/v2/${isIos ? "ios" : "android"}-app-deeplinks`),
        fetch("https://api.vietqr.io/v2/banks"),
      ]);
      const [appsData, banksData] = await Promise.all([
        appsResponse.json() as Promise<{ apps?: { appId: string; appName: string; appLogo?: string; autofill?: number }[] }>,
        banksResponse.json() as Promise<{ data?: { code: string; bin: string }[] }>,
      ]);
      const apps = (appsData.apps || []).filter((app) => app.appId && app.appName && Number(app.autofill) === 1);
      const banks = banksData.data || [];
      if (!apps.length) throw new Error("Không có ứng dụng hỗ trợ");
      if (!banks.length) throw new Error("Không tải được danh sách ngân hàng");
      setBankApps(apps);
      setVietQrBanks(banks);
    } catch {
      setBankPickerOpen(false);
      openSnackbar({ text: "Không tải được danh sách ứng dụng ngân hàng. Bạn vẫn có thể quét mã QR để thanh toán.", type: "warning", position: "top" });
    } finally {
      setBankAppsLoading(false);
    }
  };

  const selectBankApp = (appId: string) => {
    const transferBankCode = vietQrBanks.find((bank) => bank.bin === payment.bankId)?.code;
    if (!transferBankCode) {
      setBankPickerOpen(false);
      openSnackbar({ text: "Không xác định được mã ngân hàng nhận tiền. Bạn có thể quét mã QR để thanh toán.", type: "warning", position: "top" });
      return;
    }
    const amount = Math.round(bill?.requestedAmount || bill?.totalAmount || 0);
    const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
    const returnUrl = `${window.location.origin}/public-tables?store=${encodeURIComponent(storeId)}`;
    const transferContent = normalizeTransferContent(`Bill ${bill?.tableName} ${bill?.id}`);
    const transferUrl = `https://dl.vietqr.io/pay?app=${encode(appId)}&am=${amount}&tn=${encode(transferContent)}&ba=${payment.accountNumber}@${transferBankCode.toLowerCase()}&bn=${encode(payment.accountName)}&url=${returnUrl}`;
    setBankPickerOpen(false);
    window.location.assign(transferUrl);
  };

  const requestOrder = async () => {
    if (!bill) return;
    const items = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
    if (!items.length) {
      openSnackbar({ text: "Vui lòng chọn ít nhất một món", type: "warning", position: "top" });
      return;
    }
    setBusy(true);
    try {
      const result = await tableBillingService.requestPublicOrder(tableId, bill.id, items);
      setBill(result.bill);
      setQuantities({});
      setMenuOpen(false);
      openSnackbar({ text: "Đã gửi yêu cầu món. Cửa hàng sẽ xác nhận trước khi tính vào bill.", type: "success", position: "top" });
    } catch (reason: any) {
      openSnackbar({ text: reason?.response?.data?.error || "Không thể gửi yêu cầu món", type: "error", position: "top" });
      void load();
    } finally { setBusy(false); }
  };

  if (!loaded && !error) return <Page className="min-h-screen bg-slate-50"><div className="flex justify-center py-20"><Spinner /></div></Page>;
  if (error) return <Page className="min-h-screen bg-slate-50 px-4 py-16"><div className="mx-auto max-w-md rounded-xl border border-rose-200 bg-white p-5 text-center text-rose-800">{error}</div></Page>;
  if (!bill) return <Page className="min-h-screen bg-slate-50 px-4 py-6"><main className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-5 text-center"><Text.Title size="small">{storeName}</Text.Title><Text size="small" className="mt-2 block text-slate-600">{tableId ? `${tableName} hiện chưa có hóa đơn.` : "Chọn bàn để xem bill hiện tại."}</Text><button type="button" onClick={openTablePicker} className="mt-4 min-h-11 w-full rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-800">Chọn bàn</button></main>{TablePicker()}{AdminPasswordPicker()}</Page>;

  const paymentPending = bill.status === "wallet_pending" && bill.paymentMethod === "transfer";
  const otherPaymentPending = bill.status === "wallet_pending" && !paymentPending;
  const status = bill.status === "paid" ? "Đã thanh toán" : bill.status === "cancelled" ? "Đã hủy" : paymentPending ? "Chờ xác nhận" : otherPaymentPending ? "Chờ duyệt ví" : bill.status === "stopped" ? "Chưa thanh toán" : "Đang sử dụng";
  const items = Array.isArray(bill.items) ? bill.items : [];
  const qrUrl = qrSelection === "all" ? combinedPaymentQr : paymentQr;
  const qrAmount = qrSelection === "all"
    ? unpaidBills.reduce((sum, item) => sum + (item.requestedAmount || item.totalAmount), 0)
    : bill?.requestedAmount || bill?.totalAmount || 0;
  return <Page className="min-h-screen bg-slate-50 px-4 py-6">
    <main className="mx-auto max-w-md space-y-4 pb-6">
      <header className="rounded-xl bg-emerald-700 px-4 py-4 text-white shadow-sm">
        <button type="button" onClick={leavePublicBill} className="flex min-h-10 items-center gap-2 rounded-lg bg-white/15 px-3 text-sm font-semibold text-white"><Icon icon="zi-arrow-left" />Trở lại</button>
        <div className="mt-3 text-center"><Text.Title size="small" className="text-white">{storeName}</Text.Title><Text size="small" className="mt-1 block text-emerald-100">Hóa đơn của bạn</Text></div>
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><Text size="small" className="text-slate-500">Mã bill</Text><Text className="break-all font-semibold text-slate-900">{bill.id}</Text></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">{status}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm"><div><span className="block text-slate-500">Bàn</span><button type="button" onClick={openTablePicker} className="mt-1 text-left text-sm text-slate-600 underline">{bill.tableName} · Đổi bàn</button></div><div><span className="block text-slate-500">Thời gian</span><strong>{formatVietnamDateTime(bill.paidAt || bill.startedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong></div></div>
      </section>
      {items.some((item) => item.queueStatus === "approval_pending" || item.queueStatus === "rejected") && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><Text.Title size="small">Yêu cầu món</Text.Title><div className="mt-2 divide-y divide-amber-200">{items.filter((item) => item.queueStatus === "approval_pending" || item.queueStatus === "rejected").map((item) => <div key={item.id} className="flex justify-between gap-3 py-2 text-sm"><span>{item.name} · {item.quantity} {item.unitLabel}</span><strong className={item.queueStatus === "rejected" ? "text-rose-700" : "text-amber-800"}>{item.queueStatus === "rejected" ? "Đã từ chối" : "Đang chờ xác nhận"}</strong></div>)}</div></section>}
      {bill.status === "open" && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><Text.Title size="small">Menu quán</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Chọn món, cửa hàng sẽ xác nhận trước khi tính tiền.</Text></div><button disabled={!menu.length || Boolean(bill.billingPaused)} onClick={() => setMenuOpen(true)} className="min-h-10 shrink-0 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Gọi món</button></div></section>}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><Text.Title size="small">Chi tiết</Text.Title><div className="mt-3 divide-y divide-slate-100">{items.filter((item) => item.lineTotal > 0).map((item) => <div key={item.id} className="flex justify-between gap-3 py-3 text-sm"><div className="min-w-0"><strong className="block break-words text-slate-900">{item.name}</strong><span className="text-slate-500">{item.billingUnit === "hour" ? hourQuantity(item.quantity) : `${item.quantity} ${item.unitLabel || "lần"}`} × {money(item.unitPrice)}</span>{item.billingUnit === "quantity" && item.startedAt && <span className="mt-1 block text-xs text-slate-500">Đặt lúc {formatVietnamDateTime(item.startedAt)}</span>}</div><strong className="shrink-0 text-right">{money(item.lineTotal)}</strong></div>)}</div><div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm"><div className="flex justify-between"><span>Tạm tính</span><strong>{money(bill.grossAmount)}</strong></div><div className="flex justify-between"><span>Khuyến mại</span><strong>-{money(bill.discountAmount)}</strong></div><div className="flex justify-between text-base font-bold text-emerald-800"><span>Tổng thanh toán</span><strong>{money(bill.totalAmount)}</strong></div></div></section>
      {unpaidBills.length > 1 && accountPaymentOpen && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div><Text.Title size="small">Các bill chưa thanh toán</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Mỗi bill có một mã QR riêng. Bạn cũng có thể chọn gộp tất cả ở phần thanh toán.</Text></div><div className="divide-y divide-slate-100">{unpaidBills.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1 text-left"><strong className="block truncate text-sm text-slate-900">{item.tableName}</strong><span className="block text-xs text-slate-500">Bill {item.id} · {money(item.requestedAmount || item.totalAmount)}</span></div>{billQrs[item.id] ? <img src={billQrs[item.id]} alt={`Mã QR bill ${item.id}`} className="h-20 w-20 rounded-md border border-slate-200 bg-white object-contain" /> : <span className="text-xs text-slate-400">Đang tạo QR</span>}</div>)}</div></section>}
      {bill.status !== "paid" && bill.status !== "cancelled" && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
        <Text.Title size="small">Thanh toán</Text.Title>
        {otherPaymentPending ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Bill đang chờ cửa hàng duyệt thanh toán ví.</div> : !accountPaymentOpen ? <>
          <div className="rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-900">Nếu thanh toán tiền mặt, vui lòng gặp nhân viên quán để được hỗ trợ.</div>
          <button type="button" disabled={busy} onClick={() => { setAccountPaymentOpen(true); void requestPayment(); }} className="min-h-12 w-full rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang gửi..." : "Thanh toán tài khoản"}</button>
        </> : <>
          <Text size="small" className="block text-slate-600">{paymentPending ? `Đang chờ cửa hàng xác nhận đã nhận ${money(bill.requestedAmount)}.` : `Tổng cần thanh toán ${money(qrAmount)}.`}</Text>
          {unpaidBills.length > 1 && <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1"><button type="button" onClick={() => setQrSelection("current")} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${qrSelection === "current" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}>Bill này</button><button type="button" onClick={() => setQrSelection("all")} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${qrSelection === "all" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}>Tất cả bill</button></div>}
          {qrSelection === "all" && <div className="rounded-lg bg-emerald-50 p-3 text-left text-sm text-emerald-900">Đang gộp {unpaidBills.length} bill chưa thanh toán: <strong>{money(qrAmount)}</strong></div>}
          {qrUrl ? <img src={qrUrl} alt={`Mã QR thanh toán ${qrSelection === "all" ? "tất cả bill" : "bill hiện tại"}`} className="mx-auto aspect-square w-56 max-w-full rounded-lg border border-slate-200 bg-white object-contain" /> : <Text size="small" className="text-amber-800">Cửa hàng chưa cấu hình tài khoản nhận chuyển khoản.</Text>}
          {payment.accountNumber && <Text size="xSmall" className="block text-slate-600">{payment.accountName} · {payment.bankId} · {payment.accountNumber}</Text>}
          {qrSelection === "current" && paymentPending ? <div className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <p>Yêu cầu đã gửi. Nếu chưa thanh toán, hãy tiếp tục chơi để bill tính giờ liên tục, gồm cả thời gian vừa chờ.</p>
            <button type="button" disabled={busy} onClick={() => void continuePlaying()} className="min-h-12 w-full rounded-lg border border-amber-700 bg-white px-3 font-semibold text-amber-900 disabled:opacity-50">{busy ? "Đang xử lý..." : "Tiếp tục chơi"}</button>
          </div> : <>
            {bill.paymentError && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{bill.paymentError}</div>}
            {user?.role === "user" && qrSelection === "current" && <button disabled={busy} onClick={() => setWalletPaymentOpen(true)} className="min-h-12 w-full rounded-lg border border-emerald-700 bg-white px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">Thanh toán bằng ví cá nhân</button>}
            {qrSelection === "current" && <div className="grid grid-cols-2 gap-2"><button disabled={!qrUrl} onClick={() => void openBankPicker()} className="min-h-12 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Chuyển khoản</button><button disabled={busy || !qrUrl} onClick={() => void requestPayment()} className="min-h-12 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang gửi..." : "Tôi đã chuyển khoản"}</button></div>}
          </>}
        </>}
      </section>}
      <div className="flex items-center justify-center gap-2 text-center text-xs text-slate-500"><Icon icon="zi-lock" /> Chỉ người có đường link này mới xem được bill</div>
    </main>
    <Sheet visible={menuOpen} onClose={() => busy ? undefined : setMenuOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div><Text.Title size="small">Menu quán</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Món sẽ được tính vào bill sau khi staff hoặc admin duyệt.</Text></div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">{menu.map((product) => <div key={product.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"><div className="min-w-0 flex-1"><Text size="small" className="block break-words font-semibold text-slate-900">{product.name}</Text><Text size="xSmall" className="text-slate-500">{product.category} · {money(product.price)} / {product.unitLabel}</Text></div><input aria-label={`Số lượng ${product.name}`} type="number" min="0" step={product.billingUnit === "weight" ? "0.1" : "1"} value={quantities[product.id] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [product.id]: Math.max(0, Number(event.target.value) || 0) }))} className="h-10 w-20 rounded-md border border-slate-300 px-2 text-center text-sm" /></div>)}</div>
        <div className="grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => setMenuOpen(false)} className="min-h-12 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">Đóng</button><button disabled={busy || !Object.values(quantities).some((quantity) => quantity > 0)} onClick={() => void requestOrder()} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Spinner /> : null}Gửi yêu cầu</button></div>
      </Box>
    </Sheet>
    <Sheet visible={bankPickerOpen} onClose={() => setBankPickerOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="max-h-[80vh] space-y-3 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><Text.Title size="small">Chọn ứng dụng ngân hàng</Text.Title><button aria-label="Đóng danh sách ngân hàng" onClick={() => setBankPickerOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
        {bankAppsLoading ? <div className="flex justify-center py-8"><Spinner /></div> : bankApps.map((app) => <button key={app.appId} type="button" onClick={() => selectBankApp(app.appId)} className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 text-left"><span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-slate-100">{app.appLogo ? <img src={app.appLogo} alt="" className="h-full w-full object-cover" /> : <Icon icon="zi-wallet" />}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{app.appName}</span><Icon icon="zi-chevron-right" className="text-slate-400" /></button>)}
      </Box>
    </Sheet>
    <Sheet visible={walletPaymentOpen} onClose={() => !busy && setWalletPaymentOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><Text.Title size="small">Thanh toán bằng ví</Text.Title><button aria-label="Đóng xác nhận thanh toán ví" onClick={() => setWalletPaymentOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
        <Text size="small" className="text-slate-600">Hệ thống sẽ dùng số dư khuyến mại trước, sau đó trừ số dư chính. Cần đủ tổng <strong>{money(bill.totalAmount)}</strong>; thanh toán thành công sẽ kết thúc bàn ngay.</Text>
        <button type="button" disabled={busy} onClick={() => void payWithWallet()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy && <Spinner />}{busy ? "Đang thanh toán..." : "Xác nhận thanh toán"}</button>
      </Box>
    </Sheet>
    {TablePicker()}
    {AdminPasswordPicker()}
  </Page>;

  function TablePicker() {
    const filteredTables = tables.filter((table) => table.name.toLocaleLowerCase("vi").includes(tableQuery.trim().toLocaleLowerCase("vi")));
    const selectedTable = tables.find((table) => table.id === selectedTableId);
    return <Sheet visible={tablePickerOpen} onClose={() => !tableSwitchBusy && setTablePickerOpen(false)} autoHeight swipeToClose unmountOnClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Chọn bàn xem bill</Text.Title><button aria-label="Đóng" onClick={() => setTablePickerOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><label className="block text-sm font-medium text-slate-700">Tìm bàn<input type="search" value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="Nhập tên hoặc số bàn" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base" /></label><div className="max-h-[38vh] space-y-2 overflow-y-auto">{filteredTables.length ? filteredTables.map((table) => <button key={table.id} type="button" onClick={() => { setSelectedTableId(table.id); setAdminPassword(""); setTablePickerOpen(false); setAdminPasswordOpen(true); }} className={`min-h-12 w-full rounded-lg border px-3 text-left text-sm font-semibold ${table.id === selectedTableId ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-800"}`}>{table.name}{table.id === tableId ? " · Đang xem" : ""}</button>) : <Text size="small" className="block py-3 text-slate-500">Không tìm thấy bàn phù hợp.</Text>}</div></Box></Sheet>;
  }

  function AdminPasswordPicker() {
    const selectedTable = tables.find((table) => table.id === selectedTableId);
    return <Sheet visible={adminPasswordOpen} onClose={() => !tableSwitchBusy && setAdminPasswordOpen(false)} autoHeight swipeToClose unmountOnClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Xác nhận chọn bàn</Text.Title><button aria-label="Đóng nhập mật khẩu" onClick={() => setAdminPasswordOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><Text size="small" className="text-slate-600">Nhập mật khẩu admin để xem bill của <strong>{selectedTable?.name || "bàn đã chọn"}</strong>.</Text><input ref={adminPasswordRef} type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Mật khẩu admin" className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base" /><button type="button" disabled={tableSwitchBusy || !adminPassword || !selectedTableId} onClick={() => void selectTable(selectedTableId)} className="min-h-12 w-full rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{tableSwitchBusy ? "Đang xác nhận..." : "Xác nhận"}</button></Box></Sheet>;
  }
}
