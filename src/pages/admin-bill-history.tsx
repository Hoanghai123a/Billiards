import { useEffect, useMemo, useState } from "react";
import { Icon, Page, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";

import { tableBillHistoryService, tableBillingService } from "@/api/services";
import type { TableBillHistoryEvent } from "@/api/pocketbase";
import StoreHeader from "@/components/store-header";
import { useAuth } from "@/contexts/AuthContext";
import { openBillPrint } from "@/components/bill-print";
import { formatVietnamDateTime } from "@/utils/format";

const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString("vi-VN")}đ`;
const dateTime = (value: string) => formatVietnamDateTime(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const methodLabel: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", wallet: "Ví" };
const roleLabel: Record<string, string> = { admin: "Admin", staff: "Nhân viên", user: "Khách" };

function eventSummary(event: TableBillHistoryEvent) {
  const details = event.details || {};
  if (event.eventType === "quantity_changed") return `Số lượng: ${String(details.oldQuantity ?? "")} → ${String(details.newQuantity ?? "")} · Tiền: ${money(Number(details.oldLineTotal) || 0)} → ${money(Number(details.newLineTotal) || 0)}`;
  if (event.eventType === "item_time_changed") return `Thời gian: ${dateTime(String(details.oldStartedAt || ""))}–${details.oldStoppedAt ? dateTime(String(details.oldStoppedAt)) : "đang tính"} → ${dateTime(String(details.newStartedAt || ""))}–${details.newStoppedAt ? dateTime(String(details.newStoppedAt)) : "đang tính"} · Tiền: ${money(Number(details.oldLineTotal) || 0)} → ${money(Number(details.newLineTotal) || 0)}`;
  if (event.eventType === "item_added") return `${String(details.productName || "Mặt hàng")} · SL ${String(details.quantity || "")}`;
  if (event.eventType === "item_removed") return `${String(details.productName || "Mặt hàng")} · SL ${String(details.quantity ?? "")} · ${money(Number(details.lineTotal) || 0)} · đã xóa khỏi bill${details.reason ? ` · Lý do: ${String(details.reason)}` : ""}`;
  if (event.eventType === "payment_completed" && Number(details.paymentDiscountPercent) > 0) return [`Chiết khấu thanh toán ${String(details.paymentDiscountPercent)}% · giảm ${money(Number(details.paymentDiscountAmount) || 0)}`, details.paymentDiscountNote ? `Ghi chú: ${String(details.paymentDiscountNote)}` : ""].filter(Boolean).join(" · ");
  if (event.eventType === "payment_failed") return String(details.reason || "Thanh toán không thành công");
  return "";
}

function messageOf(error: any) {
  return error?.response?.data?.error || error?.response?.message || error?.message || "Không thể tải lịch sử";
}

export default function AdminBillHistoryPage() {
  const { user, storeName } = useAuth();
  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "staff";
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [tab, setTab] = useState<"payment" | "action">("payment");
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<TableBillHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const load = async (nextPage = 1) => {
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const result = await tableBillHistoryService.list({ category: tab, search: search.trim(), page: nextPage });
      setEvents((current) => nextPage === 1 ? result.items : [...current, ...result.items]);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (error) {
      openSnackbar({ text: messageOf(error), type: "error", position: "top" });
    } finally {
      if (nextPage === 1) setLoading(false);
      else setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!isAdmin && !isStaff) {
      navigate("/", { replace: true });
      return;
    }
    void load();
  }, [user?.role, tab]);

  const grouped = useMemo(() => events.reduce<Record<string, TableBillHistoryEvent[]>>((result, event) => {
    const key = new Date(event.happenedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    (result[key] ||= []).push(event);
    return result;
  }, {}), [events]);

  if (!isAdmin && !isStaff) return null;

  const print = async (billId: string) => {
    const popup = window.open("", "_blank");
    if (!popup) { openSnackbar({ text: "Trình duyệt chặn cửa sổ in", type: "error", position: "top" }); return; }
    try {
      const result = await tableBillingService.recordPrint(billId);
      if (!openBillPrint(result.bill, storeName, popup)) throw new Error("Trình duyệt chặn cửa sổ in");
      openSnackbar({ text: result.reprinted ? "Đã mở bản in lại" : "Đã mở bản in", type: "success", position: "top" });
    } catch (error) { popup.close(); openSnackbar({ text: messageOf(error), type: "error", position: "top" }); }
  };

  return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+28px)]">
    <StoreHeader />
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4">
      <header className="flex items-center gap-3">
        <button aria-label="Quay lại sơ đồ bàn" title="Quay lại" onClick={() => navigate("/")} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm"><Icon icon="zi-arrow-left" /></button>
        <div className="min-w-0 flex-1"><Text.Title size="small" className="text-slate-900">Lịch sử bill</Text.Title></div>
      </header>
      <div className={`grid ${isStaff ? "grid-cols-1" : "grid-cols-2"} rounded-lg border border-slate-200 bg-white p-1`}>
        <button role="tab" aria-selected={tab === "payment"} onClick={() => setTab("payment")} className={`min-h-11 rounded-md text-sm font-semibold ${tab === "payment" ? "bg-emerald-700 text-white" : "text-slate-600"}`}>Thanh toán</button>
        {isAdmin && <button role="tab" aria-selected={tab === "action"} onClick={() => setTab("action")} className={`min-h-11 rounded-md text-sm font-semibold ${tab === "action" ? "bg-emerald-700 text-white" : "text-slate-600"}`}>Thao tác</button>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void load(1); }} className="flex gap-2">
        <label className="sr-only" htmlFor="bill-history-search">Tìm lịch sử</label>
        <input id="bill-history-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Tìm theo bàn, ${tab === "payment" ? "người thanh toán" : "người thao tác"}...`} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400" />
        <button type="submit" aria-label="Tìm kiếm" title="Tìm kiếm" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white"><Icon icon="zi-search" /></button>
      </form>
      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : events.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">Chưa có lịch sử {tab === "payment" ? "thanh toán" : "thao tác"}.</div> : <div className="space-y-5">
        {Object.entries(grouped).map(([date, dayEvents]) => <section key={date} className="space-y-2"><Text size="small" className="font-semibold text-slate-600">{date}</Text><div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{dayEvents.map((event) => <article key={event.id} className="flex gap-3 px-3 py-3">
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${event.category === "payment" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}><Icon icon={event.category === "payment" ? "zi-list-1" : "zi-edit"} /></div>
          <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><Text size="small" className="font-semibold text-slate-900">{event.title}</Text>{event.amount > 0 && <Text size="small" className="shrink-0 font-semibold text-rose-700">{money(event.amount)}</Text>}</div><Text size="xSmall" className="mt-1 block text-slate-500">{event.tableName} · {dateTime(event.happenedAt)}</Text><Text size="xSmall" className="mt-1 block text-slate-600">{event.actorName}{event.actorRole ? ` · ${roleLabel[event.actorRole] || event.actorRole}` : ""}{event.paymentMethod ? ` · ${methodLabel[event.paymentMethod] || event.paymentMethod}` : ""}</Text>{eventSummary(event) && <Text size="xSmall" className="mt-1 block break-words whitespace-pre-wrap text-slate-500">{eventSummary(event)}</Text>}</div>
          <div className="flex shrink-0 gap-1">{event.eventType === "payment_completed" && <button aria-label={`In bill ${event.tableName}`} title="In bill" onClick={() => void print(event.billId)} className="flex h-9 w-9 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50"><Icon icon="zi-print" /></button>}<button aria-label={`Mở bill ${event.tableName}`} title="Mở bill" onClick={() => navigate(`/bills/${event.billId}`)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Icon icon="zi-arrow-right" /></button></div>
        </article>)}</div></section>)}
        {hasMore && <button disabled={loadingMore} onClick={() => void load(page + 1)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:opacity-50">{loadingMore ? <Spinner /> : <Icon icon="zi-chevron-down" />}Xem thêm</button>}
      </div>}
    </main>
  </Page>;
}
