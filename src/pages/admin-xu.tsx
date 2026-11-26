import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { xuService } from "@/api/services";
import type { XuAdminUser, XuRedemption, XuReward, XuSettings } from "@/api/pocketbase";
import { formatVietnamDateTime } from "@/utils/format";
import PinnedPageHeader from "@/components/pinned-page-header";

type AdminTab = "settings" | "users" | "rewards" | "redemptions";
const xu = (value: number) => `${value.toLocaleString("vi-VN")} Xu`;
const messageFrom = (error: any) => error?.response?.message || error?.message || "Không thể hoàn tất thao tác. Vui lòng thử lại.";
const makeKey = () => globalThis.crypto?.randomUUID?.() || `admin-xu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const digitsOnly = (value: string) => value.replace(/\D/g, "");
const rewardStatus: Record<XuRedemption["status"], string> = { pending: "Đang chờ", approved: "Đã duyệt", rejected: "Đã từ chối", fulfilled: "Đã nhận quà" };
type XuSettingKey = Exclude<keyof XuSettings, "store">;

const blankReward = { name: "", description: "", cost: "", stock: "", active: true };

export default function AdminXuPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const openSnackbarRef = useRef(openSnackbar);
  openSnackbarRef.current = openSnackbar;
  const [tab, setTab] = useState<AdminTab>("settings");
  const [settings, setSettings] = useState<XuSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Partial<Record<XuSettingKey, string>>>({});
  const [users, setUsers] = useState<XuAdminUser[]>([]);
  const [rewards, setRewards] = useState<XuReward[]>([]);
  const [redemptions, setRedemptions] = useState<(XuRedemption & { username: string })[]>([]);
  const [search, setSearch] = useState("");
  const [redemptionFilter, setRedemptionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adjustingUser, setAdjustingUser] = useState<XuAdminUser | null>(null);
  const [adjustForm, setAdjustForm] = useState({ direction: "credit" as "credit" | "debit", amount: "", reason: "" });
  const [rewardSheet, setRewardSheet] = useState(false);
  const [editingReward, setEditingReward] = useState<XuReward | null>(null);
  const [rewardForm, setRewardForm] = useState(blankReward);

  const loadSettings = useCallback(async () => setSettings(await xuService.getAdminSettings()), []);
  const loadUsers = useCallback(async (query = search) => setUsers(await xuService.listAdminUsers(query)), [search]);
  const loadRewards = useCallback(async () => setRewards(await xuService.listAdminRewards()), []);
  const loadRedemptions = useCallback(async (status = redemptionFilter) => setRedemptions(await xuService.listAdminRedemptions(status)), [redemptionFilter]);
  const loadAll = useCallback(async () => {
    const [settingsResult, usersResult, rewardsResult, requestsResult] = await Promise.all([
      xuService.getAdminSettings(), xuService.listAdminUsers(), xuService.listAdminRewards(), xuService.listAdminRedemptions(),
    ]);
    setSettings(settingsResult);
    setUsers(usersResult);
    setRewards(rewardsResult);
    setRedemptions(requestsResult);
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") return;
    loadAll().catch((error) => openSnackbarRef.current({ text: messageFrom(error), type: "error", position: "top" })).finally(() => setLoading(false));
  }, [user?.id, user?.role, loadAll]);

  if (user?.role !== "admin") {
    navigate("/account", { replace: true });
    return null;
  }

  const saveSettings = async () => {
    if (!settings) return;
    const valueFor = (key: XuSettingKey) => settingsDraft[key] ?? String(settings[key]);
    const values = ["dailyCheckinReward", "weeklyCheckinReward", "referralReward", "referral5Reward", "referral10Reward"] as XuSettingKey[];
    if (values.some((key) => valueFor(key) === "" || !Number.isSafeInteger(Number(valueFor(key))) || Number(valueFor(key)) < 0)) {
      openSnackbar({ text: "Nhập mức thưởng là số nguyên không âm", type: "warning", position: "top" });
      return;
    }
    setSaving(true);
    try {
      const saved = await xuService.updateAdminSettings({
        dailyCheckinReward: Number(valueFor("dailyCheckinReward")),
        weeklyCheckinReward: Number(valueFor("weeklyCheckinReward")),
        referralReward: Number(valueFor("referralReward")),
        referral5Reward: Number(valueFor("referral5Reward")),
        referral10Reward: Number(valueFor("referral10Reward")),
      });
      setSettings(saved);
      setSettingsDraft({});
      openSnackbar({ text: "Đã lưu cấu hình Xu", type: "success", position: "top" });
    } catch (error) {
      openSnackbar({ text: messageFrom(error), type: "error", position: "top" });
    } finally { setSaving(false); }
  };

  const openAdjust = (target: XuAdminUser) => {
    setAdjustingUser(target);
    setAdjustForm({ direction: "credit", amount: "", reason: "" });
  };

  const adjustBalance = async () => {
    if (!adjustingUser || !adjustForm.amount || !adjustForm.reason.trim()) {
      openSnackbar({ text: "Nhập số Xu và lý do điều chỉnh", type: "warning", position: "top" });
      return;
    }
    const amount = Number(adjustForm.amount);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      openSnackbar({ text: "Số Xu phải là số nguyên lớn hơn 0", type: "warning", position: "top" });
      return;
    }
    setSaving(true);
    try {
      await xuService.adjust({ userId: adjustingUser.id, direction: adjustForm.direction, amount, reason: adjustForm.reason.trim(), idempotencyKey: makeKey() });
      setAdjustingUser(null);
      await loadUsers(search);
      openSnackbar({ text: "Đã điều chỉnh số dư Xu", type: "success", position: "top" });
    } catch (error) {
      openSnackbar({ text: messageFrom(error), type: "error", position: "top" });
    } finally { setSaving(false); }
  };

  const openCreateReward = () => {
    setEditingReward(null);
    setRewardForm(blankReward);
    setRewardSheet(true);
  };

  const openEditReward = (reward: XuReward) => {
    setEditingReward(reward);
    setRewardForm({ name: reward.name, description: reward.description, cost: String(reward.cost), stock: String(reward.stock), active: reward.active });
    setRewardSheet(true);
  };

  const saveReward = async () => {
    if (!rewardForm.name.trim() || !rewardForm.cost || rewardForm.stock === "") {
      openSnackbar({ text: "Nhập tên, giá Xu và tồn kho", type: "warning", position: "top" });
      return;
    }
    const cost = Number(rewardForm.cost);
    const stock = Number(rewardForm.stock);
    if (!Number.isSafeInteger(cost) || cost < 1 || !Number.isSafeInteger(stock) || stock < 0) {
      openSnackbar({ text: "Giá Xu phải lớn hơn 0 và tồn kho không âm", type: "warning", position: "top" });
      return;
    }
    setSaving(true);
    try {
      const input = { name: rewardForm.name.trim(), description: rewardForm.description.trim(), cost, stock, active: rewardForm.active };
      if (editingReward) await xuService.updateReward(editingReward.id, input);
      else await xuService.createReward(input);
      setRewardSheet(false);
      await loadRewards();
      openSnackbar({ text: editingReward ? "Đã cập nhật quà" : "Đã thêm quà", type: "success", position: "top" });
    } catch (error) {
      openSnackbar({ text: messageFrom(error), type: "error", position: "top" });
    } finally { setSaving(false); }
  };

  const deactivateReward = async (reward: XuReward) => {
    if (!window.confirm(`Ngừng hiển thị quà “${reward.name}”?`)) return;
    try {
      await xuService.deactivateReward(reward.id);
      await loadRewards();
      openSnackbar({ text: "Đã ngừng quà tặng", type: "success", position: "top" });
    } catch (error) { openSnackbar({ text: messageFrom(error), type: "error", position: "top" }); }
  };

  const updateRedemption = async (item: XuRedemption, status: "approved" | "rejected" | "fulfilled") => {
    if (status === "rejected" && !window.confirm(`Từ chối yêu cầu của ${item.username} và hoàn ${xu(item.cost)}?`)) return;
    setSaving(true);
    try {
      await xuService.updateRedemption(item.id, status);
      await loadRedemptions(redemptionFilter);
      openSnackbar({ text: status === "rejected" ? "Đã từ chối và hoàn Xu, tồn kho" : status === "fulfilled" ? "Đã xác nhận khách nhận quà" : "Đã duyệt yêu cầu", type: "success", position: "top" });
    } catch (error) {
      openSnackbar({ text: messageFrom(error), type: "error", position: "top" });
    } finally { setSaving(false); }
  };

  if (loading) return <Page className="flex min-h-screen items-center justify-center bg-slate-50"><Spinner /></Page>;

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "settings", label: "Thưởng" }, { key: "users", label: "Thành viên" }, { key: "rewards", label: "Quà tặng" }, { key: "redemptions", label: "Đổi quà" },
  ];

  return (
    <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+92px)] dark:bg-black">
      <PinnedPageHeader className="flex items-center gap-3 border-b bg-white px-4 pb-3 pt-12 dark:border-white/10 dark:bg-black">
        <button aria-label="Quay lại tài khoản" onClick={() => navigate("/account")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-white/10"><Icon icon="zi-arrow-left" /></button>
        <Text.Title size="small">Quản lý Xu</Text.Title>
      </PinnedPageHeader>
      <div className="h-11 shrink-0">
        <nav className="fixed inset-x-0 top-[92px] z-[29] grid grid-cols-4 border-b bg-white dark:border-white/10 dark:bg-black">
        {tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`min-h-11 border-b-2 px-1 text-xs font-semibold ${tab === item.key ? "border-green-600 text-green-700" : "border-transparent text-slate-500"}`}>{item.label}</button>)}
        </nav>
      </div>

      <main className="space-y-4 px-4 py-4">
        {tab === "settings" && settings && <section className="space-y-4 rounded-lg bg-white p-4 shadow-sm dark:bg-zinc-900">
          <div><Text.Title size="small">Cấu hình mức thưởng</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Mức 0 sẽ tắt loại thưởng đó. Xu không quy đổi thành tiền.</Text></div>
          {([
            ["dailyCheckinReward", "Điểm danh mỗi ngày"],
            ["weeklyCheckinReward", "Thưởng đủ 7 ngày trong tuần"],
            ["referralReward", "Mỗi lượt giới thiệu được duyệt"],
            ["referral5Reward", "Mốc 5 lượt được duyệt"],
            ["referral10Reward", "Mốc 10 lượt được duyệt"],
          ] as const).map(([key, label]) => <label key={key} className="block"><span className="mb-1 block text-sm font-medium">{label}</span><div className="relative"><input type="text" inputMode="numeric" pattern="[0-9]*" value={settingsDraft[key] ?? settings[key]} onChange={(e) => setSettingsDraft((draft) => ({ ...draft, [key]: digitsOnly(e.target.value) }))} className="h-11 w-full rounded-lg border bg-white px-3 pr-12 dark:bg-black" /><span className="absolute right-3 top-3 text-sm text-slate-500">Xu</span></div></label>)}
          <button type="button" disabled={saving} onClick={saveSettings} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-green-600 font-semibold text-white disabled:opacity-50"><Icon icon="zi-check" />{saving ? "Đang lưu" : "Lưu cấu hình"}</button>
        </section>}

        {tab === "users" && <section className="space-y-3">
          <div><Text.Title size="small">Số dư theo thành viên</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Chỉ hiển thị tài khoản thuộc cửa hàng của bạn.</Text></div>
          <form onSubmit={(e) => { e.preventDefault(); loadUsers(search).catch((error) => openSnackbar({ text: messageFrom(error), type: "error", position: "top" })); }} className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, tài khoản, số điện thoại" className="h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 text-sm dark:bg-zinc-900" />
            <button type="submit" aria-label="Tìm thành viên" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-green-600 text-white"><Icon icon="zi-search" /></button>
          </form>
          {users.length === 0 ? <div className="rounded-lg bg-white p-5 text-center dark:bg-zinc-900"><Text size="small" className="text-slate-500">Không tìm thấy thành viên.</Text></div> : users.map((item) => <article key={item.id} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm dark:bg-zinc-900"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 font-semibold text-amber-700">{(item.fullname || item.username).charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><Text size="small" className="truncate font-semibold">{item.fullname || item.username}</Text><Text size="xSmall" className="mt-1 block truncate text-slate-500">@{item.username} · {item.approvedReferrals} lượt giới thiệu</Text><Text size="xSmall" className="mt-1 block font-semibold text-amber-700">{xu(item.balance)}</Text></div><button type="button" onClick={() => openAdjust(item)} title="Điều chỉnh Xu" aria-label={`Điều chỉnh Xu cho ${item.username}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-green-200 text-green-700"><Icon icon="zi-edit" /></button></article>)}
        </section>}

        {tab === "rewards" && <section className="space-y-3">
          <div className="flex items-center justify-between gap-3"><div><Text.Title size="small">Danh mục quà</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Tồn kho được giữ khi yêu cầu bị từ chối.</Text></div><button type="button" onClick={openCreateReward} aria-label="Thêm quà" title="Thêm quà" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-600 text-white"><Icon icon="zi-plus" /></button></div>
          {rewards.length === 0 ? <div className="rounded-lg bg-white p-5 text-center dark:bg-zinc-900"><Text size="small" className="text-slate-500">Chưa có quà trong danh mục.</Text></div> : rewards.map((item) => <article key={item.id} className="rounded-lg bg-white p-3 shadow-sm dark:bg-zinc-900"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Text size="small" className="font-semibold">{item.name}</Text>{item.description && <Text size="xSmall" className="mt-1 block text-slate-500">{item.description}</Text>}<Text size="xSmall" className="mt-2 block text-amber-700">{xu(item.cost)} · Tồn kho {item.stock} · {item.active ? "Đang bán" : "Đã ẩn"}</Text></div><button type="button" onClick={() => openEditReward(item)} aria-label={`Sửa ${item.name}`} title="Sửa quà" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"><Icon icon="zi-edit" /></button></div>{item.active && <button type="button" onClick={() => deactivateReward(item)} className="mt-3 text-xs font-semibold text-red-600">Ngừng hiển thị</button>}</article>)}
        </section>}

        {tab === "redemptions" && <section className="space-y-3">
          <div><Text.Title size="small">Yêu cầu đổi quà</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Từ chối yêu cầu đang chờ sẽ hoàn Xu và trả lại tồn kho.</Text></div>
          <select value={redemptionFilter} onChange={(e) => { setRedemptionFilter(e.target.value); loadRedemptions(e.target.value).catch((error) => openSnackbar({ text: messageFrom(error), type: "error", position: "top" })); }} className="h-11 w-full rounded-lg border bg-white px-3 text-sm dark:bg-zinc-900"><option value="">Tất cả trạng thái</option><option value="pending">Đang chờ</option><option value="approved">Đã duyệt</option><option value="rejected">Đã từ chối</option><option value="fulfilled">Đã nhận quà</option></select>
          {redemptions.length === 0 ? <div className="rounded-lg bg-white p-5 text-center dark:bg-zinc-900"><Text size="small" className="text-slate-500">Không có yêu cầu đổi quà.</Text></div> : redemptions.map((item) => <article key={item.id} className="space-y-3 rounded-lg bg-white p-3 shadow-sm dark:bg-zinc-900"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Text size="small" className="font-semibold">{item.rewardName}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{item.fullname || item.username} · @{item.username}</Text><Text size="xxSmall" className="mt-1 block text-slate-500">{formatVietnamDateTime(item.created)}</Text></div><div className="shrink-0 text-right"><Text size="small" className="font-semibold text-amber-700">{xu(item.cost)}</Text><Text size="xxSmall" className="mt-1 block text-slate-500">{rewardStatus[item.status]}</Text></div></div>
            {item.status === "pending" && <div className="grid grid-cols-2 gap-2"><button type="button" disabled={saving} onClick={() => updateRedemption(item, "approved")} className="h-10 rounded-lg bg-green-600 text-sm font-semibold text-white disabled:opacity-50">Duyệt</button><button type="button" disabled={saving} onClick={() => updateRedemption(item, "rejected")} className="h-10 rounded-lg border border-red-200 text-sm font-semibold text-red-600 disabled:opacity-50">Từ chối và hoàn</button></div>}
            {item.status === "approved" && <button type="button" disabled={saving} onClick={() => updateRedemption(item, "fulfilled")} className="h-10 w-full rounded-lg border border-green-200 text-sm font-semibold text-green-700 disabled:opacity-50">Xác nhận đã giao quà</button>}
          </article>)}
        </section>}
      </main>

      <Sheet visible={!!adjustingUser} onClose={() => !saving && setAdjustingUser(null)} autoHeight>
        <Box className="space-y-3 px-4 pb-8 pt-4">
          <div className="flex items-start justify-between gap-3"><div><Text.Title size="small">Điều chỉnh Xu</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">{adjustingUser?.fullname || adjustingUser?.username} · hiện có {xu(adjustingUser?.balance || 0)}</Text></div><button aria-label="Đóng" onClick={() => setAdjustingUser(null)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
          <select value={adjustForm.direction} onChange={(e) => setAdjustForm({ ...adjustForm, direction: e.target.value as "credit" | "debit" })} className="h-11 w-full rounded-lg border px-3"><option value="credit">Cộng Xu</option><option value="debit">Trừ Xu</option></select>
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={adjustForm.amount} onChange={(e) => setAdjustForm({ ...adjustForm, amount: digitsOnly(e.target.value) })} placeholder="Số Xu" className="h-11 w-full rounded-lg border px-3" />
          <textarea value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} placeholder="Lý do bắt buộc" maxLength={500} className="min-h-20 w-full rounded-lg border px-3 py-2" />
          <button type="button" disabled={saving} onClick={adjustBalance} className="h-11 w-full rounded-lg bg-green-600 font-semibold text-white disabled:opacity-50">{saving ? "Đang xử lý" : "Xác nhận điều chỉnh"}</button>
        </Box>
      </Sheet>

      <Sheet visible={rewardSheet} onClose={() => !saving && setRewardSheet(false)} autoHeight>
        <Box className="space-y-3 px-4 pb-8 pt-4">
          <div className="flex items-center justify-between"><Text.Title size="small">{editingReward ? "Sửa quà" : "Thêm quà"}</Text.Title><button aria-label="Đóng" onClick={() => setRewardSheet(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
          <input value={rewardForm.name} onChange={(e) => setRewardForm({ ...rewardForm, name: e.target.value })} maxLength={120} placeholder="Tên quà" className="h-11 w-full rounded-lg border px-3" />
          <textarea value={rewardForm.description} onChange={(e) => setRewardForm({ ...rewardForm, description: e.target.value })} maxLength={500} placeholder="Mô tả" className="min-h-20 w-full rounded-lg border px-3 py-2" />
          <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">Giá Xu<input type="text" inputMode="numeric" pattern="[0-9]*" value={rewardForm.cost} onChange={(e) => setRewardForm({ ...rewardForm, cost: digitsOnly(e.target.value) })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm text-black" /></label><label className="text-xs text-slate-500">Tồn kho<input type="text" inputMode="numeric" pattern="[0-9]*" value={rewardForm.stock} onChange={(e) => setRewardForm({ ...rewardForm, stock: digitsOnly(e.target.value) })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm text-black" /></label></div>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={rewardForm.active} onChange={(e) => setRewardForm({ ...rewardForm, active: e.target.checked })} />Đang hiển thị trong danh mục</label>
          <button type="button" disabled={saving} onClick={saveReward} className="h-11 w-full rounded-lg bg-green-600 font-semibold text-white disabled:opacity-50">{saving ? "Đang lưu" : "Lưu quà"}</button>
        </Box>
      </Sheet>
    </Page>
  );
}
