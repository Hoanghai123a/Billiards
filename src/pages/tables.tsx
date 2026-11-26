import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { IoQrCodeOutline } from "react-icons/io5";

import { adminNotificationService, tableService, tableBillingService } from "@/api/services";
import pb, { type Table, type TableBillCustomer, type TableCanvasPosition, type TableMap } from "@/api/pocketbase";
import { useAuth } from "@/contexts/AuthContext";
import { readSessionCache, writeSessionCache } from "@/utils/session-cache";
import { useStaffQueue } from "@/contexts/StaffQueueContext";
import StoreHeader from "@/components/store-header";
import { debounce } from "@/utils/debounce";
import { formatElapsedClock } from "@/utils/format";

const CARD_WIDTH = 124;
const CARD_HEIGHT = 84;
const GRID_GAP = 12;
const PLAN_PADDING = 16;
const MIN_PLAN_WIDTH = 640;
const MIN_PLAN_HEIGHT = 440;

const STATUS: Record<Table["status"], { label: string; card: string; dot: string }> = {
  available: { label: "Trống", card: "border-emerald-500 bg-emerald-50 text-emerald-900", dot: "bg-emerald-500" },
  occupied: { label: "Đang chơi", card: "border-rose-500 bg-rose-50 text-rose-900", dot: "bg-rose-500" },
  reserved: { label: "Đã đặt", card: "border-amber-500 bg-amber-50 text-amber-900", dot: "bg-amber-500" },
};

type Positions = Record<string, TableCanvasPosition>;
type NumberingOrder = "row" | "column";
type CanvasPointer = { x: number; y: number };
type DragState = { tableId: string; offsetX: number; offsetY: number };

const TABLE_LAYOUT_STORAGE_PREFIX = "billiard:table-layout:";

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

function isValidPosition(value: unknown): value is TableCanvasPosition {
  return Boolean(value) && Number.isInteger((value as TableCanvasPosition).x) && Number.isInteger((value as TableCanvasPosition).y)
    && (value as TableCanvasPosition).x >= 0 && (value as TableCanvasPosition).y >= 0;
}

function readDevicePositions(storeId: string): Positions {
  try {
    const stored = JSON.parse(localStorage.getItem(`${TABLE_LAYOUT_STORAGE_PREFIX}${storeId}`) || "null");
    return stored && typeof stored === "object"
      ? Object.fromEntries(Object.entries(stored).filter(([, position]) => isValidPosition(position)))
      : {};
  } catch {
    return {};
  }
}

function saveDevicePositions(storeId: string, positions: Positions) {
  localStorage.setItem(`${TABLE_LAYOUT_STORAGE_PREFIX}${storeId}`, JSON.stringify(positions));
}

function cellKey(position: TableCanvasPosition) {
  return `${position.x}:${position.y}`;
}

function nextFreePosition(positions: Positions, excludedTableId = "", preferred?: TableCanvasPosition) {
  const used = new Set(Object.entries(positions).filter(([id]) => id !== excludedTableId).map(([, position]) => cellKey(position)));
  const candidates: TableCanvasPosition[] = preferred ? [preferred] : [];
  for (let radius = 0; radius <= 30; radius += 1) {
    for (let y = Math.max(0, (preferred?.y || 0) - radius); y <= (preferred?.y || 0) + radius; y += 1) {
      for (let x = Math.max(0, (preferred?.x || 0) - radius); x <= (preferred?.x || 0) + radius; x += 1) {
        if (preferred && Math.max(Math.abs(x - preferred.x), Math.abs(y - preferred.y)) !== radius) continue;
        candidates.push({ x, y });
      }
    }
  }
  for (let y = 0; y < 100; y += 1) for (let x = 0; x < 20; x += 1) candidates.push({ x, y });
  return candidates.find((candidate) => !used.has(cellKey(candidate))) || { x: 0, y: 0 };
}

