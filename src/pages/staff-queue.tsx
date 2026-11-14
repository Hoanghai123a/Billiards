import { useEffect, useState } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { Navigate, useNavigate } from "react-router-dom";

import { tableBillingService } from "@/api/services";
import type { StaffQueueItem } from "@/api/pocketbase";
import StoreHeader from "@/components/store-header";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffQueue } from "@/contexts/StaffQueueContext";
import { formatVietnamDateTime } from "@/utils/format";

const messageOf = (error: any) => error?.response?.data?.error || error?.response?.message || error?.message || "Không thể cập nhật hàng chờ";
const dateTime = (value: string) => value ? formatVietnamDateTime(value) : "";

export default function StaffQueuePage() {
  const { user } = useAuth();
  const { revision, historyUnread, markHistoryRead } = useStaffQueue();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [view, setView] = useState<"requests" | "queue" | "history">("queue");
  const [items, setItems] = useState<StaffQueueItem[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [cancelItem, setCancelItem] = useState<StaffQueueItem | null>(null);
  const canUse = user?.role === "admin" || user?.role === "staff";

  const load = async () => {
    setLoading(true);
    try {
      const [current, requests] = await Promise.all([
        view === "requests" ? tableBillingService.getOrderRequests() : tableBillingService.getQueue(view === "history"),
        view === "requests" ? Promise.resolve(null) : tableBillingService.getOrderRequests(),
      ]);
      setItems(current.items);
      setRequestCount(requests?.items.length ?? current.items.length);
    }
    catch (error) { openSnackbar({ text: messageOf(error), type: "error", position: "top" }); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (canUse) void load(); }, [canUse, view, revision, user?.id, user?.store]);

  if (!canUse) return <Navigate to="/" replace />;

  const complete = async (item: StaffQueueItem) => {
    setBusyId(item.id);
    try {
      await tableBillingService.updateQueue(item.billId, item.id, "queue_done");
      setItems((current) => current.filter((line) => line.id !== item.id));
      openSnackbar({ text: "Đã đánh dấu món hoàn thành", type: "success", position: "top" });
    } catch (error) { openSnackbar({ text: messageOf(error), type: "error", position: "top" }); void load(); }
    finally { setBusyId(""); }
  };

  const cancel = async () => {
    if (!cancelItem) return;
    setBusyId(cancelItem.id);
    try {
      await tableBillingService.updateQueue(cancelItem.billId, cancelItem.id, "queue_cancel");
      setItems((current) => current.filter((line) => line.id !== cancelItem.id));
      setCancelItem(null);
      openSnackbar({ text: "Đã hủy món", type: "success", position: "top" });
    } catch (error) { openSnackbar({ text: messageOf(error), type: "error", position: "top" }); void load(); }
    finally { setBusyId(""); }
  };

  const decideRequest = async (item: StaffQueueItem, approve: boolean) => {
    setBusyId(item.id);
    try {
      await tableBillingService.updateOrderRequest(item.billId, item.id, approve);
      setItems((current) => current.filter((line) => line.id !== item.id));
      openSnackbar({ text: approve ? "Đã duyệt yêu cầu món" : "Đã từ chối yêu cầu món", type: "success", position: "top" });
    } catch (error) { openSnackbar({ text: messageOf(error), type: "error", position: "top" }); void load(); }
    finally { setBusyId(""); }
  };

  return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+92px)]">
    <StoreHeader />
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-4">
      <header className="flex items-center gap-3">
        <button aria-label="Quay lại" title="Quay lại" onClick={() => navigate(-1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm"><Icon icon="zi-arrow-left" /></button>
        <Text.Title size="small" className="min-w-0 flex-1 text-slate-900">Hàng chờ</Text.Title>
      </header>
      <div role="tablist" aria-label="Danh sách món" className="grid grid-cols-3 rounded-lg border border-slate-200 bg-white p-1">
        {([["queue", "Chế biến"], ["requests", "Yêu cầu món"], ["history", "Lịch sử"]] as const).map(([key, label]) => <button key={key} role="tab" aria-label={key === "requests" && requestCount > 0 ? `${label}, ${requestCount} đơn chờ` : key === "history" && historyUnread ? `${label}, có cập nhật mới` : label} aria-selected={view === key} onClick={() => { setView(key); if (key === "history") markHistoryRead(); }} className={`relative min-h-11 rounded-md px-2 text-xs font-semibold ${view === key ? "bg-emerald-700 text-white" : "text-slate-600"}`}>
          {label}{key === "requests" && requestCount > 0 && <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-600 ring-2 ring-white" />}{key === "history" && historyUnread && <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-600 ring-2 ring-white" />}
        </button>)}
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : items.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">{view === "requests" ? "Chưa có yêu cầu món." : view === "history" ? "Chưa có lịch sử thao tác." : "Hiện chưa có món đang chờ."}</div> : <div className="space-y-3">
        {items.map((item) => <article key={item.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><Text size="small" className="break-words font-semibold text-slate-900">{item.name}</Text><Text size="xSmall" className="mt-1 block text-slate-600">{item.quantity.toLocaleString("vi-VN")} {item.unitLabel} · {item.tableName}</Text></div>
            <Text size="xSmall" className="shrink-0 text-right text-slate-500">{dateTime(view === "history" ? item.completedAt : item.queuedAt)}</Text>
          </div>
          {view === "requests" ? <><Text size="xSmall" className="block text-slate-500">Khách: {item.actorName}</Text><div className="grid grid-cols-2 gap-2"><button disabled={busyId === item.id || item.billStatus !== "open"} onClick={() => void decideRequest(item, true)} className="min-h-11 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">Duyệt</button><button disabled={busyId === item.id || item.billStatus !== "open"} onClick={() => void decideRequest(item, false)} className="min-h-11 rounded-md border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-700 disabled:opacity-50">Từ chối</button></div></> : view === "history" ? <Text size="xSmall" className="block text-slate-500">{item.actionLabel || "Đã xử lý"}{item.actorName ? ` bởi ${item.actorName}` : ""}</Text> : <div className="grid grid-cols-2 gap-2">
            <button disabled={busyId === item.id || item.billStatus !== "open"} onClick={() => void complete(item)} className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busyId === item.id ? <Spinner /> : <Icon icon="zi-check" />}Đã xong</button>
            <button disabled={busyId === item.id || item.billStatus !== "open"} onClick={() => setCancelItem(item)} className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-700 disabled:opacity-50"><Icon icon="zi-close" />Hủy</button>
          </div>}
        </article>)}
      </div>}
    </main>
    <Sheet visible={Boolean(cancelItem)} onClose={() => busyId ? undefined : setCancelItem(null)} autoHeight swipeToClose unmountOnClose>
      {cancelItem && <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div><Text.Title size="small">Xác nhận hủy món</Text.Title><Text size="small" className="mt-2 block text-slate-600">{cancelItem.name} · {cancelItem.quantity.toLocaleString("vi-VN")} {cancelItem.unitLabel} tại {cancelItem.tableName}</Text><Text size="xSmall" className="mt-2 block text-rose-700">Món sẽ không còn tính vào hóa đơn và tồn kho.</Text></div>
        <div className="grid grid-cols-2 gap-2"><button disabled={Boolean(busyId)} onClick={() => setCancelItem(null)} className="min-h-12 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">Quay lại</button><button disabled={Boolean(busyId)} onClick={() => void cancel()} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-rose-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busyId ? <Spinner /> : null}Xác nhận hủy</button></div>
      </Box>}
    </Sheet>
  </Page>;
}
