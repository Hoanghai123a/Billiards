import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { strToU8, zipSync } from "fflate";

import { inventoryService, reportSettingsService, tableBillHistoryService } from "@/api/services";
import type { InventoryItem, TableBillingReport } from "@/api/pocketbase";
import StoreHeader from "@/components/store-header";
import { useAuth } from "@/contexts/AuthContext";
import AdminNav from "@/components/admin-nav";
import { formatVietnamDateTime, fromVietnamDateTimeInput, toVietnamDateTimeInput } from "@/utils/format";

const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString("vi-VN")}đ`;
const dateTime = (value: string) => formatVietnamDateTime(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const methodLabel: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", wallet: "Ví" };
const today = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
const localNow = () => toVietnamDateTimeInput(new Date().toISOString());
const MAX_REPORT_RANGE_MS = 32 * 24 * 60 * 60 * 1000;
type Shift = { name: string; start: string; end: string };
const defaultShifts: Record<2 | 3, Shift[]> = {
  2: [{ name: "Ca 1", start: "08:00", end: "20:00" }, { name: "Ca 2", start: "20:00", end: "08:00" }],
  3: [{ name: "Ca 1", start: "08:00", end: "14:00" }, { name: "Ca 2", start: "14:00", end: "20:00" }, { name: "Ca 3", start: "20:00", end: "08:00" }],
};
const dateOffset = (value: string, days: number) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const nextMonthStart = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
};
const shiftDateTimeInput = (value: string, offsetMs: number) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  const shifted = new Date(time + offsetMs - new Date(time + offsetMs).getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
};
const xmlEscape = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");

function downloadWorkbook(sheets: { name: string; rows: (string | number)[][]; numericColumns?: number[] }[], filename: string) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`),
  };
  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      let column = columnIndex + 1;
      let reference = "";
      while (column) { reference = String.fromCharCode(65 + (column - 1) % 26) + reference; column = Math.floor((column - 1) / 26); }
      const cell = `${reference}${rowIndex + 1}`;
      return rowIndex > 0 && sheet.numericColumns?.includes(columnIndex)
        ? `<c r="${cell}"><v>${Number(value) || 0}</v></c>`
        : `<c r="${cell}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  const url = URL.createObjectURL(new Blob([zipSync(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function messageOf(error: any) {
  return error?.response?.data?.error || error?.response?.message || error?.message || "Không thể tải báo cáo";
}

export default function AdminReportsPage() {
  const { user, storeId } = useAuth();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const openSnackbarRef = useRef(openSnackbar);
  openSnackbarRef.current = openSnackbar;
  const [from, setFrom] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`billiard:admin-reports-range:${storeId}`) || "null")?.from || `${today()}T00:00`; }
    catch { return `${today()}T00:00`; }
  });
  const [to, setTo] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`billiard:admin-reports-range:${storeId}`) || "null")?.to || localNow(); }
    catch { return localNow(); }
  });
  const [tableName, setTableName] = useState("");
  const [productName, setProductName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState("");
  const [report, setReport] = useState<TableBillingReport | null>(null);
  const loadedReportQueryRef = useRef("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [expandedLists, setExpandedLists] = useState({ products: false, inventory: false, tables: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<TableBillingReport["products"][number] | null>(null);
  const [selectedProductHistory, setSelectedProductHistory] = useState<TableBillingReport["products"][number]["history"]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [shiftType, setShiftType] = useState<2 | 3>(2);
  const [shifts, setShifts] = useState<Shift[]>(defaultShifts[2]);
  const [shiftIndex, setShiftIndex] = useState(0);
  const [shiftSettingsOpen, setShiftSettingsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftShiftType, setDraftShiftType] = useState<2 | 3>(2);
  const [draftShifts, setDraftShifts] = useState<Shift[]>(defaultShifts[2]);
  const [savingShiftSettings, setSavingShiftSettings] = useState(false);

  useEffect(() => {
    void reportSettingsService.get().then((settings) => {
      setShiftType(settings.shiftType);
      setShifts(settings.shifts);
      setDraftShiftType(settings.shiftType);
      setDraftShifts(settings.shifts);
    }).catch((error) => {
      openSnackbarRef.current({ text: messageOf(error), type: "error", position: "top" });
    });
  }, []);

  const setQuickRange = (preset: "today" | "yesterday" | "week" | "month") => {
    const currentDay = today();
    const currentDate = new Date(`${currentDay}T00:00:00Z`);
    const mondayOffset = (currentDate.getUTCDay() + 6) % 7;
    const start = preset === "yesterday" ? dateOffset(currentDay, -1)
      : preset === "week" ? dateOffset(currentDay, -mondayOffset)
        : preset === "month" ? `${currentDay.slice(0, 8)}01` : currentDay;
    setFrom(`${start}T00:00`);
    const end = preset === "yesterday" ? currentDay : preset === "week" ? dateOffset(start, 7) : preset === "month" ? nextMonthStart(start) : dateOffset(currentDay, 1);
    setTo(`${end}T00:00`);
  };

  const setShiftRange = () => {
    const day = today();
    const shift = shifts[shiftIndex] || shifts[0];
    const overnight = shift.end <= shift.start;
    setFrom(`${overnight ? dateOffset(day, -1) : day}T${shift.start}`);
    setTo(`${overnight ? day : day}T${shift.end}`);
  };

  const saveShiftSettings = async () => {
    setSavingShiftSettings(true);
    try {
      const saved = await reportSettingsService.save(draftShiftType, draftShifts);
      setShiftType(saved.shiftType);
      setShifts(saved.shifts);
      setShiftIndex(0);
      setShiftSettingsOpen(false);
      openSnackbar({ text: "Đã lưu cấu hình ca", type: "success", position: "top" });
    } catch (error) {
      openSnackbar({ text: messageOf(error), type: "error", position: "top" });
    } finally {
      setSavingShiftSettings(false);
    }
  };

  const openProductHistory = async (product: TableBillingReport["products"][number]) => {
    setSelectedProduct(product);
    setSelectedProductHistory([]);
    setHistoryLoading(true);
    try {
      const result = await tableBillHistoryService.productHistory({ productId: product.productId, from: fromVietnamDateTimeInput(from), to: fromVietnamDateTimeInput(to) });
      setSelectedProductHistory(result.history || []);
    } catch (error) {
      openSnackbar({ text: messageOf(error), type: "error", position: "top" });
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    try { localStorage.setItem(`billiard:admin-reports-range:${storeId}`, JSON.stringify({ from, to })); }
    catch { /* Keep the filter usable when browser storage is unavailable. */ }
  }, [from, to, storeId]);

  const load = useCallback(async (nextPage = 1) => {
    if (from > to) { openSnackbar({ text: "Thời điểm bắt đầu không được sau thời điểm kết thúc", type: "warning", position: "top" }); return; }
    if (Date.parse(to) - Date.parse(from) > MAX_REPORT_RANGE_MS) { openSnackbar({ text: "Chỉ được lọc tối đa 32 ngày", type: "warning", position: "top" }); return; }
    if (nextPage === 1) setLoading(true); else setLoadingMore(true);
    try {
      const result = await tableBillHistoryService.report({ from: fromVietnamDateTimeInput(from), to: fromVietnamDateTimeInput(to), tableName: tableName.trim(), productName: productName.trim(), paymentMethod, accountId, category, page: nextPage });
      if (nextPage === 1) loadedReportQueryRef.current = [from, to, tableName.trim(), productName.trim(), paymentMethod, accountId, category].join("\u0001");
      setReport((current) => nextPage === 1 || !current ? result : { ...result, payments: [...current.payments, ...result.payments] });
    } catch (error) {
      openSnackbar({ text: messageOf(error), type: "error", position: "top" });
    } finally {
      if (nextPage === 1) setLoading(false); else setLoadingMore(false);
    }
  }, [from, to, tableName, productName, paymentMethod, accountId, category, openSnackbar]);

  const exportReport = async () => {
    setExporting(true);
    try {
      if (from > to) throw new Error("Thời điểm bắt đầu không được sau thời điểm kết thúc");
      if (Date.parse(to) - Date.parse(from) > MAX_REPORT_RANGE_MS) throw new Error("Chỉ được lọc tối đa 32 ngày");
      const queryKey = [from, to, tableName.trim(), productName.trim(), paymentMethod, accountId, category].join("\u0001");
      let result = report && !report.hasMore && loadedReportQueryRef.current === queryKey
        ? report
        : await tableBillHistoryService.report({ from: fromVietnamDateTimeInput(from), to: fromVietnamDateTimeInput(to), tableName: tableName.trim(), productName: productName.trim(), paymentMethod, accountId, category, page: 1, pageSize: 5000 });
      const payments = [...result.payments];
      while (result.hasMore) {
        result = await tableBillHistoryService.report({ from: fromVietnamDateTimeInput(from), to: fromVietnamDateTimeInput(to), tableName: tableName.trim(), productName: productName.trim(), paymentMethod, accountId, category, page: result.page + 1, pageSize: 5000 });
        payments.push(...result.payments);
      }
      downloadWorkbook([
        { name: "Tổng quan", rows: [["Báo cáo doanh thu", "Giá trị"], ["Từ thời điểm", from], ["Đến thời điểm", to], ["Tên bàn", tableName.trim() || "Tất cả"], ["Phương thức", methodLabel[paymentMethod] || "Tất cả"], ["Tài khoản thanh toán", result.accounts.find((account) => account.id === accountId)?.name || "Tất cả"], ["Danh mục", category || "Tất cả"], ["Tổng doanh thu (VNĐ)", result.summary.totalRevenue], ["Số hóa đơn", result.summary.paidBills], ["Tiền mặt (VNĐ)", result.summary.cashAmount], ["Chuyển khoản (VNĐ)", result.summary.transferAmount], ["Ví (VNĐ)", result.summary.walletAmount]], numericColumns: [1] },
        { name: "Theo ngày", rows: [["Ngày", "Số hóa đơn", "Tổng doanh thu (VNĐ)", "Tiền mặt (VNĐ)", "Chuyển khoản (VNĐ)", "Ví (VNĐ)"], ...result.daily.map((day) => [day.date, day.paidBills, day.totalRevenue, day.cashAmount, day.transferAmount, day.walletAmount])], numericColumns: [1, 2, 3, 4, 5] },
        { name: "Theo giờ", rows: [["Thời điểm", "Số hóa đơn", "Tổng doanh thu (VNĐ)", "Tiền mặt (VNĐ)", "Chuyển khoản (VNĐ)", "Ví (VNĐ)"], ...result.hourly.map((hour) => [dateTime(hour.hour), hour.paidBills, hour.totalRevenue, hour.cashAmount, hour.transferAmount, hour.walletAmount])], numericColumns: [1, 2, 3, 4, 5] },
        { name: "Theo bàn", rows: [["Bàn", "Số hóa đơn", "Tổng doanh thu (VNĐ)", "Tiền mặt (VNĐ)", "Chuyển khoản (VNĐ)", "Ví (VNĐ)"], ...result.tables.map((table) => [table.tableName, table.paidBills, table.totalRevenue, table.cashAmount, table.transferAmount, table.walletAmount])], numericColumns: [1, 2, 3, 4, 5] },
        { name: "Theo mặt hàng", rows: [["Mặt hàng", "Số lượng", "Đơn vị", "Số hóa đơn", "Doanh thu gộp (VNĐ)"], ...result.products.map((product) => [product.name, product.quantity, product.unitLabel, product.billCount, product.revenue])], numericColumns: [1, 3, 4] },
        { name: "Lịch sử mặt hàng", rows: [["Mặt hàng", "Thời gian", "Bàn", "Mã hóa đơn", "Số lượng", "Đơn vị", "Thành tiền (VNĐ)"], ...result.products.flatMap((product) => (product.history || []).map((sale) => [product.name, dateTime(sale.paidAt), sale.tableName, sale.billId, sale.quantity, product.unitLabel, sale.amount]))], numericColumns: [4, 6] },
        { name: "Thanh toán", rows: [["Thời gian", "Bàn", "Mã hóa đơn", "Số tiền (VNĐ)", "Phương thức", "Người thực hiện"], ...payments.map((payment) => [dateTime(payment.paidAt), payment.tableName, payment.billId, payment.amount, methodLabel[payment.paymentMethod] || payment.paymentMethod, payment.actorName])], numericColumns: [3] },
        { name: "Chi tiết mặt hàng", rows: [["Thời gian", "Bàn", "Mã hóa đơn", "Mặt hàng", "Số lượng", "Đơn vị", "Thành tiền (VNĐ)"], ...payments.flatMap((payment) => payment.items.map((item) => [dateTime(payment.paidAt), payment.tableName, payment.billId, item.name, item.quantity, item.unitLabel, item.amount]))], numericColumns: [4, 6] },
        { name: "Tồn kho", rows: [["Mặt hàng", "Danh mục", "Đơn vị", "Tồn hiện có", "Đang giữ", "Khả dụng"], ...inventory.map((item) => [item.name, item.category, item.unitLabel, item.onHand, item.reserved, item.available])], numericColumns: [3, 4, 5] },
      ], `bao-cao-thanh-toan-ton-kho-${from}-${to}.xlsx`);
    } catch (error) {
      openSnackbar({ text: messageOf(error), type: "error", position: "top" });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (user?.role !== "admin") { navigate("/", { replace: true }); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, navigate]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    void inventoryService.list().then((result) => setInventory(result.items)).catch((error) => {
      openSnackbarRef.current({ text: messageOf(error), type: "error", position: "top" });
    }).finally(() => setInventoryLoading(false));
  }, [user?.role]);

  const inventorySummary = useMemo(() => ({
    total: inventory.length,
    out: inventory.filter((item) => item.available <= 0).length,
    reserved: inventory.filter((item) => item.reserved > 0).length,
  }), [inventory]);
  if (user?.role !== "admin") return null;
  const summary = report?.summary;

  return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+120px)]">
    <StoreHeader />
    <AdminNav />
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4">
      <header className="flex items-center gap-3">
        <button type="button" aria-label="Mở bộ lọc báo cáo" title="Bộ lọc" onClick={() => setFilterOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700"><Icon icon="zi-filter" /></button>
        <button type="button" disabled={!report || exporting} onClick={() => void exportReport()} className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-800 disabled:opacity-50"><Icon icon="zi-download" />{exporting ? "Đang xuất" : "Xuất Excel"}</button>
        <button type="button" onClick={() => navigate("/admin/bill-history")} className="flex h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700"><Icon icon="zi-clock-1" />Lịch sử bill</button>
      </header>

      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} autoHeight swipeToClose unmountOnClose><Box className="max-h-[88vh] space-y-3 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Bộ lọc báo cáo</Text.Title><button type="button" aria-label="Đóng bộ lọc" onClick={() => setFilterOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
      <form onSubmit={(event) => { event.preventDefault(); void load(); setFilterOpen(false); }} className="space-y-3">
        <section className="space-y-2 border-b border-slate-100 pb-3">
          <Text size="xSmall" className="font-semibold text-slate-600">Khoảng thời gian nhanh</Text>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["today", "Hôm nay"], ["yesterday", "Hôm qua"], ["week", "Tuần này"], ["month", "Tháng này"]] as const).map(([preset, label]) => <button key={preset} type="button" onClick={() => setQuickRange(preset)} className="min-h-10 rounded-md border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700">{label}</button>)}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select value={shiftIndex} onChange={(event) => setShiftIndex(Number(event.target.value))} className="min-h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm">{shifts.map((shift, index) => <option key={`${shift.name}-${index}`} value={index}>{shift.name} ({shift.start}-{shift.end})</option>)}</select>
            <button type="button" onClick={setShiftRange} className="min-h-10 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800">Theo ca</button>
          </div>
          <button type="button" onClick={() => { setDraftShiftType(shiftType); setDraftShifts(shifts); setShiftSettingsOpen(true); }} className="text-left text-xs font-medium text-slate-500">Cài đặt {shiftType} ca</button>
        </section>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
          <label className="min-w-0 text-xs font-medium text-slate-700">Từ thời điểm<input required type="datetime-local" value={from} min={shiftDateTimeInput(to, -MAX_REPORT_RANGE_MS)} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <span className="pb-3 text-xs text-slate-500">đến</span>
          <label className="min-w-0 text-xs font-medium text-slate-700">Đến thời điểm<input required type="datetime-local" value={to} min={from || undefined} max={shiftDateTimeInput(from, MAX_REPORT_RANGE_MS)} onChange={(event) => setTo(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-sm" /></label>
        </div>
        <details className="group rounded-md border border-slate-200 px-3">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700">Bộ lọc mở rộng<span className="text-xs text-slate-500">Tên bàn, mặt hàng, thanh toán</span></summary>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 py-3"><label className="text-sm font-medium text-slate-700">Tên bàn<input value={tableName} onChange={(event) => setTableName(event.target.value)} placeholder="Ví dụ: Bàn 1" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base" /></label><label className="text-sm font-medium text-slate-700">Mặt hàng<input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Tìm trong hóa đơn" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base" /></label><label className="text-sm font-medium text-slate-700">Tài khoản thanh toán<select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"><option value="">Tất cả</option>{report?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Danh mục<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"><option value="">Tất cả</option>{report?.categories.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label className="col-span-2 text-sm font-medium text-slate-700">Phương thức<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"><option value="">Tất cả</option><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option><option value="wallet">Ví</option></select></label></div>
        </details>
        <button type="submit" disabled={loading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{loading && <Spinner />}Xem báo cáo</button>
      </form>
      </Box></Sheet>

      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : !report ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Chưa có dữ liệu báo cáo.</div> : <><section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Tổng doanh thu", summary?.totalRevenue || 0, "col-span-2 bg-emerald-50 text-emerald-800"], ["Số hóa đơn", summary?.paidBills || 0, "bg-white text-slate-800"], ["Tiền mặt", summary?.cashAmount || 0, "bg-white text-slate-800"], ["Chuyển khoản", summary?.transferAmount || 0, "bg-white text-slate-800"], ["Ví", summary?.walletAmount || 0, "bg-white text-slate-800"]].map(([label, value, style]) => <div key={String(label)} className={`rounded-lg border border-slate-200 p-3 ${style}`}><Text size="xSmall" className="font-medium opacity-75">{label}</Text><Text className="mt-1 block text-lg font-bold">{label === "Số hóa đơn" ? value : money(Number(value))}</Text></div>)}</section>
        <section className="space-y-2"><Text.Title size="small" className="text-slate-900">Thống kê theo mặt hàng</Text.Title>{report.products.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">Chưa có dữ liệu mặt hàng.</div> : <><div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{report.products.slice(0, expandedLists.products ? report.products.length : 10).map((product) => <button type="button" key={product.productId || product.name} onClick={() => void openProductHistory(product)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"><div className="min-w-0"><Text size="small" className="font-semibold text-slate-900">{product.name}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{product.quantity.toLocaleString("vi-VN")} {product.unitLabel} · {product.billCount} hóa đơn · Xem lịch sử</Text></div><Text size="small" className="shrink-0 font-bold text-emerald-700">{money(product.revenue)}</Text></button>)}</div>{report.products.length > 10 && <button type="button" onClick={() => setExpandedLists((current) => ({ ...current, products: !current.products }))} className="min-h-10 w-full text-sm font-semibold text-emerald-800">{expandedLists.products ? "Thu gọn" : `Xem thêm ${report.products.length - 10} mặt hàng`}</button>}</>}</section>
        <section className="space-y-2"><Text.Title size="small" className="text-slate-900">Tồn kho hiện tại</Text.Title>{inventoryLoading ? <div className="flex justify-center py-6"><Spinner /></div> : <><div className="grid grid-cols-3 gap-2">{[["Mặt hàng", inventorySummary.total, "text-slate-900"], ["Hết khả dụng", inventorySummary.out, "text-rose-700"], ["Đang được giữ", inventorySummary.reserved, "text-amber-700"]].map(([label, value, color]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-3"><Text size="xSmall" className="text-slate-500">{label}</Text><Text className={`mt-1 block text-lg font-bold ${color}`}>{value}</Text></div>)}</div>{inventory.length ? <><div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{inventory.slice(0, expandedLists.inventory ? inventory.length : 10).map((item) => <article key={item.id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><Text size="small" className="font-semibold text-slate-900">{item.name}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{item.category} · Tồn {item.onHand.toLocaleString("vi-VN")} · Giữ {item.reserved.toLocaleString("vi-VN")}</Text></div><Text size="small" className={`shrink-0 font-bold ${item.available > 0 ? "text-emerald-700" : "text-rose-700"}`}>Còn {item.available.toLocaleString("vi-VN")} {item.unitLabel}</Text></article>)}</div>{inventory.length > 10 && <button type="button" onClick={() => setExpandedLists((current) => ({ ...current, inventory: !current.inventory }))} className="min-h-10 w-full text-sm font-semibold text-emerald-800">{expandedLists.inventory ? "Thu gọn" : `Xem thêm ${inventory.length - 10} mặt hàng`}</button>}</> : <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">Chưa có mặt hàng cần quản lý tồn kho.</div>}</>}</section>
        <section className="space-y-2"><Text.Title size="small" className="text-slate-900">Doanh thu theo bàn</Text.Title>{report.tables.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">Chưa có dữ liệu theo bàn.</div> : <><div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{report.tables.slice(0, expandedLists.tables ? report.tables.length : 10).map((table) => <article key={table.tableName} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><Text size="small" className="font-semibold text-slate-900">{table.tableName}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{table.paidBills} hóa đơn · TM {money(table.cashAmount)} · CK {money(table.transferAmount)} · Ví {money(table.walletAmount)}</Text></div><Text size="small" className="shrink-0 font-bold text-emerald-700">{money(table.totalRevenue)}</Text></article>)}</div>{report.tables.length > 10 && <button type="button" onClick={() => setExpandedLists((current) => ({ ...current, tables: !current.tables }))} className="min-h-10 w-full text-sm font-semibold text-emerald-800">{expandedLists.tables ? "Thu gọn" : `Xem thêm ${report.tables.length - 10} bàn`}</button>}</>}</section>
      </>}
    </main>
    <Sheet visible={shiftSettingsOpen} onClose={() => setShiftSettingsOpen(false)} autoHeight swipeToClose unmountOnClose><Box className="max-h-[88vh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><div><Text.Title size="small">Cài đặt ca</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Áp dụng riêng cho cửa hàng</Text></div><button type="button" aria-label="Đóng cài đặt ca" onClick={() => setShiftSettingsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><label className="block text-sm font-medium text-slate-700">Mô hình ca<select value={draftShiftType} onChange={(event) => { const nextType = Number(event.target.value) as 2 | 3; setDraftShiftType(nextType); setDraftShifts(defaultShifts[nextType]); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"><option value="2">2 ca</option><option value="3">3 ca</option></select></label><div className="space-y-3">{draftShifts.map((shift, index) => <div key={index} className="grid grid-cols-[1fr_1fr] gap-2"><label className="col-span-2 text-sm font-medium text-slate-700">Tên ca<input value={shift.name} onChange={(event) => setDraftShifts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-base" /></label><label className="text-sm font-medium text-slate-700">Bắt đầu<input type="time" value={shift.start} onChange={(event) => setDraftShifts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.target.value } : item))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-base" /></label><label className="text-sm font-medium text-slate-700">Kết thúc<input type="time" value={shift.end} onChange={(event) => setDraftShifts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.target.value } : item))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-base" /></label></div>)}</div><button type="button" disabled={savingShiftSettings} onClick={() => void saveShiftSettings()} className="flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{savingShiftSettings ? "Đang lưu" : "Lưu cấu hình ca"}</button></Box></Sheet>
    <Sheet visible={Boolean(selectedProduct)} onClose={() => setSelectedProduct(null)} autoHeight swipeToClose unmountOnClose><Box className="max-h-[88vh] space-y-3 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><div className="min-w-0"><Text.Title size="small">Lịch sử mặt hàng</Text.Title><Text size="xSmall" className="mt-1 block truncate text-slate-500">{selectedProduct?.name}</Text></div><button type="button" aria-label="Đóng lịch sử mặt hàng" onClick={() => setSelectedProduct(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>{historyLoading ? <div className="flex justify-center py-8"><Spinner /></div> : selectedProductHistory.length ? <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{selectedProductHistory.map((sale, index) => <button type="button" key={`${sale.billId}-${sale.paidAt}-${index}`} onClick={() => navigate(`/bills/${sale.billId}`)} className="flex w-full items-start gap-3 px-3 py-3 text-left"><div className="min-w-0 flex-1"><Text size="small" className="font-semibold text-slate-900">{sale.tableName} · {dateTime(sale.paidAt)}</Text><Text size="xSmall" className="mt-1 block text-slate-500">Hóa đơn {sale.billId} · {sale.quantity.toLocaleString("vi-VN")} {selectedProduct?.unitLabel}</Text></div><Text size="small" className="shrink-0 font-bold text-emerald-700">{money(sale.amount)}</Text></button>)}</div> : <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Chưa có lịch sử bán.</div>}</Box></Sheet>
  </Page>;
}
