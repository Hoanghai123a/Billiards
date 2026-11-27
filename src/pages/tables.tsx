import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { IoGridOutline, IoLayersOutline, IoQrCodeOutline, IoTimeOutline } from "react-icons/io5";

import { adminNotificationService, tableService, tableBillingService } from "@/api/services";
import pb, { type Table, type TableBillCustomer, type TableMap } from "@/api/pocketbase";
import { useAuth } from "@/contexts/AuthContext";
import { readSessionCache, writeSessionCache } from "@/utils/session-cache";
import { useStaffQueue } from "@/contexts/StaffQueueContext";
import StoreHeader from "@/components/store-header";
import { debounce } from "@/utils/debounce";
import { formatElapsedClock } from "@/utils/format";

const STATUS: Record<Table["status"], { label: string; card: string; badge: string; dot: string }> = {
  available: { label: "Trống", card: "border-slate-200 bg-white shadow-sm", badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  occupied: { label: "Đang chơi", card: "!border-rose-300 !bg-white ring-1 ring-inset ring-rose-100 shadow-[0_0_10px_rgba(251,113,133,0.18)]", badge: "bg-rose-50 text-rose-700", dot: "bg-rose-400" },
  reserved: { label: "Đã đặt", card: "!border-amber-300 !bg-white ring-1 ring-inset ring-amber-100 shadow-[0_0_10px_rgba(251,191,36,0.18)]", badge: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
};

type NumberingOrder = "row" | "column";

function messageOf(error: any, fallback: string) {
  return error?.response?.message || error?.message || fallback;
}

function isTableMap(value: unknown): value is TableMap {
  const map = value as Partial<TableMap> | null;
  return Boolean(map && Array.isArray(map.tables) && Array.isArray(map.activeBills) && map.layout && typeof map.layout === "object");
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function arrangeTables(tables: Table[], order: NumberingOrder) {
  if (order === "row") return tables;
  const rows = Math.ceil(tables.length / 2);
  return Array.from({ length: tables.length }, (_, index) => tables[(index % 2) * rows + Math.floor(index / 2)]).filter(Boolean);
}

function ElapsedClock({ startedAt, className = "" }: { startedAt: string; className?: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <span className={className}>{formatElapsedClock(startedAt)}</span>;
}

export default function TablesPage() {
  const { storeId, user } = useAuth();
  const { revision } = useStaffQueue();
  const isAdmin = user?.role === "admin";
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [tableMap, setTableMap] = useState<TableMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [floorCountDraft, setFloorCountDraft] = useState("1");
  const [tablesPerFloorDraft, setTablesPerFloorDraft] = useState<string[]>(["0"]);
  const [sortOrderDraft, setSortOrderDraft] = useState<NumberingOrder>("row");
  const [savingLayout, setSavingLayout] = useState(false);
  const [activeFloor, setActiveFloor] = useState(1);
  const [tableSearch, setTableSearch] = useState("");
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [publicQrTable, setPublicQrTable] = useState<Table | null>(null);
  const [tableNameDraft, setTableNameDraft] = useState("");
  const [editingTableName, setEditingTableName] = useState(false);
  const [tableSheetOpen, setTableSheetOpen] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [useDefaultProducts, setUseDefaultProducts] = useState(true);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customers, setCustomers] = useState<TableBillCustomer[]>([]);
  const [busy, setBusy] = useState(false);
  const seenNotificationsRef = useRef(new Set<string>());
  const openSnackbarRef = useRef(openSnackbar);
  const queueRevisionRef = useRef(revision);
  const mapRequestRef = useRef(0);

  useEffect(() => { openSnackbarRef.current = openSnackbar; }, [openSnackbar]);

  const refreshMap = async (showError = true) => {
    if (!storeId) return null;
    const requestId = ++mapRequestRef.current;
    try {
      const map = await tableService.getMap();
      if (!isTableMap(map)) throw new Error("Dữ liệu sơ đồ bàn không hợp lệ");
      if (requestId !== mapRequestRef.current) return null;
      setTableMap(map);
      setError("");
      return map;
    } catch (loadError) {
      if (showError && requestId === mapRequestRef.current && !tableMap) setError(messageOf(loadError, "Không thể tải sơ đồ bàn"));
      return null;
    }
  };

  const loadTables = async () => {
    if (!storeId) {
      setError("Tài khoản chưa được gắn với cửa hàng nào");
      setLoading(false);
      return;
    }
    try {
      setError("");
      await refreshMap();
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadTables(); }, [storeId]);
  useEffect(() => {
    if (!storeId) return;
    let active = true;
    const refresh = () => { if (active) void refreshMap(false); };
    const scheduleRefresh = debounce(refresh, 250);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const tablesSubscription = pb.collection("tables").subscribe("*", ({ record }) => { if (record.store === storeId) scheduleRefresh(); });
    const layoutsSubscription = pb.collection("table_layouts").subscribe("*", ({ record }) => { if (record.store === storeId) scheduleRefresh(); });
    const timer = window.setInterval(refreshWhenVisible, 60000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      scheduleRefresh.cancel();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void tablesSubscription.then((unsubscribe) => unsubscribe()).catch(() => {});
      void layoutsSubscription.then((unsubscribe) => unsubscribe()).catch(() => {});
    };
  }, [storeId]);
  useEffect(() => {
    if (queueRevisionRef.current === revision) return;
    queueRevisionRef.current = revision;
    if (storeId) void refreshMap(false);
  }, [revision, storeId]);
  useEffect(() => {
    if (!isAdmin || !user?.id || !storeId) return;
    let active = true;
    const loadNotifications = () => adminNotificationService.list().then((result) => {
      if (!active) return;
      const unseen = result.items.filter((item) => !seenNotificationsRef.current.has(item.id));
      if (unseen.length) {
        unseen.forEach((item) => {
          seenNotificationsRef.current.add(item.id);
          openSnackbarRef.current({ text: `${item.title}: ${item.body}`, type: "warning", position: "top" });
        });
      }
    }).catch(() => {});
    void loadNotifications();
    const subscription = pb.collection("admin_notifications").subscribe("*", ({ record }) => {
      if (record.store === storeId && record.recipient === user.id) void loadNotifications();
    });
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadNotifications(); }, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
      void subscription.then((unsubscribe) => unsubscribe()).catch(() => {});
    };
  }, [isAdmin, user?.id, storeId]);
  useEffect(() => {
    if (!settingsOpen || !tableMap) return;
    const floorCount = Math.max(1, tableMap.layout.rowCount || 1);
    setFloorCountDraft(String(floorCount));
    setTablesPerFloorDraft(Array.from({ length: floorCount }, (_, index) => String(tableMap.layout.tablesPerRow[index] || 0)));
    setSortOrderDraft(tableMap.layout.sortOrder || "row");
  }, [settingsOpen, tableMap]);
  useEffect(() => {
    if (!tableSheetOpen || !isAdmin) return;
    const key = `billiard:customers:${storeId}:v1`;
    const cached = readSessionCache<TableBillCustomer[]>(key, 5 * 60 * 1000);
    if (cached) setCustomers(cached);
    tableBillingService.getCustomers().then((result) => {
      writeSessionCache(key, result.items);
      setCustomers(result.items);
    }).catch(() => { if (!cached) setCustomers([]); });
  }, [tableSheetOpen, isAdmin, storeId]);

  const sortedTables = useMemo(() => [...(tableMap?.tables || [])].sort((a, b) => a.row_number - b.row_number || a.position - b.position || a.name.localeCompare(b.name, "vi")), [tableMap]);
  const tableNumbers = useMemo(() => new Map(sortedTables.map((table, index) => [table.id, index + 1])), [sortedTables]);
  const filteredCustomers = useMemo(() => {
    const query = normalizeSearch(customerQuery.trim());
    return query ? customers.filter((customer) => normalizeSearch(`${customer.fullname || ""} ${customer.username || ""}`).includes(query)) : customers;
  }, [customers, customerQuery]);
  const floorTables = useMemo(() => sortedTables.filter((table) => table.row_number === activeFloor), [sortedTables, activeFloor]);
  const visibleTables = useMemo(() => arrangeTables(floorTables, tableMap?.layout.sortOrder || "row"), [floorTables, tableMap?.layout.sortOrder]);
  const floorCount = Math.max(1, tableMap?.layout.rowCount || 1);
  const draftTotal = tablesPerFloorDraft.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const floorRanges = tablesPerFloorDraft.map((value, index) => {
    const start = tablesPerFloorDraft.slice(0, index).reduce((sum, item) => sum + (Number(item) || 0), 0) + 1;
    const count = Number(value) || 0;
    return count ? `Bàn ${start}–${start + count - 1}` : "Chưa có bàn";
  });

  useEffect(() => {
    if (activeFloor > floorCount) setActiveFloor(floorCount);
  }, [activeFloor, floorCount]);

  const tableLabel = (table: Table | undefined | null) => table?.name?.trim() || `Bàn ${table ? tableNumbers.get(table.id) || "" : ""}`.trim();
  const publicTableUrl = storeId ? `${window.location.origin}/public-tables?store=${encodeURIComponent(storeId)}` : "";
  const copyPublicTableUrl = async () => {
    try { await navigator.clipboard.writeText(publicTableUrl); openSnackbar({ text: "Đã sao chép link xem bill dùng chung", type: "success" }); }
    catch { openSnackbar({ text: "Không thể sao chép link trên thiết bị này", type: "error" }); }
  };
  const searchResults = useMemo(() => {
    const query = normalizeSearch(tableSearch.trim());
    if (!query) return [];
    return sortedTables.filter((table) => normalizeSearch(tableLabel(table)).includes(query));
  }, [sortedTables, tableSearch, tableNumbers]);
  const openBillFor = (tableId: string) => tableMap?.activeBills.find((bill) => bill.table === tableId);
  const openTable = async (table: Table) => {
    let bill = openBillFor(table.id);
    if (!bill && !isAdmin && table.status !== "available") {
      try {
        const latestMap = await refreshMap(false);
        if (!latestMap) throw new Error("Không thể tải sơ đồ bàn");
        bill = latestMap.activeBills.find((activeBill) => activeBill.table === table.id);
        if (!bill) {
          const result = await tableService.getActiveBill(table.id);
          if (result.billId) bill = { id: result.billId, table: table.id, customer: "", status: "open" };
        }
      } catch {
        return void openSnackbar({ text: "Không thể tải hóa đơn của bàn. Vui lòng thử lại.", type: "error" });
      }
    }
    if (bill) return void navigate(`/bills/${bill.id}`);
    if (!isAdmin && table.status !== "available") return void openSnackbar({ text: "Bàn chưa sẵn sàng để bắt đầu sử dụng", type: "warning" });
    setSelectedTable(table); setUseDefaultProducts(true); setSelectedCustomer(""); setCustomerQuery(""); setCustomerPickerOpen(false);
    if (isAdmin) { setTableNameDraft(table.name || ""); setEditingTableName(false); }
    setTableSheetOpen(true);
  };
  const changeFloorCount = (value: string) => {
    setFloorCountDraft(value);
    const count = Number(value);
    if (Number.isInteger(count) && count >= 1 && count <= 20) {
      setTablesPerFloorDraft((current) => Array.from({ length: count }, (_, index) => current[index] || "0"));
    }
  };
  const saveTableLayout = async () => {
    if (!isAdmin || !tableMap) return;
    const floors = Number(floorCountDraft);
    const counts = tablesPerFloorDraft.map(Number);
    if (!Number.isInteger(floors) || floors < 1 || floors > 20 || counts.length !== floors || counts.some((count) => !Number.isInteger(count) || count < 0 || count > 100)) {
      return void openSnackbar({ text: "Số tầng phải từ 1–20 và mỗi tầng từ 0–100 bàn", type: "warning" });
    }
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total > 500) return void openSnackbar({ text: "Tổng số bàn tối đa là 500", type: "warning" });
    if (total < tableMap.tables.length) return void openSnackbar({ text: "Không thể tự động xóa bàn. Hãy xóa từng bàn không còn sử dụng trước.", type: "warning" });
    setSavingLayout(true);
    try {
      await tableService.configureLayout({ rowCount: floors, tablesPerRow: counts, sortOrder: sortOrderDraft });
      await loadTables(); setSettingsOpen(false); setActiveFloor(1); openSnackbar({ text: "Đã cập nhật tầng và số bàn", type: "success" });
    } catch (saveError) { openSnackbar({ text: messageOf(saveError, "Không thể cập nhật bố cục bàn"), type: "error" });
    } finally { setSavingLayout(false); }
  };
  const startTable = async () => {
    if (!selectedTable) return;
    setBusy(true);
    try { const result = await tableService.start(selectedTable.id, selectedCustomer, useDefaultProducts); setTableSheetOpen(false); navigate(`/bills/${result.billId}`); }
    catch (startError) { openSnackbar({ text: messageOf(startError, "Không thể bắt đầu sử dụng bàn"), type: "error" }); await loadTables(); }
    finally { setBusy(false); }
  };
  const changeStatus = async (status: Table["status"]) => {
    if (!selectedTable) return;
    setBusy(true);
    try { await tableService.updateStatus(selectedTable.id, status); setTableSheetOpen(false); await loadTables(); openSnackbar({ text: "Đã cập nhật trạng thái bàn", type: "success" }); }
    catch (statusError) { openSnackbar({ text: messageOf(statusError, "Không thể cập nhật bàn"), type: "error" }); }
    finally { setBusy(false); }
  };
  const resetTableStatus = async () => {
    if (!selectedTable) return;
    setBusy(true);
    try { await tableService.resetStatus(selectedTable.id); setTableSheetOpen(false); await loadTables(); openSnackbar({ text: "Đã đưa bàn về trạng thái trống", type: "success" }); }
    catch (statusError) { openSnackbar({ text: messageOf(statusError, "Không thể đưa bàn về trạng thái trống"), type: "error" }); }
    finally { setBusy(false); }
  };
  const renameTable = async () => {
    if (!selectedTable) return;
    const name = tableNameDraft.trim();
    if (!name) return void openSnackbar({ text: "Tên bàn không được để trống", type: "warning" });
    setBusy(true);
    try { await tableService.rename(selectedTable.id, name); setSelectedTable((current) => current ? { ...current, name } : current); setEditingTableName(false); await loadTables(); openSnackbar({ text: "Đã đổi tên bàn", type: "success" }); }
    catch (renameError) { openSnackbar({ text: messageOf(renameError, "Không thể đổi tên bàn"), type: "error" }); }
    finally { setBusy(false); }
  };
  const deleteTable = async () => {
    if (!selectedTable || !deletePassword) return;
    setBusy(true);
    try { await tableService.delete(selectedTable.id, deletePassword); setDeleteSheetOpen(false); setTableSheetOpen(false); setDeletePassword(""); setSelectedTable(null); await loadTables(); openSnackbar({ text: "Đã xóa bàn", type: "success" }); }
    catch (deleteError) { openSnackbar({ text: messageOf(deleteError, "Không thể xóa bàn"), type: "error" }); }
    finally { setBusy(false); }
  };
  if (loading) return <Page className="min-h-screen bg-slate-50"><StoreHeader onSettings={() => setSettingsOpen(true)} /><div className="flex justify-center py-12"><Spinner /></div></Page>;
  if (error) return <Page className="min-h-screen bg-slate-50"><StoreHeader onSettings={() => setSettingsOpen(true)} /><main className="px-4 py-6"><div className="rounded-lg border border-rose-200 bg-rose-50 p-4"><Text className="text-rose-800">{error}</Text><button onClick={() => { setLoading(true); void loadTables(); }} className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white">Thử lại</button></div></main></Page>;

  return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
    <StoreHeader onSettings={() => setSettingsOpen(true)} />
    <main className="mx-auto flex min-h-[calc(100dvh-160px)] w-full max-w-5xl flex-col gap-3 px-3 py-3 sm:px-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <Text.Title size="small" className="text-slate-900">Danh sách bàn</Text.Title>
          <Text size="xSmall" className="mt-1 text-slate-500">{tableMap?.tables.length || 0} bàn · {floorCount} tầng</Text>
        </div>
        {isAdmin && <button onClick={() => setSettingsOpen(true)} className="flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white"><IoGridOutline size={18} />Thiết lập</button>}
      </header>

      {Boolean(tableMap?.tables.length) && <div className="relative"><label className="relative block"><span className="sr-only">Tìm số bàn</span><Icon icon="zi-search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Tìm số bàn" autoComplete="off" enterKeyHint="search" className="min-h-11 w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400" /></label>{tableSearch.trim() && <div role="listbox" aria-label="Kết quả tìm bàn" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">{searchResults.length ? searchResults.map((table) => { const bill = openBillFor(table.id); const config = STATUS[table.status] || STATUS.reserved; const disabled = !isAdmin && !bill && table.status !== "available"; return <button key={table.id} type="button" role="option" aria-selected="false" disabled={disabled} onClick={() => { setActiveFloor(table.row_number); openTable(table); setTableSearch(""); }} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 disabled:opacity-60"><span className="min-w-0 truncate text-sm font-semibold text-slate-900">{tableLabel(table)}</span><span className={`flex shrink-0 items-center gap-2 rounded-full px-2 py-1 text-xs ${config.badge}`}><span className={`h-2 w-2 rounded-full ${config.dot}`} />{config.label}</span></button>; }) : <p className="px-3 py-3 text-sm text-slate-500">Không tìm thấy bàn phù hợp</p>}</div>}</div>}

      {tableMap?.tables.length ? <>
        <nav aria-label="Chọn tầng" className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: floorCount }, (_, index) => index + 1).map((floor) => <button key={floor} type="button" aria-pressed={activeFloor === floor} onClick={() => setActiveFloor(floor)} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${activeFloor === floor ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-white text-slate-600"}`}><IoLayersOutline size={17} />Tầng {floor}</button>)}
        </nav>

        <section className="rounded-xl border border-slate-200 bg-slate-100/60 p-2">
          <div className="mb-2 flex items-center justify-between px-1">
            <div><span className="text-sm font-semibold text-slate-800">Tầng {activeFloor}</span><span className="ml-2 text-xs text-slate-500">{floorTables.length} bàn</span></div>
            <span className="text-xs font-medium text-slate-500">Cuộn xuống để xem thêm</span>
          </div>
          {floorTables.length ? <div className="grid grid-cols-2 gap-2 sm:gap-3">{visibleTables.map((table) => {
            const config = STATUS[table.status] || STATUS.reserved;
            return <button key={table.id} type="button" aria-label={`Mở ${tableLabel(table)}`} onClick={() => void openTable(table)} className={`relative flex min-h-[112px] min-w-0 flex-col overflow-hidden rounded-xl border-2 p-2 text-left shadow-sm transition active:scale-[0.98] ${config.card}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><IoGridOutline size={16} /></div>
                <span className={`flex min-w-0 items-center gap-1 rounded-full px-1.5 py-1 text-[10px] font-semibold ${config.badge}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${config.dot}`} /><span className="truncate">{config.label}</span></span>
              </div>
              <span className="mt-2 line-clamp-2 text-sm font-bold text-slate-900">{tableLabel(table)}</span>
              <span className="mt-0.5 text-[10px] text-slate-500">Tầng {table.row_number}</span>
              <div className="mt-auto flex items-end justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-slate-500">{table.status === "occupied" && table.playingSince ? <><IoTimeOutline size={13} /><ElapsedClock startedAt={table.playingSince} className="truncate tabular-nums text-rose-700" /></> : "Chạm để mở"}</span>
                <span role="button" tabIndex={0} aria-label={`Mã QR cố định ${tableLabel(table)}`} onClick={(event) => { event.stopPropagation(); setPublicQrTable(table); }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter" || event.key === " ") setPublicQrTable(table); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><IoQrCodeOutline size={15} /></span>
              </div>
            </button>;
          })}</div> : <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">Tầng này chưa có bàn</div>}
        </section>
      </> : <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center"><Text className="text-slate-600">Chưa có bàn</Text>{isAdmin && <button onClick={() => setSettingsOpen(true)} className="mt-4 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Thiết lập bàn</button>}</div>}

      {!isAdmin && tableMap?.activeBills.length ? <section className="space-y-2 border-t border-slate-200 pt-4"><Text size="small" className="font-semibold text-slate-800">Hóa đơn của tôi</Text>{tableMap.activeBills.map((bill) => <button key={bill.id} onClick={() => navigate(`/bills/${bill.id}`)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-3 text-left"><span className="text-sm font-medium text-slate-800">{tableLabel(tableMap.tables.find((table) => table.id === bill.table))}</span><span className="text-sm font-semibold text-emerald-700">Xem hóa đơn</span></button>)}</section> : null}
    </main>

    <Sheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} autoHeight swipeToClose>
      <Box className="max-h-[88vh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><div><Text.Title size="small">Thiết lập bàn theo tầng</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">Tổng cộng {draftTotal} bàn</Text></div><button aria-label="Đóng" onClick={() => setSettingsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
        {isAdmin ? <>
          <label className="block text-sm font-medium text-slate-700">Số tầng<input type="number" min={1} max={20} value={floorCountDraft} onChange={(event) => changeFloorCount(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" /></label>
          <fieldset><legend className="mb-2 text-sm font-medium text-slate-700">Thứ tự hiển thị tên bàn</legend><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={sortOrderDraft === "row"} onClick={() => setSortOrderDraft("row")} className={`min-h-12 rounded-lg border px-2 text-sm font-semibold ${sortOrderDraft === "row" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}>Trái sang phải</button><button type="button" aria-pressed={sortOrderDraft === "column"} onClick={() => setSortOrderDraft("column")} className={`min-h-12 rounded-lg border px-2 text-sm font-semibold ${sortOrderDraft === "column" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}>Trên xuống dưới</button></div></fieldset>
          <div className="space-y-2">{tablesPerFloorDraft.map((value, index) => <label key={index} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700"><IoLayersOutline size={20} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">Tầng {index + 1}</span><span className="block truncate text-xs text-slate-500">{floorRanges[index]}</span></span><input aria-label={`Số bàn tầng ${index + 1}`} type="number" min={0} max={100} value={value} onChange={(event) => setTablesPerFloorDraft((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="h-11 w-20 rounded-lg border border-slate-300 bg-white px-2 text-center text-base font-semibold" /></label>)}</div>
          <p className="text-xs leading-5 text-slate-500">Để giảm tổng số bàn, hãy xóa từng bàn không còn sử dụng trước. Hệ thống không tự xóa dữ liệu bàn.</p>
          <button disabled={savingLayout} onClick={() => void saveTableLayout()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{savingLayout ? "Đang lưu..." : "Lưu thiết lập bàn"}</button>
          <div className="border-t border-slate-200 pt-3"><button onClick={() => { setSettingsOpen(false); navigate("/admin"); }} className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700">Mở trang quản trị</button></div>
        </> : <Text size="small" className="text-slate-600">Sơ đồ bàn do quản trị viên thiết lập.</Text>}
      </Box>
    </Sheet>
    <Sheet visible={tableSheetOpen} onClose={() => setTableSheetOpen(false)} autoHeight swipeToClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">{isAdmin && editingTableName ? <div className="flex items-center gap-2"><input autoFocus value={tableNameDraft} onChange={(event) => setTableNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameTable(); if (event.key === "Escape") { setTableNameDraft(selectedTable?.name || ""); setEditingTableName(false); } }} maxLength={80} aria-label="Tên bàn" className="min-w-0 flex-1 rounded-lg border border-emerald-400 bg-white px-3 py-2 text-base font-semibold text-slate-900" /><button disabled={busy} aria-label="Lưu tên bàn" onClick={() => void renameTable()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white disabled:opacity-60"><Icon icon="zi-check" /></button></div> : isAdmin ? <button type="button" onClick={() => setEditingTableName(true)} className="flex max-w-full items-center gap-2 text-left"><Text.Title size="small" className="break-words">{tableLabel(selectedTable)}</Text.Title><Icon icon="zi-edit" className="shrink-0 text-slate-500" /></button> : <Text.Title size="small" className="break-words">{tableLabel(selectedTable)}</Text.Title>}<Text size="xSmall" className="mt-1 block text-slate-500">{selectedTable ? STATUS[selectedTable.status]?.label : ""}</Text></div><button aria-label="Đóng" onClick={() => setTableSheetOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>{selectedTable?.status === "available" && <>{isAdmin && <><label className="block text-sm font-medium text-slate-700">Tài khoản khách<button type="button" onClick={() => setCustomerPickerOpen((open) => !open)} className="mt-1 flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-normal text-slate-700"><span className="truncate">{selectedCustomer ? customers.find((customer) => customer.id === selectedCustomer)?.fullname || customers.find((customer) => customer.id === selectedCustomer)?.username || "Đã chọn tài khoản" : "Không gắn tài khoản"}</span><Icon icon="zi-arrow-down" /></button></label>{customerPickerOpen && <div className="rounded-lg border border-slate-200 bg-white p-2"><input autoFocus value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Tìm tên hoặc tài khoản" className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-base" /><div role="listbox" aria-label="Tài khoản khách" className="mt-2 max-h-48 overflow-y-auto"><button type="button" role="option" aria-selected={!selectedCustomer} onClick={() => { setSelectedCustomer(""); setCustomerPickerOpen(false); setCustomerQuery(""); }} className="min-h-11 w-full rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-50">Không gắn tài khoản</button>{filteredCustomers.map((customer) => <button type="button" role="option" aria-selected={selectedCustomer === customer.id} key={customer.id} onClick={() => { setSelectedCustomer(customer.id); setCustomerPickerOpen(false); setCustomerQuery(""); }} className="min-h-11 w-full rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-50">{customer.fullname || customer.username} (@{customer.username})</button>)}</div></div>}</>}<label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={useDefaultProducts} onChange={(event) => setUseDefaultProducts(event.target.checked)} className="h-5 w-5 shrink-0 accent-emerald-700" />Sử dụng mặt hàng mặc định</label><button disabled={busy} onClick={() => void startTable()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">Bắt đầu sử dụng</button>{isAdmin && <button disabled={busy} onClick={() => void changeStatus("reserved")} className="min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-800 disabled:opacity-60">Đặt bàn</button>}</>}{isAdmin && selectedTable && selectedTable.status !== "available" && !openBillFor(selectedTable.id) && <button disabled={busy} onClick={() => void resetTableStatus()} className="min-h-11 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-60">Đưa bàn về trống</button>}{isAdmin && selectedTable?.status === "reserved" && <button disabled={busy} onClick={() => void changeStatus("available")} className="min-h-11 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-60">Hủy đặt bàn</button>}{isAdmin && selectedTable?.status === "available" && !openBillFor(selectedTable.id) && <button onClick={() => { setTableSheetOpen(false); setDeleteSheetOpen(true); setDeletePassword(""); }} className="w-full rounded-lg border border-rose-300 py-3 text-sm font-semibold text-rose-700">Xóa bàn</button>}</Box></Sheet>
    <Sheet visible={Boolean(publicQrTable)} onClose={() => setPublicQrTable(null)} autoHeight swipeToClose unmountOnClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><div><Text.Title size="small">QR xem bill dùng chung</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">Khách chọn bàn và nhập mật khẩu admin lần đầu.</Text></div><button aria-label="Đóng mã QR" onClick={() => setPublicQrTable(null)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><img src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(publicTableUrl)}`} alt="Mã QR xem bill dùng chung" className="mx-auto aspect-square w-64 max-w-full rounded-lg border border-slate-200 bg-white object-contain" /><input readOnly aria-label="Link xem bill dùng chung" value={publicTableUrl} className="min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700" /><button onClick={() => void copyPublicTableUrl()} className="min-h-11 w-full rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white">Sao chép link</button></Box></Sheet>
    <Sheet visible={deleteSheetOpen} onClose={() => setDeleteSheetOpen(false)} autoHeight swipeToClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><Text.Title size="small" className="text-rose-800">Xác nhận xóa {tableLabel(selectedTable)}</Text.Title><button aria-label="Đóng" onClick={() => setDeleteSheetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><label className="block text-sm font-medium text-slate-700">Nhập lại mật khẩu admin<input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label><div className="grid grid-cols-2 gap-2"><button onClick={() => setDeleteSheetOpen(false)} className="min-h-11 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Hủy</button><button disabled={!deletePassword || busy} onClick={() => void deleteTable()} className="min-h-11 rounded-lg bg-rose-700 text-sm font-semibold text-white disabled:opacity-50">Xóa bàn</button></div></Box></Sheet>
  </Page>;
}
