import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { xuService } from "@/api/services";
import type { XuRedemption, XuReferralSummary, XuReward, XuSummary, XuTransaction } from "@/api/pocketbase";
import { formatVietnamDateTime } from "@/utils/format";
import PinnedPageHeader from "@/components/pinned-page-header";

const xu = (value: number) => `${value.toLocaleString("vi-VN")} Xu`;
const dateTime = (value: string) => formatVietnamDateTime(value, { dateStyle: "short", timeStyle: "short" });
const messageFrom = (error: any) => error?.response?.message || error?.message || "Không thể hoàn tất yêu cầu. Vui lòng thử lại.";
const makeKey = () => globalThis.crypto?.randomUUID?.() || `xu-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const redemptionStatus: Record<XuRedemption["status"], string> = {
  pending: "Đang chờ cửa hàng",
  approved: "Đã duyệt",
  rejected: "Đã từ chối, Xu đã hoàn",
  fulfilled: "Đã nhận quà",
};

export default function XuPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const openSnackbarRef = useRef(openSnackbar);
  openSnackbarRef.current = openSnackbar;
  const [summary, setSummary] = useState<(XuSummary & { checkedInToday?: boolean; weeklyCheckinCount?: number }) | null>(null);
  const [transactions, setTransactions] = useState<XuTransaction[]>([]);
  const [referral, setReferral] = useState<XuReferralSummary | null>(null);
  const [rewards, setRewards] = useState<XuReward[]>([]);
  const [redemptions, setRedemptions] = useState<XuRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [selectedReward, setSelectedReward] = useState<XuReward | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    const [mine, history, referralInfo, catalog, requests] = await Promise.all([
      xuService.getMine(),
      xuService.getTransactions(),
      xuService.getReferral(),
      xuService.listRewards(),
      xuService.listRedemptions(),
    ]);
    setSummary(mine);
    setTransactions(history.items);
    setReferral(referralInfo);
    setRewards(catalog);
    setRedemptions(requests);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
      return;
    }
    load().catch((error) => openSnackbarRef.current({ text: messageFrom(error), type: "error", position: "top" })).finally(() => setLoading(false));
  }, [authLoading, isAuthenticated, load, navigate]);

  const checkin = async () => {
    setCheckingIn(true);
    try {
      const result = await xuService.checkin();
      openSnackbar({
        text: result.alreadyCheckedIn
          ? "Bạn đã điểm danh hôm nay rồi"
          : `Điểm danh thành công${result.dailyReward ? `, nhận ${xu(result.dailyReward)}` : ""}${result.weeklyReward ? ` và ${xu(result.weeklyReward)} thưởng tuần` : ""}`,
        type: "success",
        position: "top",
      });
      await load();
    } catch (error) {
      openSnackbar({ text: messageFrom(error), type: "error", position: "top" });
    } finally {
      setCheckingIn(false);
    }
  };

  const copyReferral = async () => {
    if (!referral?.code) return;
    try {
      await navigator.clipboard.writeText(referral.code);
      openSnackbar({ text: "Đã sao chép mã giới thiệu", type: "success", position: "top" });
    } catch {
      openSnackbar({ text: `Mã giới thiệu: ${referral.code}`, type: "info", position: "top" });
    }
  };

  const redeem = async () => {
    if (!selectedReward) return;
    setRedeeming(true);
    try {
      await xuService.redeem(selectedReward.id, makeKey());
      setSelectedReward(null);
      await load();
      openSnackbar({ text: "Đã gửi yêu cầu đổi quà đến cửa hàng", type: "success", position: "top" });
    } catch (error) {
      openSnackbar({ text: messageFrom(error), type: "error", position: "top" });
    } finally {
      setRedeeming(false);
    }
  };

  if (authLoading || loading) return <Page className="flex min-h-screen items-center justify-center bg-slate-50"><Spinner /></Page>;
  if (!summary) return <Page className="min-h-screen bg-slate-50" />;

  return (
    <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+92px)] dark:bg-black">
      <PinnedPageHeader className="flex items-center gap-3 border-b bg-white px-4 pb-3 pt-12 dark:border-white/10 dark:bg-black">
        <button aria-label="Quay lại tài khoản" onClick={() => navigate("/account")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-white/10"><Icon icon="zi-arrow-left" /></button>
        <Text.Title size="small">Xu thưởng</Text.Title>
      </PinnedPageHeader>

      <main className="space-y-5 px-4 py-4">
        <section className="rounded-lg bg-white p-4 shadow-sm dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Text size="small" className="text-slate-500">Số dư hiện có</Text>
              <Text.Title size="large" className="mt-1 text-amber-600">{xu(summary.balance)}</Text.Title>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Icon icon="zi-star-solid" size={20} /></span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <Text size="small" className="font-semibold">Điểm danh hôm nay</Text>
              <Text size="xSmall" className="mt-1 block text-slate-500">Tuần này: {summary.weeklyCheckinCount || 0}/7 ngày</Text>
            </div>
            <button type="button" onClick={checkin} disabled={checkingIn || summary.checkedInToday} className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-semibold text-white disabled:bg-slate-300 disabled:text-slate-600">
              <Icon icon={summary.checkedInToday ? "zi-check-circle-solid" : "zi-calendar"} size={16} />
              {checkingIn ? "Đang gửi" : summary.checkedInToday ? "Đã điểm danh" : "Điểm danh"}
            </button>
          </div>
          <Text size="xxSmall" className="mt-3 block text-slate-500">Đủ 7 ngày trong tuần sẽ nhận thêm thưởng tuần theo cài đặt cửa hàng.</Text>
        </section>

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Text.Title size="small">Mã giới thiệu</Text.Title>
              <Text size="xSmall" className="mt-1 block text-slate-600 dark:text-slate-300">Được tính thưởng khi bạn bè đăng ký cùng cửa hàng và được duyệt.</Text>
            </div>
            <button aria-label="Sao chép mã giới thiệu" title="Sao chép mã giới thiệu" onClick={copyReferral} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 shadow-sm dark:bg-zinc-900"><Icon icon="zi-copy" /></button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="min-w-0 flex-1 rounded-lg border border-dashed border-amber-400 bg-white px-3 py-2 text-center font-mono text-lg font-bold tracking-[0.12em] text-amber-800 dark:bg-black dark:text-amber-300">{referral?.code || "Đang tạo mã"}</span>
            <div className="shrink-0 text-right">
              <Text size="small" className="font-semibold">{referral?.approvedCount || 0} lượt duyệt</Text>
              <Text size="xxSmall" className="mt-1 block text-slate-500">{referral?.pendingCount || 0} đang chờ</Text>
            </div>
          </div>
          <Text size="xxSmall" className="mt-3 block text-slate-500">Mốc thưởng một lần: 5 và 10 lượt giới thiệu được duyệt.</Text>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between"><Text.Title size="small">Đổi quà</Text.Title><Text size="xSmall" className="text-slate-500">{rewards.length} lựa chọn</Text></div>
          {rewards.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-white px-4 py-6 text-center dark:bg-zinc-900"><Text size="small" className="text-slate-500">Cửa hàng chưa có quà đổi Xu.</Text></div>
          ) : (
            <div className="space-y-2">
              {rewards.map((reward) => (
                <article key={reward.id} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm dark:bg-zinc-900">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950"><Icon icon="zi-gift" size={19} /></span>
                  <div className="min-w-0 flex-1">
                    <Text size="small" className="font-semibold">{reward.name}</Text>
                    {reward.description && <Text size="xSmall" className="mt-1 block text-slate-500">{reward.description}</Text>}
                    <Text size="xSmall" className="mt-1 block text-amber-700">{xu(reward.cost)} · Còn {reward.stock}</Text>
                  </div>
                  <button type="button" onClick={() => setSelectedReward(reward)} disabled={reward.stock <= 0 || summary.balance < reward.cost} className="h-9 shrink-0 rounded-lg bg-green-600 px-3 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">Đổi</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <Text.Title size="small" className="mb-3">Yêu cầu đổi quà</Text.Title>
          {redemptions.length === 0 ? <div className="rounded-lg bg-white px-4 py-5 text-center dark:bg-zinc-900"><Text size="small" className="text-slate-500">Chưa có yêu cầu đổi quà.</Text></div> : (
            <div className="space-y-2">
              {redemptions.map((item) => <article key={item.id} className="rounded-lg bg-white p-3 dark:bg-zinc-900"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Text size="small" className="font-semibold">{item.rewardName}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{dateTime(item.created)}</Text></div><Text size="xSmall" className="shrink-0 text-amber-700">−{xu(item.cost)}</Text></div><Text size="xSmall" className={`mt-2 block ${item.status === "rejected" ? "text-red-600" : item.status === "fulfilled" ? "text-green-700" : "text-slate-600"}`}>{redemptionStatus[item.status]}</Text>{item.note && <Text size="xxSmall" className="mt-1 block text-slate-500">{item.note}</Text>}</article>)}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between"><Text.Title size="small">Lịch sử Xu</Text.Title><Text size="xSmall" className="text-slate-500">{transactions.length} giao dịch</Text></div>
          {transactions.length === 0 ? <div className="rounded-lg bg-white px-4 py-5 text-center dark:bg-zinc-900"><Text size="small" className="text-slate-500">Giao dịch Xu sẽ xuất hiện tại đây.</Text></div> : (
            <div className="divide-y rounded-lg bg-white px-3 dark:divide-white/10 dark:bg-zinc-900">
              {transactions.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><Text size="small" className="font-medium">{item.reason}</Text><Text size="xxSmall" className="mt-1 block text-slate-500">{dateTime(item.created)}</Text></div><Text size="small" className={`shrink-0 font-semibold ${item.direction === "credit" ? "text-green-700" : "text-red-600"}`}>{item.direction === "credit" ? "+" : "−"}{xu(item.amount)}</Text></div>)}
            </div>
          )}
        </section>
      </main>

      <Sheet visible={!!selectedReward} onClose={() => !redeeming && setSelectedReward(null)} autoHeight>
        <Box className="space-y-3 px-4 pb-8 pt-4">
          <div className="flex items-start justify-between gap-3"><div><Text.Title size="small">Xác nhận đổi quà</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Yêu cầu sẽ được cửa hàng xác nhận.</Text></div><button aria-label="Đóng" onClick={() => setSelectedReward(null)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
          {selectedReward && <div className="rounded-lg bg-slate-50 p-3"><Text size="small" className="font-semibold">{selectedReward.name}</Text><Text size="small" className="mt-1 block text-amber-700">{xu(selectedReward.cost)}</Text><Text size="xSmall" className="mt-2 block text-slate-500">Số dư sau đổi: {xu(summary.balance - selectedReward.cost)}</Text></div>}
          <button type="button" disabled={redeeming || !selectedReward} onClick={redeem} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-green-600 font-semibold text-white disabled:opacity-50"><Icon icon="zi-gift" />{redeeming ? "Đang gửi yêu cầu" : "Gửi yêu cầu đổi"}</button>
        </Box>
      </Sheet>
    </Page>
  );
}
