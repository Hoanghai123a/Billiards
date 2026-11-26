import { useEffect, useState } from "react";
import { Icon, Page, Sheet, Box, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import AdminNav from "@/components/admin-nav";
import StoreHeader from "@/components/store-header";
import { useAuth } from "@/contexts/AuthContext";
import { walletService } from "@/api/services";
import type { WalletTopup, WalletTopupStatus } from "@/api/pocketbase";
import { formatVietnamDateTime } from "@/utils/format";

const money = (value: number) => `${value.toLocaleString("vi-VN")}đ`;
const statusLabel: Record<WalletTopupStatus, string> = { pending: "Chờ Tingee xác nhận", paid: "Đã tự động cộng", rejected: "Đã từ chối", expired: "Chưa thanh toán" };

export default function AdminWalletTopupsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [items, setItems] = useState<WalletTopup[]>([]);
  const [status, setStatus] = useState<WalletTopupStatus | "">("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WalletTopup | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [gatewayTransactionId, setGatewayTransactionId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try { setItems((await walletService.listTopups(status, query)).items); }
    catch { if (!silent) openSnackbar({ text: "Không thể tải yêu cầu nạp tiền", type: "error" }); }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { if (user?.role === "admin") void load(); }, [user?.role, status]);

  useEffect(() => {
    if (user?.role !== "admin" || actionOpen) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refreshWhenVisible, 60000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [user?.role, status, query, actionOpen]);

  const approve = async () => {
    if (!selected) return;
    setBusy(true);
    try { await walletService.approveTopup(selected.id, { gatewayTransactionId }); setActionOpen(false); openSnackbar({ text: "Đã cộng tiền vào ví hội viên", type: "success" }); await load(); }
    catch (error: any) { openSnackbar({ text: error?.response?.message || error?.response?.data?.error || "Duyệt nạp tiền thất bại", type: "error" }); }
    finally { setBusy(false); }
  };

  const reject = async () => {
    if (!selected || !rejectReason.trim()) return openSnackbar({ text: "Vui lòng nhập lý do từ chối", type: "warning" });
    setBusy(true);
    try { await walletService.rejectTopup(selected.id, rejectReason.trim()); setActionOpen(false); openSnackbar({ text: "Đã từ chối yêu cầu nạp", type: "success" }); await load(); }
    catch (error: any) { openSnackbar({ text: error?.response?.message || error?.response?.data?.error || "Từ chối yêu cầu thất bại", type: "error" }); }
    finally { setBusy(false); }
  };

  if (user?.role !== "admin") { navigate("/account", { replace: true }); return null; }

  return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+32px)]"><StoreHeader /><AdminNav /><main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4"><header className="flex items-center gap-3"><button aria-label="Quay lại" onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white"><Icon icon="zi-arrow-left" /></button><div className="min-w-0 flex-1"><Text.Title size="small">Theo dõi nạp tiền</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Tingee tự động xác nhận và cộng tiền; duyệt tay chỉ dùng khi cần xử lý ngoại lệ.</Text></div></header><div className="flex gap-2"><select value={status} onChange={(event) => setStatus(event.target.value as WalletTopupStatus | "")} className="min-h-11 rounded-lg border bg-white px-3 text-sm"><option value="">Tất cả</option><option value="pending">Chờ Tingee xác nhận</option><option value="paid">Đã tự động cộng</option><option value="rejected">Đã từ chối</option><option value="expired">Chưa thanh toán</option></select><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="Tìm hội viên hoặc mã chuyển khoản" className="min-w-0 flex-1 rounded-lg border bg-white px-3 text-sm" /><button type="button" onClick={() => void load()} className="rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white">Tìm</button></div>{loading ? <div className="flex justify-center py-12"><Spinner /></div> : items.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Không có yêu cầu phù hợp.</div> : <div className="space-y-3">{items.map((item) => <button type="button" key={item.id} onClick={() => { setSelected(item); setGatewayTransactionId(item.gatewayTransactionId); setRejectReason(item.rejectionReason); setActionOpen(true); }} className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Text size="small" className="font-semibold">{item.fullname || item.username || "Hội viên"}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{item.username} · {formatVietnamDateTime(item.created)}</Text></div><Text size="small" className={`shrink-0 font-semibold ${item.status === "paid" ? "text-emerald-700" : item.status === "rejected" ? "text-rose-700" : "text-amber-700"}`}>{money(item.amount)}</Text></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span>Mã: <strong>{item.transferCode}</strong></span><span>{statusLabel[item.status]}</span></div>{item.proof && <Text size="xSmall" className="mt-2 block text-slate-500">Chứng từ: {item.proof}</Text>}{item.note && <Text size="xSmall" className="mt-2 block text-slate-500">Ghi chú: {item.note}</Text>}{item.rejectionReason && <Text size="xSmall" className="mt-2 block text-rose-700">Lý do: {item.rejectionReason}</Text>}</button>)}</div>}</main><Sheet visible={actionOpen} onClose={() => !busy && setActionOpen(false)} autoHeight swipeToClose unmountOnClose><Box className="max-h-[88vh] space-y-4 overflow-y-auto px-4 pb-8 pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Xử lý yêu cầu nạp</Text.Title><button aria-label="Đóng xử lý nạp" onClick={() => setActionOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>{selected && <><div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between"><span>Hội viên</span><strong>{selected.fullname || selected.username}</strong></div><div className="mt-2 flex justify-between"><span>Số tiền</span><strong>{money(selected.amount)}</strong></div><div className="mt-2 flex justify-between"><span>Nội dung chuyển khoản</span><strong>{selected.transferCode}</strong></div>{selected.proof && <div className="mt-2 text-slate-600">Chứng từ: {selected.proof}</div>}{selected.note && <div className="mt-2 text-slate-600">Ghi chú: {selected.note}</div>}</div>{selected.status === "pending" ? <><label className="block text-sm font-medium">Mã giao dịch ngân hàng (không bắt buộc)<input value={gatewayTransactionId} onChange={(event) => setGatewayTransactionId(event.target.value)} maxLength={120} className="mt-2 min-h-11 w-full rounded-lg border px-3" placeholder="Mã giao dịch trên sao kê" /></label><button type="button" disabled={busy} onClick={() => void approve()} className="min-h-12 w-full rounded-xl bg-emerald-700 font-semibold text-white disabled:opacity-60">{busy ? "Đang duyệt..." : "Duyệt thủ công và cộng tiền"}</button><label className="block text-sm font-medium">Lý do từ chối<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} className="mt-2 min-h-20 w-full rounded-lg border p-3" placeholder="Chỉ nhập khi giao dịch không hợp lệ" /></label><button type="button" disabled={busy} onClick={() => void reject()} className="min-h-12 w-full rounded-xl border border-rose-300 font-semibold text-rose-700 disabled:opacity-60">Từ chối yêu cầu</button></> : <Text size="small" className="text-slate-600">Yêu cầu này đã được xử lý.</Text>}</>}</Box></Sheet></Page>;
}
