import { useEffect, useState } from "react";
import { Icon, Page, Spinner, Text, Sheet, Box, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { walletService } from "@/api/services";
import type { WalletSummary, WalletTransaction, WalletUser } from "@/api/pocketbase";
import { formatMoneyInput, handleMoneyInput } from "@/utils/format";
import { fromVietnamDateTimeInput } from "@/utils/format";
import PinnedPageHeader from "@/components/pinned-page-header";

const money = (value: number) => `${value.toLocaleString("vi-VN")}đ`;

export default function AdminWalletsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [users, setUsers] = useState<WalletUser[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WalletUser | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [history, setHistory] = useState<WalletTransaction[]>([]);
  const [sheet, setSheet] = useState(false);
  const [bulkSheet, setBulkSheet] = useState(false);
  const [bulkUserIds, setBulkUserIds] = useState<string[]>([]);
  const [form, setForm] = useState({ walletType: "main", direction: "credit", amount: "", reason: "", expiresAt: "" });
  const [bulk, setBulk] = useState({ fromDate: "", toDate: "", newExpiresAt: "" });
  const [loading, setLoading] = useState(true);

  const loadUsers = () => walletService.listUsers(query).then(setUsers).catch(() => openSnackbar({ text: "Không thể tải danh sách user", type: "error" }));
  useEffect(() => { if (user?.role !== "admin") return; loadUsers().then(() => setLoading(false)); }, [user]);
  const choose = async (item: WalletUser) => {
    setSelected(item);
    setWallet(null);
    setHistory([]);
    try {
      const [summary, transactions] = await Promise.all([walletService.getUser(item.id), walletService.getUserTransactions(item.id)]);
      setWallet(summary);
      setHistory(transactions.items);
    } catch (error: any) {
      openSnackbar({ text: error?.response?.message || error?.response?.data?.error || "Không thể tải thông tin ví của user", type: "error", position: "top" });
    }
  };
  const adjust = async () => {
    if (!selected || !form.amount || !form.reason) return openSnackbar({ text: "Vui lòng nhập đủ số tiền và lý do", type: "warning" });
    if (form.direction === "debit" && !window.confirm("Xác nhận giảm tiền user này?")) return;
    try { await walletService.adjust({ userId: selected.id, walletType: form.walletType as "main" | "promo", direction: form.direction as "credit" | "debit", amount: Number(form.amount), reason: form.reason, expiresAt: form.expiresAt ? fromVietnamDateTimeInput(form.expiresAt) : undefined, idempotencyKey: `admin-${Date.now()}` }); setSheet(false); await choose(selected); openSnackbar({ text: "Đã điều chỉnh số dư", type: "success" }); } catch (error: any) { openSnackbar({ text: error?.response?.message || "Điều chỉnh thất bại", type: "error" }); }
  };
  const updateBulk = async () => { try { const result = await walletService.updatePromoExpiry({ ...bulk, newExpiresAt: bulk.newExpiresAt ? fromVietnamDateTimeInput(bulk.newExpiresAt) : "", userIds: bulkUserIds }); setBulkSheet(false); openSnackbar({ text: `Đã đổi hạn ${result.updated} lô khuyến mại`, type: "success" }); if (selected) choose(selected); } catch (error: any) { openSnackbar({ text: error?.response?.message || "Đổi hạn thất bại", type: "error" }); } };

  if (user?.role !== "admin") { navigate("/account", { replace: true }); return null; }
  if (loading) return <Page className="flex items-center justify-center"><Spinner /></Page>;
  return <Page className="min-h-screen bg-slate-50 pb-24 dark:bg-black">
    <PinnedPageHeader className="flex items-center gap-3 border-b bg-white px-4 pb-3 pt-12 dark:border-white/10 dark:bg-black"><button type="button" aria-label="Quay lại" onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-white/10"><Icon icon="zi-arrow-left" /></button><Text.Title size="small">Quản lý ví</Text.Title></PinnedPageHeader>
    <main className="space-y-4 px-4 py-4"><div className="flex gap-2"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm username hoặc email" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-3 text-sm" /><button type="button" onClick={() => void loadUsers()} className="rounded-xl bg-green-600 px-4 text-white">Tìm</button></div><button type="button" onClick={() => setBulkSheet(true)} className="w-full rounded-xl border border-orange-300 bg-orange-50 py-3 text-sm font-semibold text-orange-700">Đổi hạn khuyến mại hàng loạt</button><div className="space-y-2">{users.map((item) => <button type="button" key={item.id} onClick={() => void choose(item)} className={`w-full rounded-xl border bg-white p-3 text-left dark:bg-zinc-900 ${selected?.id === item.id ? "border-green-500" : "border-transparent"}`}><Text size="small" className="font-semibold">{item.username}</Text><Text size="xSmall" className="text-slate-500">{item.email || "Chưa có email"}</Text></button>)}</div>{selected && wallet && <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"><div className="flex items-start justify-between"><div><Text.Title size="small">{selected.username}</Text.Title><Text size="xSmall" className="text-slate-500">Số dư cùng cửa hàng hiện tại</Text></div><button type="button" onClick={() => setSheet(true)} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white">Điều chỉnh</button></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-green-50 p-3"><Text size="xSmall">Tài khoản chính</Text><Text.Title size="small" className="text-green-700">{money(wallet.mainBalance)}</Text.Title></div><div className="rounded-xl bg-orange-50 p-3"><Text size="xSmall">Khuyến mại</Text><Text.Title size="small" className="text-orange-700">{money(wallet.promoBalance)}</Text.Title></div></div><div className="mt-4 space-y-2">{history.map((item) => <div key={item.id} className="flex justify-between border-b py-2 text-sm"><span className="truncate pr-2">{item.reason}</span><span className={item.direction === "credit" ? "text-green-600" : "text-red-500"}>{item.direction === "credit" ? "+" : "-"}{money(item.amount)}</span></div>)}</div></section>}</main>
    <Sheet visible={sheet} onClose={() => setSheet(false)} autoHeight><Box className="space-y-3 px-4 pb-8 pt-4"><Text.Title size="small">Điều chỉnh số dư</Text.Title><select value={form.walletType} onChange={(e) => setForm({ ...form, walletType: e.target.value })} className="w-full rounded-lg border p-3"><option value="main">Tài khoản chính</option><option value="promo">Khuyến mại</option></select><select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="w-full rounded-lg border p-3"><option value="credit">Tăng tiền</option><option value="debit">Giảm tiền</option></select><input type="text" inputMode="numeric" value={formatMoneyInput(form.amount)} onChange={(e) => handleMoneyInput(e, (amount) => setForm({ ...form, amount }))} placeholder="Số tiền VNĐ" className="w-full rounded-lg border p-3" />{form.walletType === "promo" && form.direction === "credit" && <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="w-full rounded-lg border p-3" />}<textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Lý do bắt buộc" className="w-full rounded-lg border p-3" /><button type="button" onClick={() => void adjust()} className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white">Xác nhận</button></Box></Sheet>
    <Sheet visible={bulkSheet} onClose={() => setBulkSheet(false)} autoHeight><Box className="space-y-3 px-4 pb-8 pt-4"><Text.Title size="small">Đổi hạn khuyến mại hàng loạt</Text.Title><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bulkUserIds.length === 0} onChange={() => setBulkUserIds([])} />Toàn bộ user trong cửa hàng</label><div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border p-2">{users.map((item) => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bulkUserIds.includes(item.id)} onChange={() => setBulkUserIds(bulkUserIds.includes(item.id) ? bulkUserIds.filter((id) => id !== item.id) : [...bulkUserIds, item.id])} />{item.username}</label>)}</div><input type="date" value={bulk.fromDate} onChange={(e) => setBulk({ ...bulk, fromDate: e.target.value })} className="w-full rounded-lg border p-3" /><input type="date" value={bulk.toDate} onChange={(e) => setBulk({ ...bulk, toDate: e.target.value })} className="w-full rounded-lg border p-3" /><input type="datetime-local" value={bulk.newExpiresAt} onChange={(e) => setBulk({ ...bulk, newExpiresAt: e.target.value })} className="w-full rounded-lg border p-3" /><button type="button" onClick={() => void updateBulk()} className="w-full rounded-xl bg-orange-600 py-3 font-semibold text-white">Cập nhật hạn dùng</button></Box></Sheet>
  </Page>;
}