function resolvedPositions(tables: Table[], stored: Positions) {
  const result: Positions = {};
  if (!Object.keys(stored).length) return defaultPositions(tables);
  for (const table of tables) {
    const position = stored[table.id];
    if (isValidPosition(position) && !Object.values(result).some((item) => cellKey(item) === cellKey(position))) result[table.id] = position;
  }
  for (const table of tables) {
    if (result[table.id]) continue;
    const legacyPosition = { x: Math.max(0, Number(table.position || 1) - 1), y: Math.max(0, Number(table.row_number || 1) - 1) };
    result[table.id] = nextFreePosition(result, table.id, legacyPosition);
  }
  return result;
}

function equalPositions(left: Positions, right: Positions) {
  return JSON.stringify(Object.entries(left).sort(([a], [b]) => a.localeCompare(b))) === JSON.stringify(Object.entries(right).sort(([a], [b]) => a.localeCompare(b)));
}

function numberFromTableName(name: string) {
  const match = name.match(/bàn\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function arrangeQuickly(tables: Table[], tablesPerRow: number, order: NumberingOrder): Positions {
  const columns = Math.max(1, tablesPerRow);
  const rows = Math.ceil(tables.length / columns);
  return Object.fromEntries(tables.map((table, index) => [table.id, order === "row"
    ? { x: index % columns, y: Math.floor(index / columns) }
    : { x: Math.floor(index / rows), y: index % rows }]));
}

function defaultPositions(tables: Table[]): Positions {
  const numbered = tables
    .map((table, index) => ({ table, index, number: numberFromTableName(table.name) }))
    .sort((a, b) => (a.number === null ? 1 : b.number === null ? -1 : a.number - b.number) || a.index - b.index)
    .map((item) => item.table);
  return arrangeQuickly(numbered, 2, "column");
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
  const canArrangeTables = isAdmin || user?.role === "staff";
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [tableMap, setTableMap] = useState<TableMap | null>(null);
  const [storedPositions, setStoredPositions] = useState<Positions>({});
  const [draftPositions, setDraftPositions] = useState<Positions>({});
  const [layoutSnapshot, setLayoutSnapshot] = useState<Positions>({});
  const [editingLayout, setEditingLayout] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [quickColumns, setQuickColumns] = useState("4");
  const [quickOrder, setQuickOrder] = useState<NumberingOrder>("row");
  const [layoutEditMode, setLayoutEditMode] = useState<"manual" | "quick">("manual");
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [discardSheetOpen, setDiscardSheetOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [totalTablesDraft, setTotalTablesDraft] = useState("");
  const [savingTableCount, setSavingTableCount] = useState(false);
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, CanvasPointer>());
  const dragRef = useRef<DragState | null>(null);
  const panStartRef = useRef<{ pointer: CanvasPointer; pan: CanvasPointer } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

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
      setStoredPositions(readDevicePositions(storeId));
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadTables(); }, [storeId]);
  useEffect(() => {
    if (!storeId || editingLayout) return;
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
  }, [storeId, editingLayout]);
  useEffect(() => {
    if (queueRevisionRef.current === revision) return;
    queueRevisionRef.current = revision;
    if (storeId && !editingLayout) void refreshMap(false);
  }, [revision, storeId, editingLayout]);
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
  useEffect(() => { if (settingsOpen && tableMap) setTotalTablesDraft(String(tableMap.tables.length)); }, [settingsOpen, tableMap?.tables.length]);
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

  const positions = useMemo(() => resolvedPositions(tableMap?.tables || [], storedPositions), [tableMap?.tables, storedPositions]);
  const activePositions = editingLayout ? draftPositions : positions;
  const sortedTables = useMemo(() => [...(tableMap?.tables || [])].sort((a, b) => a.row_number - b.row_number || a.position - b.position || a.name.localeCompare(b.name, "vi")), [tableMap]);
  const quickSortedTables = useMemo(() => {
    const numbered = sortedTables.map((table, index) => ({ table, index, number: numberFromTableName(table.name) }));
    if (numbered.some((item) => item.number === null)) return sortedTables;
    return numbered.sort((a, b) => a.number! - b.number! || a.index - b.index).map((item) => item.table);
  }, [sortedTables]);
  const tableNumbers = useMemo(() => new Map(sortedTables.map((table, index) => [table.id, index + 1])), [sortedTables]);
  const filteredCustomers = useMemo(() => {
    const query = normalizeSearch(customerQuery.trim());
    return query ? customers.filter((customer) => normalizeSearch(`${customer.fullname || ""} ${customer.username || ""}`).includes(query)) : customers;
  }, [customers, customerQuery]);
  const maxX = Math.max(3, ...Object.values(activePositions).map((position) => position.x));
  const maxY = Math.max(2, ...Object.values(activePositions).map((position) => position.y));
  const canvasWidth = Math.max(MIN_PLAN_WIDTH, PLAN_PADDING * 2 + (maxX + 1) * CARD_WIDTH + maxX * GRID_GAP);
  const canvasHeight = Math.max(MIN_PLAN_HEIGHT, PLAN_PADDING * 2 + (maxY + 1) * CARD_HEIGHT + maxY * GRID_GAP);
  const layoutDirty = editingLayout && !equalPositions(draftPositions, layoutSnapshot);

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
    if (editingLayout) return;
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
  const enterLayoutEdit = (mode: "manual" | "quick" = "manual", initialPositions?: Positions) => {
    const current = resolvedPositions(tableMap?.tables || [], storedPositions);
    const draft = initialPositions || current;
    setDraftPositions(draft); setLayoutSnapshot(current); setLayoutEditMode(mode); setZoom(1); setPan({ x: 0, y: 0}); setEditingLayout(true);
  };
  const previewQuickLayout = () => {
    if (!tableMap?.tables.length) return;
    const enteredColumns = Number(quickColumns);
    if (!quickColumns.trim() || !Number.isInteger(enteredColumns) || enteredColumns < 1 || enteredColumns > 12) {
      openSnackbar({ text: "Số bàn mỗi hàng phải từ 1 đến 12", type: "warning" });
      return;
    }
    setSortSheetOpen(false);
    enterLayoutEdit("quick", arrangeQuickly(quickSortedTables, enteredColumns, quickOrder));
  };
  const closeLayoutEdit = () => { if (layoutDirty) setDiscardSheetOpen(true); else setEditingLayout(false); };
  const discardLayoutEdit = () => { setEditingLayout(false); setDiscardSheetOpen(false); setDraftPositions({}); };
  const saveLayout = async () => {
    if (!storeId || !canArrangeTables) return;
    const tableIds = new Set((tableMap?.tables || []).map((table) => table.id));
    const positionsToSave = Object.fromEntries(Object.entries(draftPositions).filter(([tableId, position]) => tableIds.has(tableId) && isValidPosition(position)));
    setLayoutSaving(true);
    try {
      saveDevicePositions(storeId, positionsToSave);
      setStoredPositions(positionsToSave); setLayoutSnapshot(positionsToSave); setEditingLayout(false);
      openSnackbar({ text: "Đã lưu sơ đồ bàn", type: "success" });
    } catch (saveError) { openSnackbar({ text: messageOf(saveError, "Không thể lưu sơ đồ bàn"), type: "error" });
    } finally { setLayoutSaving(false); }
  };
  const saveTableCount = async () => {
    if (!isAdmin || !tableMap) return;
    const enteredCount = Number(totalTablesDraft);
    if (!totalTablesDraft.trim() || !Number.isInteger(enteredCount) || enteredCount < 0 || enteredCount > 500) {
      return void openSnackbar({ text: "Tổng số bàn phải là số nguyên từ 0 đến 500", type: "warning" });
    }
    const totalTables = enteredCount;
    if (totalTables < tableMap.tables.length) return void openSnackbar({ text: "Không thể tự động xóa bàn đang có dữ liệu. Hãy xóa từng bàn trong danh sách.", type: "warning" });
    setSavingTableCount(true);
    try {
      const layoutRowCount = Math.max(1, tableMap.layout.rowCount || 1, ...tableMap.tables.map((table) => Number(table.row_number) || 1));
      const counts = Array.from({ length: layoutRowCount }, (_, index) => tableMap.tables.filter((table) => (Number(table.row_number) || 1) === index + 1).length);
      counts[counts.length - 1] += totalTables - tableMap.tables.length;
      await tableService.configureLayout({ rowCount: layoutRowCount, tablesPerRow: counts });
      await loadTables(); setSettingsOpen(false); openSnackbar({ text: "Đã cập nhật tổng số bàn", type: "success" });
    } catch (saveError) { openSnackbar({ text: messageOf(saveError, "Không thể cập nhật tổng số bàn"), type: "error" });
    } finally { setSavingTableCount(false); }
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
  const canvasPoint = (event: ReactPointerEvent<HTMLDivElement>): CanvasPointer => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: (event.clientX - (rect?.left || 0) - pan.x) / zoom, y: (event.clientY - (rect?.top || 0) - pan.y) / zoom };
  };
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, tableId: string) => {
    if (!editingLayout) return;
    event.stopPropagation();
    const position = draftPositions[tableId];
    if (!position) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event as unknown as ReactPointerEvent<HTMLDivElement>);
    dragRef.current = { tableId, offsetX: point.x - (PLAN_PADDING + position.x * (CARD_WIDTH + GRID_GAP)), offsetY: point.y - (PLAN_PADDING + position.y * (CARD_HEIGHT + GRID_GAP)) };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = canvasPoint(event);
    const preferred = { x: Math.max(0, Math.round((point.x - drag.offsetX - PLAN_PADDING) / (CARD_WIDTH + GRID_GAP))), y: Math.max(0, Math.round((point.y - drag.offsetY - PLAN_PADDING) / (CARD_HEIGHT + GRID_GAP))) };
    setDraftPositions((current) => ({ ...current, [drag.tableId]: nextFreePosition(current, drag.tableId, preferred) }));
  };
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editingLayout) return;
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point); event.currentTarget.setPointerCapture(event.pointerId);
    const points = Array.from(pointersRef.current.values());
    if (points.length === 1) panStartRef.current = { pointer: point, pan };
    if (points.length === 2) { panStartRef.current = null; pinchRef.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom }; }
  };
  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editingLayout) return;
    if (dragRef.current) return moveDrag(event);
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(pointersRef.current.values());
    if (points.length >= 2 && pinchRef.current) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (pinchRef.current.distance > 0) setZoom(Math.max(0.65, Math.min(1.6, pinchRef.current.zoom * (distance / pinchRef.current.distance))));
    } else if (panStartRef.current) setPan({ x: panStartRef.current.pan.x + event.clientX - panStartRef.current.pointer.x, y: panStartRef.current.pan.y + event.clientY - panStartRef.current.pointer.y });
  };
  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null; pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) panStartRef.current = null;
  };

  if (loading) return <Page className="min-h-screen bg-slate-50"><StoreHeader onSettings={() => setSettingsOpen(true)} /><div className="flex justify-center py-12"><Spinner /></div></Page>;
  if (error) return <Page className="min-h-screen bg-slate-50"><StoreHeader onSettings={() => setSettingsOpen(true)} /><main className="px-4 py-6"><div className="rounded-lg border border-rose-200 bg-rose-50 p-4"><Text className="text-rose-800">{error}</Text><button onClick={() => { setLoading(true); void loadTables(); }} className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white">Thử lại</button></div></main></Page>;

  return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
    <StoreHeader onSettings={() => setSettingsOpen(true)} />
    <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4">
      <header className="flex items-end justify-between gap-3"><div><Text.Title size="small" className="text-slate-900">Sơ đồ bàn</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">{tableMap?.tables.length || 0} bàn</Text></div><div className="flex items-center gap-2">{canArrangeTables && <button onClick={editingLayout ? closeLayoutEdit : () => { setQuickSetupOpen(false); setSortSheetOpen(true); }} className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${editingLayout ? "border border-rose-300 bg-white text-rose-700" : "bg-emerald-700 text-white"}`}><Icon icon={editingLayout ? "zi-close" : "zi-drag-indicator-solid"} />{editingLayout ? "Hủy" : "Sắp xếp"}</button>}</div></header>
      {!editingLayout && Boolean(tableMap?.tables.length) && <div className="relative"><label className="relative block"><span className="sr-only">Tìm số bàn</span><Icon icon="zi-search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Tìm số bàn" autoComplete="off" enterKeyHint="search" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400" /></label>{tableSearch.trim() && <div role="listbox" aria-label="Kết quả tìm bàn" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">{searchResults.length ? searchResults.map((table) => { const bill = openBillFor(table.id); const config = STATUS[table.status] || STATUS.reserved; const disabled = !isAdmin && !bill && table.status !== "available"; return <button key={table.id} type="button" role="option" aria-selected="false" disabled={disabled} onClick={() => { openTable(table); setTableSearch(""); }} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 disabled:cursor-default disabled:opacity-60"><span className="min-w-0 truncate text-sm font-semibold text-slate-900">{tableLabel(table)}</span><span className="flex shrink-0 items-center gap-2 text-xs text-slate-600"><span className={`h-2 w-2 rounded-full ${config.dot}`} />{config.label}{table.status === "occupied" && table.playingSince && <> · <ElapsedClock startedAt={table.playingSince} /></>}</span></button>; }) : <p className="px-3 py-3 text-sm text-slate-500">Không tìm thấy bàn phù hợp</p>}</div>}</div>}
      {editingLayout && <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3"><Text size="small" className="text-emerald-900">{layoutEditMode === "manual" ? "Thủ công: kéo biểu tượng trên card để đặt bàn. Vuốt vùng trống để xem sơ đồ; chụm hai ngón để phóng to." : "Nhanh: kiểm tra bố cục đã xếp. Bạn vẫn có thể kéo từng bàn để chỉnh trước khi lưu."}</Text><button disabled={layoutSaving} onClick={() => void saveLayout()} className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{layoutSaving ? "Đang lưu..." : "Lưu bố cục"}</button></section>}
      {!tableMap?.tables.length ? <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center"><Text className="text-slate-600">Chưa có bàn trong sơ đồ</Text>{isAdmin && <button onClick={() => setSettingsOpen(true)} className="mt-4 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Thêm bàn</button>}</div> : <div ref={viewportRef} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} className={`relative rounded-lg border border-slate-200 bg-white shadow-sm ${editingLayout ? "h-[min(68vh,660px)] touch-none overflow-hidden" : "min-h-[calc(100dvh-260px)] overflow-auto"}`}><div className="relative" style={{ width: canvasWidth, height: canvasHeight, transform: editingLayout ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : undefined, transformOrigin: "top left" }}>{sortedTables.map((table) => {
        const position = activePositions[table.id]; const config = STATUS[table.status] || STATUS.reserved;
        if (!position) return null;
        return <div key={table.id} role={editingLayout ? undefined : "button"} tabIndex={editingLayout ? undefined : 0} aria-label={editingLayout ? undefined : `Mở ${tableLabel(table)}`} onClick={() => { if (!editingLayout) openTable(table); }} onKeyDown={(event) => { if (!editingLayout && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openTable(table); } }} className={`absolute flex h-[84px] w-[124px] flex-col rounded-lg border-2 p-2 text-left shadow-sm ${config.card} ${editingLayout ? "" : "cursor-pointer"}`} style={{ left: PLAN_PADDING + position.x * (CARD_WIDTH + GRID_GAP), top: PLAN_PADDING + position.y * (CARD_HEIGHT + GRID_GAP) }}><div className="flex items-start justify-between gap-1"><span className="min-w-0 flex-1 text-xs font-semibold">{tableLabel(table)}</span>{editingLayout ? <button type="button" aria-label={`Kéo ${tableLabel(table)}`} title="Kéo để di chuyển" onPointerDown={(event) => beginDrag(event, table.id)} className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 touch-none items-center justify-center rounded-md bg-white/80 text-slate-700"><Icon icon="zi-drag-indicator-solid" /></button> : <div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`Mã QR cố định ${tableLabel(table)}`} title="Mở QR xem bill của bàn" onClick={(event) => { event.stopPropagation(); setPublicQrTable(table); }} onKeyDown={(event) => event.stopPropagation()} className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80 text-slate-700"><IoQrCodeOutline size={16} /></button><span className={`mt-1 h-2.5 w-2.5 rounded-full ${config.dot}`} /></div>}</div><div className="mt-auto"><span className="text-xs font-medium">{config.label}</span>{table.status === "occupied" && table.playingSince && <ElapsedClock startedAt={table.playingSince} className="block text-xs font-semibold tabular-nums" />}</div></div>;
      })}</div></div>}
      {!isAdmin && tableMap?.activeBills.length ? <section className="space-y-2 border-t border-slate-200 pt-4"><Text size="small" className="font-semibold text-slate-800">Hóa đơn của tôi</Text>{tableMap.activeBills.map((bill) => <button key={bill.id} onClick={() => navigate(`/bills/${bill.id}`)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-3 text-left"><span className="text-sm font-medium text-slate-800">{tableLabel(tableMap.tables.find((table) => table.id === bill.table))}</span><span className="text-sm font-semibold text-emerald-700">Xem hóa đơn</span></button>)}</section> : null}
    </main>
    <Sheet visible={sortSheetOpen} onClose={() => { setSortSheetOpen(false); setQuickSetupOpen(false); }} autoHeight swipeToClose unmountOnClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><Text.Title size="small">{quickSetupOpen ? "Sắp xếp nhanh" : "Sắp xếp bàn"}</Text.Title><button aria-label="Đóng" onClick={() => { setSortSheetOpen(false); setQuickSetupOpen(false); }} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>{quickSetupOpen ? <><label className="block text-sm font-medium text-slate-700">Số bàn mỗi hàng<input type="number" min={1} max={12} value={quickColumns} onChange={(event) => setQuickColumns(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base" /></label><fieldset><legend className="mb-2 text-sm font-medium text-slate-700">Thứ tự đánh số</legend><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={quickOrder === "row"} onClick={() => setQuickOrder("row")} className={`min-h-11 rounded-lg border px-2 text-sm font-semibold ${quickOrder === "row" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}>Trái sang phải</button><button type="button" aria-pressed={quickOrder === "column"} onClick={() => setQuickOrder("column")} className={`min-h-11 rounded-lg border px-2 text-sm font-semibold ${quickOrder === "column" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}>Trên xuống dưới</button></div></fieldset><div className="grid grid-cols-2 gap-2"><button onClick={() => setQuickSetupOpen(false)} className="min-h-11 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Quay lại</button><button onClick={previewQuickLayout} className="min-h-11 rounded-lg bg-emerald-700 text-sm font-semibold text-white">Xem bố cục</button></div></> : <div className="space-y-2"><button onClick={() => setQuickSetupOpen(true)} className="flex min-h-14 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-left"><span><span className="block text-sm font-semibold text-slate-900">Nhanh</span><span className="mt-1 block text-xs text-slate-500">Tự xếp theo số bàn mỗi hàng và thứ tự đánh số</span></span><Icon icon="zi-arrow-right" /></button><button onClick={() => { setSortSheetOpen(false); enterLayoutEdit("manual"); }} className="flex min-h-14 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-left"><span><span className="block text-sm font-semibold text-slate-900">Thủ công</span><span className="mt-1 block text-xs text-slate-500">Kéo từng bàn đến vị trí mong muốn</span></span><Icon icon="zi-arrow-right" /></button></div>}</Box></Sheet>
    <Sheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} autoHeight swipeToClose><Box className="max-h-[85vh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><Text.Title size="small">Thiết lập bàn</Text.Title><button aria-label="Đóng" onClick={() => setSettingsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>{isAdmin ? <><p className="text-sm leading-5 text-slate-600">Bố cục kéo-thả được quản lý riêng bằng nút Sắp xếp trên sơ đồ.</p><label className="block text-sm font-medium text-slate-700">Tổng số bàn<input type="number" min={0} max={500} value={totalTablesDraft} onChange={(event) => setTotalTablesDraft(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base" /></label><button disabled={savingTableCount} onClick={() => void saveTableCount()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{savingTableCount ? "Đang lưu..." : "Lưu tổng số bàn"}</button><button onClick={() => { setSettingsOpen(false); navigate("/admin/products"); }} className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700">Quản lý mặt hàng</button><button onClick={() => { setSettingsOpen(false); navigate("/admin"); }} className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700">Dashboard quản trị</button><button onClick={() => { setSettingsOpen(false); navigate("/admin/inventory"); }} className="w-full rounded-lg border border-emerald-200 bg-white py-3 text-sm font-semibold text-emerald-800">Quản lý kho hàng</button><button onClick={() => { setSettingsOpen(false); navigate("/admin/bill-history"); }} className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700">Lịch sử bill</button><button onClick={() => { setSettingsOpen(false); navigate("/admin/reports"); }} className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700">Báo cáo doanh thu</button><button onClick={() => { setSettingsOpen(false); navigate("/admin/promotions"); }} className="w-full rounded-lg border border-emerald-200 bg-white py-3 text-sm font-semibold text-emerald-800">Khuyến mại</button></> : <Text size="small" className="text-slate-600">Sơ đồ bàn do quản trị viên thiết lập.</Text>}</Box></Sheet>
    <Sheet visible={discardSheetOpen} onClose={() => setDiscardSheetOpen(false)} autoHeight swipeToClose unmountOnClose><Box className="space-y-4 px-4 pb-6 pt-4"><Text.Title size="small">Bỏ thay đổi bố cục?</Text.Title><Text size="small" className="text-slate-600">Các vị trí chưa lưu sẽ bị mất.</Text><div className="grid grid-cols-2 gap-2"><button onClick={() => setDiscardSheetOpen(false)} className="min-h-11 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Tiếp tục sửa</button><button onClick={discardLayoutEdit} className="min-h-11 rounded-lg bg-rose-700 text-sm font-semibold text-white">Bỏ thay đổi</button></div></Box></Sheet>
    <Sheet visible={tableSheetOpen} onClose={() => setTableSheetOpen(false)} autoHeight swipeToClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">{isAdmin && editingTableName ? <div className="flex items-center gap-2"><input autoFocus value={tableNameDraft} onChange={(event) => setTableNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameTable(); if (event.key === "Escape") { setTableNameDraft(selectedTable?.name || ""); setEditingTableName(false); } }} maxLength={80} aria-label="Tên bàn" className="min-w-0 flex-1 rounded-lg border border-emerald-400 bg-white px-3 py-2 text-base font-semibold text-slate-900" /><button disabled={busy} aria-label="Lưu tên bàn" onClick={() => void renameTable()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white disabled:opacity-60"><Icon icon="zi-check" /></button></div> : isAdmin ? <button type="button" onClick={() => setEditingTableName(true)} className="flex max-w-full items-center gap-2 text-left"><Text.Title size="small" className="break-words">{tableLabel(selectedTable)}</Text.Title><Icon icon="zi-edit" className="shrink-0 text-slate-500" /></button> : <Text.Title size="small" className="break-words">{tableLabel(selectedTable)}</Text.Title>}<Text size="xSmall" className="mt-1 block text-slate-500">{selectedTable ? STATUS[selectedTable.status]?.label : ""}</Text></div><button aria-label="Đóng" onClick={() => setTableSheetOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>{selectedTable?.status === "available" && <>{isAdmin && <><label className="block text-sm font-medium text-slate-700">Tài khoản khách<button type="button" onClick={() => setCustomerPickerOpen((open) => !open)} className="mt-1 flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-normal text-slate-700"><span className="truncate">{selectedCustomer ? customers.find((customer) => customer.id === selectedCustomer)?.fullname || customers.find((customer) => customer.id === selectedCustomer)?.username || "Đã chọn tài khoản" : "Không gắn tài khoản"}</span><Icon icon="zi-arrow-down" /></button></label>{customerPickerOpen && <div className="rounded-lg border border-slate-200 bg-white p-2"><input autoFocus value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Tìm tên hoặc tài khoản" className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-base" /><div role="listbox" aria-label="Tài khoản khách" className="mt-2 max-h-48 overflow-y-auto"><button type="button" role="option" aria-selected={!selectedCustomer} onClick={() => { setSelectedCustomer(""); setCustomerPickerOpen(false); setCustomerQuery(""); }} className="min-h-11 w-full rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-50">Không gắn tài khoản</button>{filteredCustomers.map((customer) => <button type="button" role="option" aria-selected={selectedCustomer === customer.id} key={customer.id} onClick={() => { setSelectedCustomer(customer.id); setCustomerPickerOpen(false); setCustomerQuery(""); }} className="min-h-11 w-full rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-50">{customer.fullname || customer.username} (@{customer.username})</button>)}</div></div>}</>}<label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={useDefaultProducts} onChange={(event) => setUseDefaultProducts(event.target.checked)} className="h-5 w-5 shrink-0 accent-emerald-700" />Sử dụng mặt hàng mặc định</label><button disabled={busy} onClick={() => void startTable()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">Bắt đầu sử dụng</button>{isAdmin && <button disabled={busy} onClick={() => void changeStatus("reserved")} className="min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-800 disabled:opacity-60">Đặt bàn</button>}</>}{isAdmin && selectedTable && selectedTable.status !== "available" && !openBillFor(selectedTable.id) && <button disabled={busy} onClick={() => void resetTableStatus()} className="min-h-11 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-60">Đưa bàn về trống</button>}{isAdmin && selectedTable?.status === "reserved" && <button disabled={busy} onClick={() => void changeStatus("available")} className="min-h-11 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-60">Hủy đặt bàn</button>}{isAdmin && selectedTable?.status === "available" && !openBillFor(selectedTable.id) && <button onClick={() => { setTableSheetOpen(false); setDeleteSheetOpen(true); setDeletePassword(""); }} className="w-full rounded-lg border border-rose-300 py-3 text-sm font-semibold text-rose-700">Xóa bàn</button>}</Box></Sheet>
    <Sheet visible={Boolean(publicQrTable)} onClose={() => setPublicQrTable(null)} autoHeight swipeToClose unmountOnClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><div><Text.Title size="small">QR xem bill dùng chung</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">Khách chọn bàn và nhập mật khẩu admin lần đầu.</Text></div><button aria-label="Đóng mã QR" onClick={() => setPublicQrTable(null)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><img src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(publicTableUrl)}`} alt="Mã QR xem bill dùng chung" className="mx-auto aspect-square w-64 max-w-full rounded-lg border border-slate-200 bg-white object-contain" /><input readOnly aria-label="Link xem bill dùng chung" value={publicTableUrl} className="min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700" /><button onClick={() => void copyPublicTableUrl()} className="min-h-11 w-full rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white">Sao chép link</button></Box></Sheet>
    <Sheet visible={deleteSheetOpen} onClose={() => setDeleteSheetOpen(false)} autoHeight swipeToClose><Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-center justify-between"><Text.Title size="small" className="text-rose-800">Xác nhận xóa {tableLabel(selectedTable)}</Text.Title><button aria-label="Đóng" onClick={() => setDeleteSheetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div><label className="block text-sm font-medium text-slate-700">Nhập lại mật khẩu admin<input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label><div className="grid grid-cols-2 gap-2"><button onClick={() => setDeleteSheetOpen(false)} className="min-h-11 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Hủy</button><button disabled={!deletePassword || busy} onClick={() => void deleteTable()} className="min-h-11 rounded-lg bg-rose-700 text-sm font-semibold text-white disabled:opacity-50">Xóa bàn</button></div></Box></Sheet>
  </Page>;
}
