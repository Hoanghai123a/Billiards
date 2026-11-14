import { useEffect, useMemo, useState } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FaRegClock, FaShoppingCart } from "react-icons/fa";
import { GiEightBall } from "react-icons/gi";

import { billPaymentService, promotionService, tableBillingService, tableService, walletService } from "@/api/services";
import pb, { type BillPaymentSettings, type Promotion, type PromotionSnapshot, type TableBill, type TableBillProduct, type TableMap, type WalletOrder } from "@/api/pocketbase";
import { useAuth } from "@/contexts/AuthContext";
import { openBillPrint } from "@/components/bill-print";
import { formatDuration, formatMoneyInput, formatVietnamDateTime, fromVietnamDateTimeInput, handleMoneyInput, toVietnamDateTimeInput } from "@/utils/format";

const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString("vi-VN")}đ`;
const quantityText = (value: number, unit: TableBill["items"][number]["billingUnit"]) => unit === "quantity" ? String(Math.round(value)) : Number(value).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const dateTime = (value: string) => formatVietnamDateTime(value);
const errorMessage = (error: any) => error?.response?.data?.error || error?.response?.message || error?.message || "Không thể thực hiện thao tác";
const draftsFor = (items: TableBill["items"]) => items.reduce<Record<string, string>>((drafts, item) => { drafts[item.id] = String(item.quantity); return drafts; }, {});
const localDateTimeInput = toVietnamDateTimeInput;
const cashDenominations = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
const promotionConditions = (promotion: PromotionSnapshot) => {
  const conditions = [`Phạm vi: ${promotion.scope === "invoice" ? "toàn hóa đơn" : promotion.scope === "category" ? `danh mục ${promotion.targetCategories.join(", ")}` : `mặt hàng ${(promotion.targetProducts || []).map((item) => item.name).join(", ")}`}`];
  if (promotion.minInvoiceAmount > 0) conditions.push(`Hóa đơn từ ${money(promotion.minInvoiceAmount)}`);
  if (promotion.audience === "group") conditions.push(`Nhóm khách: ${(promotion.targetGroups || []).map((item) => item.name).join(", ")}`);
  if (promotion.audience === "card") conditions.push(`Thẻ thành viên: ${(promotion.targetCards || []).map((item) => item.name).join(", ")}`);
  const dayLabels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  if (promotion.weekdays?.length && promotion.weekdays.length < 7) conditions.push(`Thứ ${promotion.weekdays.map((day) => dayLabels[day]).join(", ")}`);
  if (promotion.timeStart && promotion.timeEnd) conditions.push(`${promotion.timeStart}–${promotion.timeEnd}`);
  return conditions.join(" · ");
};
const promotionValue = (promotion: Promotion) => promotion.promotionType === "percent" ? `${promotion.value}%` : promotion.promotionType === "fixed_price" ? `Đồng giá ${money(promotion.value)}` : money(promotion.value);
const sequentialTableName = async (bill: TableBill) => {
  const fallbackName = /^Bàn \d+$/.test(bill.tableName) ? bill.tableName : "Bàn";
  try {
    const tableMap = await tableService.getMap();
    const tables = [...tableMap.tables].sort((a, b) => a.row_number - b.row_number || a.position - b.position || a.name.localeCompare(b.name, "vi"));
    const index = tables.findIndex((table) => table.id === bill.table);
    return { ...bill, tableName: index >= 0 ? (tables[index].name || `Bàn ${index + 1}`) : fallbackName };
  } catch {
    return { ...bill, tableName: fallbackName };
  }
};
export default function PlayingPage() {
  const { tableId, billId } = useParams<{ tableId?: string; billId?: string }>();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const { user, storeName } = useAuth();
  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "staff";
  const canOperateBill = isAdmin || isStaff;
  const canManageSettings = isAdmin;
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [bill, setBill] = useState<TableBill | null>(null);
  const [sessionSummary, setSessionSummary] = useState<Awaited<ReturnType<typeof tableBillingService.getSessionSummary>> | null>(null);
  const [products, setProducts] = useState<TableBillProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"status" | "menu">("status");
  const [activeCategory, setActiveCategory] = useState("Tất cả");
  const [quantityDraft, setQuantityDraft] = useState<Record<string, string>>({});
  const [timeEditItemId, setTimeEditItemId] = useState("");
  const [timeStartedInput, setTimeStartedInput] = useState("");
  const [timeStoppedInput, setTimeStoppedInput] = useState("");
  const [deletingItem, setDeletingItem] = useState<TableBill["items"][number] | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [productQuantityDraft, setProductQuantityDraft] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Record<string, string>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [paymentMode, setPaymentMode] = useState<"qr" | "wallet" | "cash" | "transfer">("qr");
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [promotionSheetOpen, setPromotionSheetOpen] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [paymentDiscountEnabled, setPaymentDiscountEnabled] = useState(false);
  const [paymentDiscountInput, setPaymentDiscountInput] = useState("0");
  const [paymentDiscountNoteInput, setPaymentDiscountNoteInput] = useState("");
  const [paymentSettings, setPaymentSettings] = useState<BillPaymentSettings | null>(null);
  const [paymentSettingsLoading, setPaymentSettingsLoading] = useState(false);
  const [paymentSettingsError, setPaymentSettingsError] = useState("");
  const [paymentDone, setPaymentDone] = useState<{ promoUsed?: number; mainUsed?: number } | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<TableBill | null>(null);
  const [legacyOrder, setLegacyOrder] = useState<WalletOrder | null>(null);
  const [legacyOrderError, setLegacyOrderError] = useState("");
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitSessionOpen, setSplitSessionOpen] = useState(false);
  const [splitSessionKeepCustomer, setSplitSessionKeepCustomer] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);
  const [operationMap, setOperationMap] = useState<TableMap | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [splitTableId, setSplitTableId] = useState("");
  const [transferTableId, setTransferTableId] = useState("");
  const [splitItemIds, setSplitItemIds] = useState<string[]>([]);

  const loadBill = async () => {
    try {
      const response = billId ? await tableBillingService.getDetail(billId) : tableId ? await tableBillingService.getByTable(tableId) : null;
      const result = response ? await sequentialTableName(response) : null;
      if (!result) { navigate("/", { replace: true }); return; }
      setBill(result);
      setQuantityDraft(draftsFor(result.items));
    } catch (error) {
      openSnackbar({ text: errorMessage(error) || "Không thể tải hóa đơn", type: "error" });
      navigate("/", { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const loadLegacyOrder = async () => {
    if (!orderId) return;
    setLoading(true);
    setLegacyOrderError("");
    try {
      setLegacyOrder(await walletService.getOrder(orderId));
    } catch (error) {
      setLegacyOrderError(errorMessage(error) || "Không thể tải hóa đơn ví cũ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) {
      loadLegacyOrder();
      return;
    }
    loadBill();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadBill();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [billId, tableId, orderId]);

  useEffect(() => {
    if (!bill?.id) { setSessionSummary(null); return; }
    let active = true;
    setSessionSummary(null);
    tableBillingService.getSessionSummary(bill.id).then((result) => {
      if (active) setSessionSummary(result);
    }).catch((error) => {
      if (active) openSnackbar({ text: errorMessage(error), type: "error" });
    });
    return () => { active = false; };
  }, [bill]);

  useEffect(() => {
    if (activeTab !== "menu" || products.length) return;
    setProductsLoading(true);
    tableBillingService.getProducts().then((result) => setProducts(result.items)).catch((error) => openSnackbar({ text: errorMessage(error), type: "error" })).finally(() => setProductsLoading(false));
  }, [activeTab, products.length]);

  useEffect(() => {
    if (!bill?.id || !paymentSheetOpen || !["open", "stopped"].includes(bill.status) || bill.paymentRequested) return;
    let active = true;
    setPaymentSettingsLoading(true);
    setPaymentSettingsError("");
    billPaymentService.getSettings().then((settings) => {
      if (active) setPaymentSettings(settings);
    }).catch((error) => {
      if (active) setPaymentSettingsError(errorMessage(error));
    }).then(() => {
      if (active) setPaymentSettingsLoading(false);
    });
    return () => { active = false; };
  }, [bill?.id, bill?.status, paymentSheetOpen]);

  useEffect(() => {
    if (!operationsOpen || !isAdmin) return;
    tableService.getMap().then(setOperationMap).catch((error) => openSnackbar({ text: errorMessage(error), type: "error" }));
  }, [isAdmin, operationsOpen]);

  const categories = useMemo(() => ["Tất cả", ...Array.from(new Set(products.map((product) => product.category || "Khác"))).sort((a, b) => a.localeCompare(b, "vi"))], [products]);
  const visibleProducts = useMemo(() => products.filter((product) => (activeCategory === "Tất cả" || (product.category || "Khác") === activeCategory) && `${product.name} ${product.category || ""}`.toLocaleLowerCase("vi").includes(productQuery.trim().toLocaleLowerCase("vi"))), [activeCategory, productQuery, products]);
  const cartItems = useMemo(() => products.filter((product) => Object.prototype.hasOwnProperty.call(cart, product.id)), [cart, products]);
  const cartTotal = useMemo(() => cartItems.reduce((sum, product) => sum + (product.billingUnit === "hour" ? 0 : product.price * (Number(cart[product.id]) || 0)), 0), [cart, cartItems]);
  const isOpen = bill?.status === "open";
  const isStopped = bill?.status === "stopped";
  const canStartPayment = Boolean(isOpen || (isStopped && !bill?.paymentRequested));
  const isBillingPaused = Boolean(bill?.billingPaused);
  const canEdit = isOpen && !isBillingPaused && canOperateBill;
  const canAddItems = canEdit || (isOpen && !isBillingPaused && bill?.customer === user?.id);
  const hasHourlyItem = Boolean(bill?.items.some((item) => item.billingUnit === "hour"));
  const hasHourlyCartItem = cartItems.some((item) => item.billingUnit === "hour");
  const isWalletPending = bill?.status === "wallet_pending" || Boolean(isStopped && bill?.paymentRequested);
  const isPendingTransfer = isWalletPending && bill?.paymentMethod === "transfer";
  const payableAmount = bill?.totalAmount || 0;
  const paymentDiscountPercentValue = Number(paymentDiscountInput);
  const paymentDiscountValid = !paymentDiscountEnabled || (paymentDiscountInput !== "" && Number.isSafeInteger(paymentDiscountPercentValue) && paymentDiscountPercentValue >= 0 && paymentDiscountPercentValue <= 100);
  const appliedPaymentDiscountPercent = isAdmin && paymentDiscountEnabled && paymentDiscountValid ? paymentDiscountPercentValue : 0;
  const paymentDiscountAmount = bill && appliedPaymentDiscountPercent > 0 ? Math.round(payableAmount * appliedPaymentDiscountPercent / 100) : 0;
  const paymentDueAmount = Math.max(0, payableAmount - paymentDiscountAmount);
  const cashReceivedValue = cashReceivedInput === "" ? paymentDueAmount : Number(cashReceivedInput);
  const cashReceivedValid = cashReceivedInput === "" || Number.isSafeInteger(cashReceivedValue);
  const cashCanConfirm = Boolean(canOperateBill && bill && paymentDiscountValid && cashReceivedValid && cashReceivedValue >= paymentDueAmount);
  const cashShortfall = bill ? Math.max(0, paymentDueAmount - (cashReceivedValid ? cashReceivedValue : 0)) : 0;
  const cashChange = bill ? Math.max(0, (cashReceivedValid ? cashReceivedValue : 0) - paymentDueAmount) : 0;

  const openPaymentSheet = () => {
    if (!bill || !canStartPayment) return;
    setCashReceivedInput("");
    setPaymentDiscountEnabled(false);
    setPaymentDiscountInput("0");
    setPaymentDiscountNoteInput("");
    setPaymentSheetOpen(true);
  };

  const openPromotionSheet = async () => {
    if (!bill || !isAdmin || !isOpen) return;
    setPromotionSheetOpen(true);
    setPromotionsLoading(true);
    try {
      const result = await promotionService.list();
      setPromotions(result.items.filter((item) => item.active && !item.autoApply));
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setPromotionsLoading(false);
    }
  };

  const choosePromotion = async (promotionId = "") => {
    if (!bill || busy) return;
    setBusy(true);
    try {
      const result = await tableBillingService.applyPromotion(bill.id, promotionId);
      setBill({ ...result.bill, tableName: bill.tableName });
      setPromotionSheetOpen(false);
      openSnackbar({ text: promotionId ? "Đã áp dụng khuyến mại" : "Đã cập nhật khuyến mại tự động", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openCashPaymentSheet = () => {
    if (!bill || !canOperateBill || !isWalletPending) return;
    setPaymentMode("cash");
    setCashReceivedInput("");
    setPaymentDiscountEnabled(false);
    setPaymentDiscountInput("0");
    setPaymentDiscountNoteInput("");
    setPaymentSheetOpen(true);
  };

  const openPendingPaymentSheet = (mode: "wallet" | "transfer") => {
    if (!bill || !(isAdmin || (isStaff && bill.paymentMethod === "transfer")) || !isWalletPending) return;
    setPaymentMode(mode);
    setCashReceivedInput("");
    setPaymentDiscountEnabled(false);
    setPaymentDiscountInput("0");
    setPaymentDiscountNoteInput("");
    setPaymentSheetOpen(true);
  };

  const refresh = async () => {
    if (!bill) return;
    try {
      const result = await sequentialTableName(await tableBillingService.getDetail(bill.id));
      setBill(result);
      setQuantityDraft(draftsFor(result.items));
    } catch {
      // Keep the original action error visible when a follow-up refresh also fails.
    }
  };

  const addProduct = (product: TableBillProduct) => {
    if (product.billingUnit === "hour" && (hasHourlyItem || hasHourlyCartItem)) {
      openSnackbar({ text: "Bàn chỉ được có một mặt hàng tính theo thời gian", type: "warning" });
      return;
    }
    const value = product.billingUnit === "hour" ? 1 : Number(productQuantityDraft[product.id] ?? "1");
    if (product.billingUnit !== "hour" && (!Number.isFinite(value) || value <= 0 || (product.billingUnit === "quantity" && !Number.isInteger(value)))) {
      openSnackbar({ text: product.billingUnit === "quantity" ? "Số lượng phải là số nguyên dương" : "Trọng lượng phải lớn hơn 0", type: "warning" });
      return;
    }
    setCart((current) => ({ ...current, [product.id]: String(product.billingUnit === "hour" ? 1 : (Number(current[product.id]) || 0) + value) }));
    setActiveTab("menu");
    openSnackbar({ text: "Đã thêm vào danh sách tạm", type: "success" });
  };

  const confirmCart = async () => {
    if (!bill || !isOpen || !cartItems.length) return;
    const invalidProduct = cartItems.find((product) => {
      const quantity = Number(cart[product.id]);
      return product.billingUnit !== "hour" && (!Number.isFinite(quantity) || quantity <= 0 || (product.billingUnit === "quantity" && !Number.isInteger(quantity)));
    });
    if (invalidProduct) {
      return void openSnackbar({ text: invalidProduct.billingUnit === "quantity" ? "Số lượng phải là số nguyên dương" : "Trọng lượng phải lớn hơn 0", type: "warning" });
    }
    setBusy(true);
    const initialItemIds = new Set(bill.items.map((item) => item.id));
    const completedProductIds = new Set<string>();
    let pendingProduct: TableBillProduct | null = null;
    try {
      for (const product of cartItems) {
        pendingProduct = product;
        const response = await tableBillingService.addItem(bill.id, product.id, Number(cart[product.id]));
        setBill({ ...response.bill, tableName: bill.tableName });
        setQuantityDraft(draftsFor(response.bill.items));
        setCart((current) => { const next = { ...current }; delete next[product.id]; return next; });
        completedProductIds.add(product.id);
        pendingProduct = null;
      }
      openSnackbar({ text: canOperateBill ? "Đã thêm món vào bill" : "Đã gửi yêu cầu món, vui lòng chờ nhân viên duyệt", type: "success" });
      setCartOpen(false);
      setActiveTab("status");
    } catch (error) {
      if (pendingProduct) {
        try {
          const latest = await tableBillingService.getDetail(bill.id);
          setBill({ ...latest, tableName: bill.tableName });
          setQuantityDraft(draftsFor(latest.items));
          const wasSaved = latest.items.some((item) => !initialItemIds.has(item.id) && item.product === pendingProduct?.id && item.quantity === Number(cart[pendingProduct.id]));
          if (wasSaved) {
            const savedProduct = pendingProduct;
            completedProductIds.add(savedProduct.id);
            setCart((current) => { const next = { ...current }; delete next[savedProduct.id]; return next; });
            const remainingProducts = cartItems.filter((product) => !completedProductIds.has(product.id));
            if (!remainingProducts.length) {
              setCartOpen(false);
              setActiveTab("status");
            }
            const savedMessage = canOperateBill ? "đã được thêm vào bill" : "đã được gửi để nhân viên duyệt";
            openSnackbar({ text: remainingProducts.length ? `${savedProduct.name} ${savedMessage}; các món còn lại vẫn trong danh sách.` : canOperateBill ? "Đã thêm món vào bill" : "Đã gửi yêu cầu món, vui lòng chờ nhân viên duyệt", type: "success" });
            return;
          }
        } catch {
          // Keep the original error when the follow-up bill refresh also fails.
        }
      }
      openSnackbar({ text: `${errorMessage(error)}. Những món đã lưu được giữ nguyên; hãy thử lại với món còn lại.`, type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const updateQuantity = async (itemId: string) => {
    if (!bill || !canEdit || busy) return;
    const quantity = Number(quantityDraft[itemId]);
    const item = bill.items.find((line) => line.id === itemId);
    if (!item || !Number.isFinite(quantity) || quantity <= 0 || (item.billingUnit === "quantity" && !Number.isInteger(quantity))) return;
    if (quantity === item.quantity) return;
    setBusy(true);
    try {
      const response = await tableBillingService.updateItem(bill.id, itemId, quantity);
      setBill({ ...response.bill, tableName: bill.tableName });
      setQuantityDraft(draftsFor(response.bill.items));
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const openTimeEditor = (item: TableBill["items"][number]) => {
    if (!canEdit || busy) return;
    setTimeEditItemId(item.id);
    setTimeStartedInput(localDateTimeInput(item.startedAt));
    setTimeStoppedInput(localDateTimeInput(item.stoppedAt || ""));
  };

  const updateItemTime = async () => {
    if (!bill || !timeEditItemId || !canEdit || busy) return;
    const startedAt = Date.parse(fromVietnamDateTimeInput(timeStartedInput));
    const stoppedAt = timeStoppedInput ? Date.parse(fromVietnamDateTimeInput(timeStoppedInput)) : NaN;
    if (!Number.isFinite(startedAt) || startedAt > Date.now() || (timeStoppedInput && (!Number.isFinite(stoppedAt) || stoppedAt <= startedAt || stoppedAt > Date.now()))) {
      openSnackbar({ text: "Thời gian không hợp lệ; giờ kết thúc phải sau giờ bắt đầu và không ở tương lai", type: "warning" });
      return;
    }
    setBusy(true);
    try {
      const result = await tableBillingService.updateItemTime(bill.id, timeEditItemId, new Date(startedAt).toISOString(), timeStoppedInput ? new Date(stoppedAt).toISOString() : "");
      setBill({ ...result.bill, tableName: bill.tableName });
      setQuantityDraft(draftsFor(result.bill.items));
      setTimeEditItemId("");
      openSnackbar({ text: "Đã cập nhật thời gian mặt hàng", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (itemId: string, reason = "") => {
    if (!bill || !canEdit || busy) return;
    const trimmedReason = reason.trim();
    if ((isStaff && !trimmedReason) || trimmedReason.length > 500) {
      openSnackbar({ text: "Vui lòng nhập lý do xóa, tối đa 500 ký tự", type: "warning" });
      return;
    }
    setBusy(true);
    try {
      const response = await tableBillingService.deleteItem(bill.id, itemId, trimmedReason);
      setBill({ ...response.bill, tableName: bill.tableName });
      setQuantityDraft(draftsFor(response.bill.items));
      setDeletingItem(null);
      setDeleteReason("");
      openSnackbar({ text: "Đã xóa mặt hàng và lưu lịch sử", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const toggleBillingPause = async () => {
    if (!bill) return;
    setBusy(true);
    try {
      const result = await tableBillingService.togglePause(bill.id);
      setBill({ ...result.bill, tableName: bill.tableName });
      setOperationsOpen(false);
      openSnackbar({ text: result.billingPaused ? "Đã tạm dừng tính tiền" : "Đã tiếp tục tính tiền", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const mergeBill = async () => {
    if (!bill || !mergeTargetId) return;
    setBusy(true);
    try {
      const result = await tableBillingService.merge(bill.id, mergeTargetId);
      setOperationsOpen(false);
      setMergeOpen(false);
      setMergeTargetId("");
      setBill(await sequentialTableName(result.bill));
      openSnackbar({ text: "Đã gộp bill thành công", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const transferTable = async () => {
    if (!bill || !transferTableId) return;
    setBusy(true);
    try {
      const result = await tableBillingService.transferTable(bill.id, transferTableId);
      setTransferOpen(false);
      setOperationsOpen(false);
      setTransferTableId("");
      setBill(result.bill);
      navigate(`/bills/${result.bill.id}`, { replace: true });
      openSnackbar({ text: `Đã chuyển bill sang ${result.bill.tableName}`, type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const splitBill = async () => {
    if (!bill || !splitTableId || !splitItemIds.length) return;
    setBusy(true);
    try {
      const result = await tableBillingService.split(bill.id, splitTableId, splitItemIds);
      setSplitOpen(false);
      setOperationsOpen(false);
      setSplitTableId("");
      setSplitItemIds([]);
      navigate(`/bills/${result.bill.id}`, { replace: true });
      openSnackbar({ text: "Đã tách bill thành công", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const splitSession = async () => {
    if (!bill || !isAdmin || !isOpen) return;
    setBusy(true);
    try {
      const result = await tableBillingService.splitSession(bill.id, splitSessionKeepCustomer);
      setSplitSessionOpen(false);
      setCart({});
      setActiveTab("status");
      navigate(`/bills/${result.bill.id}`, { replace: true });
      openSnackbar({ text: "Đã chốt bill và mở bill mới trên cùng bàn", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const requestWallet = async () => {
    if (!bill) return;
    setBusy(true);
    try {
      const result = await tableBillingService.requestWallet(bill.id);
      setBill({ ...result.bill, tableName: bill.tableName });
      setPaymentSheetOpen(false);
      openSnackbar({ text: result.alreadyRequested ? "Yêu cầu thanh toán đang chờ admin duyệt" : "Đã gửi yêu cầu thanh toán ví", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const requestTransfer = async () => {
    if (!bill) return;
    setBusy(true);
    try {
      const result = await tableBillingService.requestTransfer(bill.id);
      setBill({ ...result.bill, tableName: bill.tableName });
      setPaymentSheetOpen(false);
      openSnackbar({ text: result.alreadyRequested ? "Yêu cầu chuyển khoản đang chờ admin xác nhận" : "Đã gửi yêu cầu xác nhận chuyển khoản", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const payManual = async (method: "cash" | "transfer", cashReceived?: number) => {
    if (!bill || busy || !canOperateBill || !paymentDiscountValid || (method === "cash" && (!cashCanConfirm || cashReceived === undefined))) return;
    setBusy(true);
    try {
      const result = await tableBillingService.payManual(bill.id, method, method === "cash" ? cashReceived : undefined, isAdmin ? appliedPaymentDiscountPercent : undefined, isAdmin && paymentDiscountEnabled ? paymentDiscountNoteInput.trim() : "");
      const paidBill = { ...result.bill, tableName: bill.tableName };
      setBill(paidBill);
      setPaymentSuccess(paidBill);
      setPaymentSheetOpen(false);
      setCashReceivedInput("");
      setPaymentDiscountEnabled(false);
      setPaymentDiscountInput("0");
      setPaymentDiscountNoteInput("");
      const discountNotice = result.paymentDiscountPercent ? ` · Chiết khấu ${result.paymentDiscountPercent}% (-${money(result.paymentDiscountAmount || 0)})` : "";
      openSnackbar({ text: `${method === "cash" ? `Đã ghi nhận thanh toán tiền mặt · Tiền thối ${money(result.change || 0)}` : "Đã ghi nhận chuyển khoản"}${discountNotice}`, type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const approveWallet = async () => {
    if (!bill || busy || !isAdmin || !paymentDiscountValid) return;
    setBusy(true);
    try {
      const result = await tableBillingService.approveWallet(bill.id, appliedPaymentDiscountPercent, paymentDiscountEnabled ? paymentDiscountNoteInput.trim() : "");
      const paidBill = { ...result.bill, tableName: bill.tableName };
      setBill(paidBill);
      if (!result.ok) openSnackbar({ text: result.error || "Thanh toán ví thất bại", type: "error" });
      else {
        setPaymentDone({ promoUsed: result.promoUsed, mainUsed: result.mainUsed });
        setPaymentSuccess(paidBill);
        setPaymentSheetOpen(false);
        setPaymentDiscountEnabled(false);
        setPaymentDiscountInput("0");
        setPaymentDiscountNoteInput("");
        const discountNotice = result.paymentDiscountPercent ? ` · Chiết khấu ${result.paymentDiscountPercent}% (-${money(result.paymentDiscountAmount || 0)})` : "";
        openSnackbar({ text: `${result.alreadyPaid ? "Hóa đơn đã được thanh toán" : "Đã duyệt thanh toán ví"}${discountNotice}`, type: "success" });
      }
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const printBill = async () => {
    if (!bill || !canOperateBill) return;
    const popup = window.open("", "_blank");
    if (!popup) { openSnackbar({ text: "Trình duyệt chặn cửa sổ in", type: "error" }); return; }
    try {
      const result = await tableBillingService.recordPrint(bill.id);
      const printable = { ...result.bill, tableName: bill.tableName };
      if (!openBillPrint(printable, storeName, popup)) throw new Error("Trình duyệt chặn cửa sổ in");
      openSnackbar({ text: result.reprinted ? "Đã mở bản in lại" : "Đã mở bản in", type: "success" });
    } catch (error) { popup.close(); openSnackbar({ text: errorMessage(error), type: "error" }); }
  };

  const payLegacyOrder = async () => {
    if (!orderId || !legacyOrder) return;
    setBusy(true);
    try {
      await walletService.payOrder(orderId, `pay-${orderId}`);
      setLegacyOrder(await walletService.getOrder(orderId));
      openSnackbar({ text: "Đã thanh toán hóa đơn bằng ví", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error) || "Không thể thanh toán bằng ví", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Page className="min-h-screen bg-slate-50"><div className="flex justify-center py-16"><Spinner /></div></Page>;
  if (orderId) return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 pb-3 pt-12"><button aria-label="Quay lại" title="Quay lại" onClick={() => navigate(-1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-arrow-left" /></button><Text.Title size="small" className="flex-1">Thanh toán hóa đơn</Text.Title></header>
    <main className="mx-auto max-w-lg space-y-4 px-4 py-5">
      {legacyOrderError ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{legacyOrderError}<button onClick={loadLegacyOrder} className="mt-3 block font-semibold underline">Thử lại</button></div> : legacyOrder && <>
        <section className="space-y-3 border-b border-slate-200 pb-4"><Text size="small" className="text-slate-500">Mã hóa đơn</Text><Text className="break-all font-semibold text-slate-900">{legacyOrder.id}</Text>{legacyOrder.table && <Text size="small" className="text-slate-600">Bàn: {legacyOrder.table}</Text>}</section>
        <section className="flex items-center justify-between"><Text.Title size="small">Tổng cộng</Text.Title><Text.Title size="small" className="text-rose-700">{money(legacyOrder.totalAmount)}</Text.Title></section>
        {legacyOrder.status === "paid" ? <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">Hóa đơn đã thanh toán{legacyOrder.paymentMethod === "wallet" ? " bằng ví" : ""}.</div> : legacyOrder.status !== "unpaid" ? <div className="rounded-lg border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700">Hóa đơn này không còn chờ thanh toán.</div> : <button disabled={busy} onClick={payLegacyOrder} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang xử lý..." : "Thanh toán bằng ví"}</button>}
      </>}
    </main>
  </Page>;
  if (!bill) return null;

  const billStatus = bill.status === "paid" ? "Đã thanh toán" : bill.status === "wallet_pending" || (isStopped && bill.paymentRequested) ? (bill.paymentMethod === "transfer" ? "Chờ xác nhận chuyển khoản" : "Chờ duyệt ví") : bill.status === "stopped" ? "Đã chốt" : bill.status === "cancelled" ? "Đã hủy" : isBillingPaused ? "Đang tạm dừng" : "Đang sử dụng";
  const unitText = (unit: TableBillProduct["billingUnit"]) => unit === "hour" ? "giờ" : unit === "weight" ? "kg" : "lần";
  const priceUnit = (unit: TableBillProduct["billingUnit"], unitLabel: string, intervalMinutes?: number) => unit === "hour" ? formatDuration(intervalMinutes || 60) : unitLabel || unitText(unit);
  const qrReady = !!(paymentSettings?.bankId && paymentSettings.accountNumber && paymentSettings.accountName);
  const qrUrl = qrReady ? `https://img.vietqr.io/image/${encodeURIComponent(paymentSettings.bankId)}-${encodeURIComponent(paymentSettings.accountNumber)}-compact2.png?amount=${Math.round(isAdmin ? paymentDueAmount : bill.totalAmount)}&addInfo=${encodeURIComponent(`Bill ${bill.tableName} ${bill.id}`)}&accountName=${encodeURIComponent(paymentSettings.accountName)}` : "";
  const operationTableName = (tableId: string) => operationMap?.tables.find((table) => table.id === tableId)?.name || "Bàn";
  const mergeOptions = operationMap?.activeBills.filter((item) => item.id !== bill.id) || [];
  const occupiedTableIds = new Set(operationMap?.activeBills.map((item) => item.table) || []);
  const splitOptions = operationMap?.tables.filter((table) => table.status === "available" && !occupiedTableIds.has(table.id)) || [];
  const transferOptions = splitOptions.filter((table) => table.id !== bill.table);

  return <Page className="bill-page flex min-h-0 flex-col overflow-hidden bg-slate-50">
    <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 pb-3 pt-12">
      <button aria-label="Quay lại sơ đồ bàn" title="Quay lại" onClick={() => navigate("/")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-arrow-left" /></button>
      <div className="min-w-0 flex-1"><Text.Title size="small" className="truncate text-slate-900">{bill.tableName}</Text.Title><Text size="xSmall" className="text-slate-500">Bắt đầu {new Date(bill.startedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</Text></div>
      <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${bill.status === "paid" ? "bg-emerald-100 text-emerald-800" : bill.status === "wallet_pending" || (isStopped && bill.paymentRequested) || isBillingPaused ? "bg-amber-100 text-amber-900" : bill.status === "stopped" ? "bg-slate-100 text-slate-700" : "bg-rose-100 text-rose-800"}`}>{billStatus}</span>
      {canManageSettings && isOpen && <button aria-label="Mở menu thao tác bill" title="Thao tác bill" onClick={() => setOperationsOpen(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-more-vert" /></button>}
    </header>

    <div role="tablist" aria-label="Bàn đang chơi" className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-3">
      <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-1">
        <button role="tab" aria-selected={activeTab === "status"} onClick={() => setActiveTab("status")} className={`min-h-10 rounded-md px-3 text-sm font-semibold ${activeTab === "status" ? "bg-emerald-700 text-white" : "text-slate-600"}`}>Tình trạng</button>
        <button role="tab" aria-selected={activeTab === "menu"} onClick={() => setActiveTab("menu")} className={`min-h-10 rounded-md px-3 text-sm font-semibold ${activeTab === "menu" ? "bg-emerald-700 text-white" : "text-slate-600"}`}>Menu{Object.keys(cart).length > 0 ? ` · ${Object.keys(cart).length}` : ""}</button>
      </div>
    </div>

    <main className="mx-auto min-h-0 w-full max-w-4xl flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
      {activeTab === "status" ? <div className="space-y-5">
        <section className="space-y-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800"><GiEightBall size={25} /></div><div className="min-w-0 flex-1"><Text size="small" className="font-semibold text-slate-900">Tình trạng bill</Text><Text size="xSmall" className="text-slate-500">{bill.customer ? "Khách đã được gắn với bàn" : "Bàn chưa gắn tài khoản khách"}</Text></div></div>
          <div><Text size="xSmall" className="text-slate-500">Thời gian bắt đầu</Text><Text size="small" className="mt-1 font-medium text-slate-800">{new Date(bill.startedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</Text></div>
          <div className="space-y-2 border-t border-slate-200 pt-3"><div className="flex items-center justify-between text-sm"><span className="text-slate-600">Tổng tiền trước giảm</span><span className="text-slate-800">{money(bill.grossAmount)}</span></div><div className="flex items-center justify-between text-sm"><span className="text-slate-600">Tiền giảm</span><span className="font-medium text-emerald-800">-{money(bill.discountAmount)}</span></div><div className="flex items-center justify-between"><Text size="small" className="font-semibold text-slate-900">Cần trả</Text><Text.Title size="small" className="text-rose-700">{money(bill.totalAmount)}</Text.Title></div></div>
          {bill.promotion && <div className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3"><Text size="small" className="font-semibold text-emerald-900">{bill.promotion.name}</Text><Text size="xSmall" className="text-emerald-800">Điều kiện đã đạt: {promotionConditions(bill.promotion)}</Text></div>}
          {canManageSettings && isOpen && <button onClick={() => void openPromotionSheet()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-800"><Icon icon="zi-ticket" />Áp dụng khuyến mại</button>}
        </section>

        {sessionSummary && sessionSummary.bills.length > 1 && <section className="space-y-3 border-b border-slate-200 pb-4">
          <Text.Title size="small" className="text-slate-900">Các bill trong phiên</Text.Title>
          <div className="divide-y divide-slate-200 border-y border-slate-200">{sessionSummary.bills.map((item, index) => <button key={item.id} onClick={() => navigate(`/bills/${item.id}`, { replace: true })} className={`flex min-h-14 w-full items-center gap-3 py-2 text-left ${item.id === bill.id ? "text-emerald-900" : "text-slate-800"}`}>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Bill {index + 1}{item.id === bill.id ? " · Đang xem" : ""}</span><span className="mt-1 block text-xs text-slate-500">{item.paymentRequested ? (item.paymentMethod === "transfer" ? "Chờ xác nhận chuyển khoản" : "Chờ duyệt ví") : item.status === "open" ? "Đang chạy" : item.status === "stopped" ? "Đã chốt" : item.status === "paid" ? "Đã thanh toán" : item.status === "cancelled" ? "Đã hủy" : "Đang chờ thanh toán"}</span></span>
            <span className="shrink-0 text-sm font-semibold">{money(item.totalAmount)}</span><Icon icon="zi-chevron-right" className="shrink-0 text-slate-400" />
          </button>)}</div>
          <div className="space-y-2 rounded-md bg-slate-100 p-3 text-sm"><div className="flex items-center justify-between"><span className="text-slate-600">Tổng phiên</span><span className="font-semibold text-slate-900">{money(sessionSummary.totalAmount)}</span></div><div className="flex items-center justify-between"><span className="text-slate-600">Còn phải thu</span><span className="font-semibold text-rose-700">{money(sessionSummary.outstandingAmount)}</span></div></div>
        </section>}

        {isBillingPaused && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Bill đang tạm dừng tính tiền. Thời gian dừng sẽ không được tính vào tiền bàn.</div>}
        {isWalletPending && <div className={`rounded-lg border p-3 text-sm ${bill.paymentError ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{bill.paymentError || (bill.paymentMethod === "transfer" ? "Đang chờ admin xác nhận chuyển khoản." : "Đang chờ admin duyệt ví.")}</div>}
        {bill.status === "paid" && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Đã thanh toán bằng {bill.paymentMethod === "cash" ? "tiền mặt" : bill.paymentMethod === "transfer" ? "chuyển khoản" : "ví"}{bill.paidAt ? ` lúc ${new Date(bill.paidAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}.</div>}

        <section>
          <div className="mb-2 flex items-center justify-between"><Text.Title size="small" className="text-slate-900">Mặt hàng trong bill</Text.Title><button disabled={!canAddItems} onClick={() => setActiveTab("menu")} className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"><Icon icon="zi-plus" />{canOperateBill ? "Thêm món" : "Yêu cầu món"}</button></div>
          {bill.items.length === 0 ? <div className="border-y border-dashed border-slate-300 py-4 text-center text-sm text-slate-500">Chưa có mặt hàng</div> : <div className="divide-y divide-slate-200 border-y border-slate-200">{bill.items.map((item) => <div key={item.id} className="flex items-center gap-2 py-3">
            <div className="min-w-0 flex-1"><Text size="small" className="font-medium text-slate-900">{item.name}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{item.billingUnit === "hour" ? `${quantityText(item.quantity, item.billingUnit)} giờ · Chi tiết tính tiền:` : `${money(item.unitPrice)} / ${priceUnit(item.billingUnit, item.unitLabel, item.timePricing?.intervalMinutes)}`}</Text>{item.queueStatus === "approval_pending" && <Text size="xSmall" className="mt-1 block font-medium text-amber-700">Đang chờ nhân viên duyệt</Text>}{item.queueStatus === "rejected" && <Text size="xSmall" className="mt-1 block font-medium text-rose-700">Đã từ chối · Không tính tiền</Text>}{item.billingUnit === "hour" && (item.timeBreakdown?.length ? <div className="mt-1 space-y-1">{item.timeBreakdown.map((segment) => <div key={`${segment.type}-${segment.startAt}`} className="flex items-start justify-between gap-2"><Text size="xSmall" className="min-w-0 leading-5 text-slate-600">{segment.label} · {dateTime(segment.startAt)}–{dateTime(segment.endAt)} · Dùng {formatDuration(segment.durationMinutes)}{segment.billedDurationMinutes !== segment.durationMinutes ? `, tính ${formatDuration(segment.billedDurationMinutes)}` : ""}</Text><Text size="xSmall" className="shrink-0 font-medium leading-5 text-slate-700">{money(segment.amount)}</Text></div>)}</div> : <Text size="xSmall" className="mt-1 block text-amber-700">Chưa có dữ liệu chi tiết tính giờ.</Text>)}</div>
            {canEdit && item.billingUnit === "hour" && <button disabled={busy} aria-label={`Sửa thời gian ${item.name}`} title="Sửa thời gian" onClick={() => openTimeEditor(item)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50"><FaRegClock size={15} /></button>}
            {canEdit && item.billingUnit !== "hour" ? <input disabled={busy} aria-label={`Số lượng ${item.name}`} type="number" min="0.01" step={item.billingUnit === "quantity" ? 1 : 0.01} inputMode="decimal" value={quantityDraft[item.id] ?? String(item.quantity)} onChange={(event) => setQuantityDraft((current) => ({ ...current, [item.id]: event.target.value }))} onBlur={() => updateQuantity(item.id)} className="w-20 rounded-md border border-slate-300 px-2 py-2 text-right text-sm disabled:opacity-50" /> : item.billingUnit !== "hour" ? <span className="text-sm text-slate-600">× {quantityText(item.quantity, item.billingUnit)} {item.unitLabel}</span> : null}
            <Text size="small" className="w-24 text-right font-semibold text-slate-900">{money(item.lineTotal)}</Text>
            {canEdit && <button disabled={busy} aria-label={`Xóa ${item.name}`} title="Xóa dòng hàng" onClick={() => { if (isStaff) { setDeleteReason(""); setDeletingItem(item); } else void removeItem(item.id); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Icon icon="zi-delete" /></button>}
          </div>)}</div>}
        </section>

        {paymentDone && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Khuyến mại đã dùng {money(paymentDone.promoUsed || 0)}, tài khoản chính đã dùng {money(paymentDone.mainUsed || 0)}.</div>}
        {isWalletPending && (isAdmin || (isStaff && bill.paymentMethod === "transfer")) && <div className="grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => openPendingPaymentSheet(bill.paymentMethod === "wallet" ? "wallet" : "transfer")} className="min-h-11 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{bill.paymentMethod === "wallet" ? "Duyệt trừ ví" : "Xác nhận chuyển khoản"}</button><button disabled={busy} onClick={openCashPaymentSheet} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Ghi nhận tiền mặt</button></div>}
        {bill.status === "paid" && canOperateBill && <button disabled={busy} onClick={() => void printBill()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800"><Icon icon="zi-print" />In bill</button>}
      </div> : <div className="space-y-5">
        <label className="relative block"><span className="sr-only">Tìm mặt hàng</span><Icon icon="zi-search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Tìm mặt hàng" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400" /></label>
        <div className="flex gap-2 overflow-x-auto pb-1">{categories.map((category) => <button key={category} onClick={() => setActiveCategory(category)} className={`min-h-9 shrink-0 rounded-lg px-3 text-sm font-medium ${activeCategory === category ? "bg-emerald-700 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>{category}</button>)}</div>
        {productsLoading ? <div className="flex justify-center py-10"><Spinner /></div> : visibleProducts.length === 0 ? <div className="border-y border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">{products.length ? "Không tìm thấy mặt hàng" : "Chưa có mặt hàng đang bán"}</div> : <div className="divide-y divide-slate-200">{visibleProducts.map((product) => <div key={product.id} className="flex items-center gap-2 py-3"><div className="flex aspect-square w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400">{product.image ? <img src={pb.files.getURL({ id: product.id, collectionName: "products" }, product.image)} alt={`Ảnh ${product.name}`} loading="lazy" className="h-full w-full object-cover" /> : <Icon icon="zi-photo" size={18} />}</div><div className="min-w-0 flex-1"><Text size="small" className="font-medium text-slate-900">{product.name}</Text><Text size="xSmall" className="text-slate-500">{money(product.price)} / {priceUnit(product.billingUnit, product.unitLabel, product.timePricing?.intervalMinutes)}</Text>{product.billingUnit === "hour" && (hasHourlyItem || hasHourlyCartItem) && <Text size="xSmall" className="text-amber-700">Bàn chỉ được có một món tính thời gian</Text>}</div>{product.billingUnit !== "hour" && <input aria-label={`Số lượng ${product.name}`} type="number" min="0.01" step={product.billingUnit === "quantity" ? 1 : 0.01} inputMode="decimal" value={productQuantityDraft[product.id] ?? "1"} onChange={(event) => setProductQuantityDraft((current) => ({ ...current, [product.id]: event.target.value }))} className="w-16 rounded-md border border-slate-300 px-2 py-2 text-right text-sm" />}<button disabled={busy || !canAddItems || (product.billingUnit === "hour" && (hasHourlyItem || hasHourlyCartItem))} aria-label={`Thêm tạm ${product.name}`} title="Thêm vào danh sách tạm" onClick={() => addProduct(product)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white disabled:opacity-50"><Icon icon="zi-plus" /></button></div>)}</div>}
        {!isOpen ? <div className="border-y border-amber-300 bg-amber-50 py-3 text-sm text-amber-900">Bill không còn mở, không thể thêm món.</div> : isBillingPaused ? <div className="border-y border-amber-300 bg-amber-50 py-3 text-sm text-amber-900">Bill đang tạm dừng tính tiền, hãy tiếp tục trước khi thêm món.</div> : null}
      </div>}
    </main>
    {canStartPayment && <footer className="shrink-0 border-t border-slate-200 bg-white px-3 pb-2 pt-3">
      <div className="mx-auto max-w-4xl">
        {activeTab === "menu" ? <button aria-label={`Mở giỏ hàng, ${cartItems.length} mặt hàng, tạm tính ${money(cartTotal)}`} onClick={() => setCartOpen(true)} className="flex min-h-12 w-full flex-col items-center justify-center rounded-lg border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-700"><span className="flex items-center gap-2"><FaShoppingCart size={16} /><span>Giỏ hàng</span><span className="rounded-full bg-slate-100 px-1.5 text-xs">{cartItems.length}</span></span><span className="text-xs font-medium text-slate-500">{money(cartTotal)}{cartItems.some((product) => product.billingUnit === "hour") ? " + giờ" : ""}</span></button> : <button disabled={busy} onClick={() => void openPaymentSheet()} className="flex min-h-12 w-full items-center justify-between rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><span>Thanh toán bill</span><span>{money(bill.totalAmount)}</span></button>}
      </div>
    </footer>}
    <Sheet visible={promotionSheetOpen} onClose={() => !busy && setPromotionSheetOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="max-h-[82vh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><div><Text.Title size="small">Áp dụng khuyến mại</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">{bill.tableName} · {money(bill.totalAmount)}</Text></div><button aria-label="Đóng khuyến mại" onClick={() => setPromotionSheetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        <button disabled={busy} onClick={() => void choosePromotion()} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Bỏ chọn thủ công, tính lại tự động</button>
        {promotionsLoading ? <div className="flex justify-center py-6"><Spinner /></div> : promotions.length ? <div className="divide-y divide-slate-200 border-y border-slate-200">{promotions.map((item) => <button key={item.id} disabled={busy} onClick={() => void choosePromotion(item.id)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left disabled:opacity-50"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"><Icon icon="zi-ticket" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{item.name}</span><span className="mt-1 block text-xs text-slate-500">{promotionValue(item)} · Tối thiểu {money(item.minInvoiceAmount)}</span></span><Icon icon="zi-chevron-right" className="shrink-0 text-slate-400" /></button>)}</div> : <div className="border-y border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">Chưa có chương trình áp dụng thủ công đang hoạt động.</div>}
      </Box>
    </Sheet>
    <Sheet visible={Boolean(deletingItem) && isStaff} onClose={() => !busy && setDeletingItem(null)} autoHeight swipeToClose={!busy} unmountOnClose>
      <Box className="max-h-[85dvh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between gap-3"><Text.Title size="small">Xóa mặt hàng</Text.Title><button disabled={busy} aria-label="Đóng xóa mặt hàng" onClick={() => setDeletingItem(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 disabled:opacity-50"><Icon icon="zi-close" /></button></div>
        <Text size="small" className="break-words text-slate-700">Xóa {deletingItem?.name} khỏi bill {bill.tableName}. Thao tác và lý do sẽ được lưu vào lịch sử.</Text>
        <label htmlFor="delete-item-reason" className="block text-sm font-medium text-slate-700">Lý do xóa <span className="text-rose-700">(bắt buộc)</span><textarea id="delete-item-reason" required maxLength={500} rows={3} disabled={busy} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Nhập lý do xóa mặt hàng" className="mt-2 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 disabled:opacity-50" /></label>
        <div className="grid grid-cols-2 gap-3"><button disabled={busy} onClick={() => setDeletingItem(null)} className="min-h-12 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Hủy</button><button disabled={busy || !canEdit || !deleteReason.trim()} onClick={() => deletingItem && void removeItem(deletingItem.id, deleteReason)} className="min-h-12 rounded-lg bg-rose-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang xóa..." : "Xác nhận xóa"}</button></div>
      </Box>
    </Sheet>
    <Sheet visible={Boolean(timeEditItemId)} onClose={() => !busy && setTimeEditItemId("")} autoHeight swipeToClose unmountOnClose>
      <Box className="flex max-h-[85dvh] flex-col overflow-hidden px-0 pt-0">
        <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4"><div><Text.Title size="small">Sửa thời gian tính tiền</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">{bill.items.find((item) => item.id === timeEditItemId)?.name || bill.tableName}</Text></div><button aria-label="Đóng sửa thời gian" onClick={() => setTimeEditItemId("")} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4">
          <label htmlFor="hour-item-start" className="block text-sm font-medium text-slate-700">Giờ bắt đầu<input id="hour-item-start" type="datetime-local" value={timeStartedInput} onChange={(event) => setTimeStartedInput(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900" /></label>
          <label htmlFor="hour-item-stop" className="block text-sm font-medium text-slate-700">Giờ kết thúc <span className="font-normal text-slate-500">(để trống nếu vẫn đang tính)</span><input id="hour-item-stop" type="datetime-local" value={timeStoppedInput} onChange={(event) => setTimeStoppedInput(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900" /></label>
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"><button disabled={busy || !timeStartedInput} onClick={() => void updateItemTime()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang lưu..." : "Lưu thời gian"}</button></div>
      </Box>
    </Sheet>
    <Sheet visible={paymentSheetOpen && (canStartPayment || (isAdmin && isWalletPending) || (isStaff && isPendingTransfer))} onClose={() => setPaymentSheetOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="flex max-h-[90dvh] flex-col overflow-hidden px-0 pt-0">
        <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4"><div><Text.Title size="small">Thanh toán bill</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">{bill.tableName} · {money(bill.totalAmount)}</Text></div><button aria-label="Đóng thanh toán" onClick={() => setPaymentSheetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4">
          {!isWalletPending && <div className={`grid ${isStaff ? "grid-cols-2" : "grid-cols-3"} rounded-lg border border-slate-200 bg-white p-1`}>
            <button aria-pressed={paymentMode === "qr"} onClick={() => setPaymentMode("qr")} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${paymentMode === "qr" ? "bg-emerald-700 text-white" : "text-slate-600"}`}>Mã QR</button>
            {!isStaff && <button aria-pressed={paymentMode === "wallet"} onClick={() => setPaymentMode("wallet")} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${paymentMode === "wallet" ? "bg-emerald-700 text-white" : "text-slate-600"}`}>Trừ vào ví</button>}
            <button aria-pressed={paymentMode === "cash"} onClick={() => setPaymentMode("cash")} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${paymentMode === "cash" ? "bg-emerald-700 text-white" : "text-slate-600"}`}>Tiền mặt</button>
          </div>}
          {isAdmin && <section className="space-y-2 rounded-lg border border-slate-200 p-3">
            <label className="flex min-h-10 items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={paymentDiscountEnabled} onChange={(event) => setPaymentDiscountEnabled(event.target.checked)} className="h-5 w-5 accent-emerald-700" />Áp dụng chiết khấu</label>
            {paymentDiscountEnabled && <>
              <label htmlFor="payment-discount" className="block text-sm font-medium text-slate-700">Chiết khấu (%)<input id="payment-discount" type="number" min="0" max="100" step="1" inputMode="numeric" value={paymentDiscountInput} onChange={(event) => setPaymentDiscountInput(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-right text-base font-semibold" /></label>
              <div className="grid grid-cols-5 gap-2">{[0, 5, 10, 15, 20].map((percent) => <button key={percent} type="button" aria-pressed={paymentDiscountInput === String(percent)} onClick={() => setPaymentDiscountInput(String(percent))} className={`min-h-10 rounded-md border px-2 text-sm font-semibold ${paymentDiscountInput === String(percent) ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{percent}%</button>)}</div>
              <label htmlFor="payment-discount-note" className="block text-sm font-medium text-slate-700">Ghi chú chiết khấu (không bắt buộc)<input id="payment-discount-note" type="text" maxLength={200} value={paymentDiscountNoteInput} onChange={(event) => setPaymentDiscountNoteInput(event.target.value)} placeholder="Ví dụ: khách quen" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" /></label>
              {!paymentDiscountValid && <Text size="xSmall" className="text-rose-700">Nhập số nguyên từ 0 đến 100.</Text>}
            </>}
          </section>}
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center justify-between text-sm"><span className="text-slate-600">Tổng tiền trước giảm</span><span className="text-slate-700">{money(bill.grossAmount)}</span></div><div className="flex items-center justify-between text-sm"><span className="text-slate-600">Khuyến mại</span><span className="font-semibold text-emerald-800">-{money(bill.discountAmount)}</span></div>{bill.promotion && <div className="space-y-1 border-t border-emerald-200 pt-2"><div className="text-sm font-semibold text-emerald-900">{bill.promotion.name}</div><Text size="xSmall" className="text-emerald-800">Điều kiện đã đạt: {promotionConditions(bill.promotion)}</Text></div>}<div className="flex items-center justify-between border-t border-emerald-200 pt-2 text-sm"><span className="text-slate-600">Tạm tính sau khuyến mại</span><span className="text-slate-700">{money(bill.totalAmount)}</span></div>{isAdmin && paymentDiscountEnabled && <div className="flex items-center justify-between text-sm"><span className="text-slate-600">Chiết khấu thanh toán ({paymentDiscountValid ? appliedPaymentDiscountPercent : 0}%)</span><span className="font-semibold text-emerald-800">-{money(paymentDiscountAmount)}</span></div>}<div className="flex items-center justify-between border-t border-emerald-200 pt-2 text-sm font-semibold"><span className="text-slate-800">Cần trả</span><span className="text-rose-700">{money(paymentDueAmount)}</span></div></div>
          {isWalletPending && paymentMode !== "cash" ? <div className="flex items-center justify-between text-sm"><span className="text-slate-600">Khách cần trả</span><span className="font-semibold text-slate-900">{money(paymentDueAmount)}</span></div> : paymentMode === "qr" ? paymentSettingsLoading ? <div className="flex justify-center py-6"><Spinner /></div> : paymentSettingsError ? <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">Không thể tải tài khoản nhận QR: {paymentSettingsError}</div> : qrReady ? <div className="space-y-3 text-center"><img src={qrUrl} alt="Mã QR thanh toán cho bill bàn" className="mx-auto aspect-square w-52 max-w-full rounded-lg border border-slate-200 bg-white object-contain" /><Text size="small" className="font-semibold text-slate-900">{paymentSettings.accountName}</Text><Text size="xSmall" className="text-slate-600">{paymentSettings.bankId} · {paymentSettings.accountNumber}</Text><Text size="small" className="font-semibold text-rose-700">{money(isAdmin ? paymentDueAmount : payableAmount)}</Text><Text size="xSmall" className="text-slate-500">Nội dung: Bill {bill.tableName} {bill.id}</Text>{!isAdmin && <Text size="xSmall" className="text-slate-500">Yêu cầu sẽ được gửi tới admin để kiểm tra và xác nhận.</Text>}</div> : <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Chưa cấu hình tài khoản nhận QR. Admin hãy nhập thông tin trong mục Tài khoản.</div> : paymentMode === "wallet" ? <div className="space-y-3"><Text size="small" className="text-slate-600">Số tiền sẽ được trừ từ ví của bạn khi admin duyệt yêu cầu.</Text>{isAdmin && bill.customer && <Text size="small" className="text-slate-600">Bill đang gắn với tài khoản khách; yêu cầu mới vẫn dùng ví của người gửi.</Text>}</div> : <div className="space-y-4">
            <div className="flex items-center justify-between"><Text size="small" className="text-slate-600">Khách cần trả</Text><Text size="small" className="font-semibold text-slate-900">{money(isAdmin ? paymentDueAmount : bill.totalAmount)}</Text></div>
            {canOperateBill ? <>
              <label htmlFor="cash-received" className="block text-sm font-medium text-slate-700">Tiền khách đưa (không bắt buộc)<input id="cash-received" type="text" inputMode="numeric" value={formatMoneyInput(cashReceivedInput)} onChange={(event) => handleMoneyInput(event, setCashReceivedInput)} placeholder="Để trống nếu khách đưa vừa đủ" className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-right text-lg font-semibold text-slate-900 placeholder:text-base placeholder:font-normal" /></label>
              <div className="grid grid-cols-3 gap-2">{cashDenominations.map((amount) => <button key={amount} type="button" onClick={() => setCashReceivedInput(String((Number(cashReceivedInput) || 0) + amount))} className="min-h-11 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-sm font-semibold text-emerald-800 active:bg-emerald-100">+{money(amount)}</button>)}</div>
              <div aria-live="polite" className={`rounded-lg border p-3 ${cashShortfall ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>{!cashReceivedValid ? <Text size="small" className="text-slate-700">Nhập số tiền khách đưa</Text> : cashShortfall ? <div className="flex items-center justify-between gap-2 text-sm"><span className="text-amber-900">Còn thiếu</span><span className="font-semibold text-amber-900">{money(cashShortfall)}</span></div> : <div className="flex items-center justify-between gap-2 text-sm"><span className="text-emerald-900">Tiền thối</span><span className="font-semibold text-emerald-900">{money(cashChange)}</span></div>}</div>
            </> : <Text size="small" className="text-slate-600">Vui lòng trả tiền mặt cho nhân viên tại quầy.</Text>}
          </div>}
        </div>
        {((isWalletPending && paymentMode !== "cash") || (paymentMode === "qr" && qrReady) || (paymentMode === "wallet" && !isAdmin) || (paymentMode === "cash" && canOperateBill)) && <div className="shrink-0 border-t border-slate-200 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
          {isWalletPending && paymentMode !== "cash" ? <button disabled={busy || !paymentDiscountValid} onClick={bill.paymentMethod === "wallet" ? approveWallet : () => payManual("transfer")} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang xử lý..." : bill.paymentMethod === "wallet" ? "Duyệt trừ ví" : "Xác nhận chuyển khoản"}</button> : paymentMode === "qr" ? <button disabled={busy || (canOperateBill && !paymentDiscountValid)} onClick={canOperateBill ? () => payManual("transfer") : requestTransfer} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang xử lý..." : canOperateBill ? "Xác nhận chuyển khoản" : "Tôi đã chuyển khoản"}</button> : paymentMode === "wallet" ? <button disabled={busy} onClick={requestWallet} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang gửi yêu cầu..." : "Xác nhận trừ vào ví"}</button> : <button disabled={busy || !cashCanConfirm} onClick={() => void payManual("cash", cashReceivedValue)} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Đang xử lý..." : "Xác nhận đã thu tiền mặt"}</button>}
        </div>}
      </Box>
    </Sheet>
    <Sheet visible={Boolean(paymentSuccess)} onClose={() => setPaymentSuccess(null)} autoHeight swipeToClose unmountOnClose>
      {paymentSuccess && <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Icon icon="zi-check" /></span><div><Text.Title size="small">Thanh toán thành công</Text.Title><Text size="xSmall" className="mt-1 block text-slate-500">Bill đã được chốt và lưu để in lại.</Text></div></div><div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-slate-800"><div className="flex justify-between gap-3"><span>Mã bill</span><strong className="break-all text-right">{paymentSuccess.id}</strong></div><div className="flex justify-between gap-3"><span>Bàn</span><strong>{paymentSuccess.tableName}</strong></div><div className="flex justify-between gap-3"><span>Tổng tiền</span><strong>{money(paymentSuccess.totalAmount)}</strong></div><div className="flex justify-between gap-3"><span>Phương thức</span><strong>{paymentSuccess.paymentMethod === "cash" ? "Tiền mặt" : paymentSuccess.paymentMethod === "transfer" ? "Chuyển khoản" : "Ví"}</strong></div><div className="flex justify-between gap-3"><span>Người thu</span><strong>{paymentSuccess.paidByName || user?.fullname || user?.username || "Nhân viên cửa hàng"}</strong></div></div><div className="grid grid-cols-2 gap-2"><button onClick={() => void printBill()} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 text-sm font-semibold text-emerald-800"><Icon icon="zi-print" />In bill</button><button onClick={() => setPaymentSuccess(null)} className="min-h-11 rounded-lg bg-emerald-700 px-2 text-sm font-semibold text-white">Đóng</button></div></Box>}
    </Sheet>
    <Sheet visible={operationsOpen} onClose={() => setOperationsOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="space-y-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><div><Text.Title size="small">Thao tác bill</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">{bill.tableName}</Text></div><button aria-label="Đóng menu thao tác" onClick={() => setOperationsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        <button disabled={busy} onClick={() => void toggleBillingPause()} className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-800 disabled:opacity-50"><Icon icon={isBillingPaused ? "zi-play" : "zi-pause"} className="text-amber-700" /><span>{isBillingPaused ? "Tiếp tục tính tiền" : "Tạm dừng tính tiền"}</span></button>
        <button disabled={busy} onClick={() => { setOperationsOpen(false); setTransferOpen(true); }} className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-800 disabled:opacity-50"><Icon icon="zi-arrow-right" className="text-sky-700" /><span>Chuyển bàn</span></button>
        <button disabled={busy || isBillingPaused} onClick={() => { setOperationsOpen(false); setMergeOpen(true); }} className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-800 disabled:opacity-50"><Icon icon="zi-merge" className="text-emerald-700" /><span>Gộp bill</span></button>
        <button disabled={busy || isBillingPaused} onClick={() => { setOperationsOpen(false); setSplitOpen(true); }} className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-800 disabled:opacity-50"><Icon icon="zi-split" className="text-sky-700" /><span>Tách món sang bàn khác</span></button>
        <button disabled={busy} onClick={() => { setOperationsOpen(false); setSplitSessionKeepCustomer(true); setSplitSessionOpen(true); }} className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-800 disabled:opacity-50"><Icon icon="zi-check" className="text-rose-700" /><span>Tách phiên bill</span></button>
      </Box>
    </Sheet>
    <Sheet visible={transferOpen} onClose={() => setTransferOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><div><Text.Title size="small">Chuyển bàn</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">Bill hiện tại: {bill.tableName}</Text></div><button aria-label="Đóng chuyển bàn" onClick={() => setTransferOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        <label className="block text-sm font-medium text-slate-700">Bàn nhận bill<select value={transferTableId} onChange={(event) => setTransferTableId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"><option value="">Chọn bàn trống</option>{transferOptions.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label>
        {transferOptions.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 py-5 text-center text-sm text-slate-500">Không có bàn trống để chuyển bill.</div>}
        <button disabled={busy || !transferTableId} onClick={() => void transferTable()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang chuyển..." : "Xác nhận chuyển bàn"}</button>
      </Box>
    </Sheet>
    <Sheet visible={mergeOpen} onClose={() => setMergeOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><div><Text.Title size="small">Gộp bill</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">Chọn bill đích để giữ lại</Text></div><button aria-label="Đóng gộp bill" onClick={() => setMergeOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        {mergeOptions.length ? <div className="space-y-2">{mergeOptions.map((item) => <label key={item.id} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 ${mergeTargetId === item.id ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}><input type="radio" name="merge-target" checked={mergeTargetId === item.id} onChange={() => setMergeTargetId(item.id)} /><span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{operationTableName(item.table)}</span><span className="text-xs text-slate-500">Bill đang mở</span></label>)}</div> : <div className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">Không có bill đang mở khác để gộp.</div>}
        <button disabled={busy || !mergeTargetId} onClick={() => void mergeBill()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang gộp..." : "Xác nhận gộp bill"}</button>
      </Box>
    </Sheet>
    <Sheet visible={splitOpen} onClose={() => setSplitOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><div><Text.Title size="small">Tách món sang bàn khác</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">Chọn món và bàn mới</Text></div><button aria-label="Đóng tách bill" onClick={() => setSplitOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        <label className="block text-sm font-medium text-slate-700">Bàn nhận bill mới<select value={splitTableId} onChange={(event) => setSplitTableId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"><option value="">Chọn bàn trống</option>{splitOptions.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label>
        <div className="space-y-2">{bill.items.length ? bill.items.map((item) => <label key={item.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${splitItemIds.includes(item.id) ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}><input type="checkbox" checked={splitItemIds.includes(item.id)} onChange={() => setSplitItemIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{item.name}</span><span className="shrink-0 text-sm text-slate-600">{money(item.lineTotal)}</span></label>) : <div className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">Bill chưa có mặt hàng để tách.</div>}</div>
        <button disabled={busy || !splitTableId || !splitItemIds.length} onClick={() => void splitBill()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang tách..." : "Xác nhận chuyển món"}</button>
      </Box>
    </Sheet>
    <Sheet visible={splitSessionOpen} onClose={() => !busy && setSplitSessionOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><div><Text.Title size="small">Tách phiên bill</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">Chốt {bill.tableName} và mở bill trống cùng bàn</Text></div><button aria-label="Đóng tách phiên" onClick={() => setSplitSessionOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        {bill.customer ? <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium text-slate-700">Khách trên bill mới</legend><label className="flex min-h-12 items-center gap-3 rounded-md border border-slate-200 px-3"><input type="radio" name="split-session-customer" checked={splitSessionKeepCustomer} onChange={() => setSplitSessionKeepCustomer(true)} /><span className="text-sm text-slate-800">Giữ khách hiện tại</span></label><label className="flex min-h-12 items-center gap-3 rounded-md border border-slate-200 px-3"><input type="radio" name="split-session-customer" checked={!splitSessionKeepCustomer} onChange={() => setSplitSessionKeepCustomer(false)} /><span className="text-sm text-slate-800">Bỏ khách khỏi bill mới</span></label></fieldset> : <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Bill mới sẽ không gắn tài khoản khách.</div>}
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Bill hiện tại được chốt và giữ riêng để thanh toán sau. Bill mới bắt đầu tính tiền từ lúc tách.</div>
        <button disabled={busy} onClick={() => void splitSession()} className="min-h-12 w-full rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang tách phiên..." : "Chốt bill và mở bill mới"}</button>
      </Box>
    </Sheet>
    <Sheet visible={cartOpen} onClose={() => setCartOpen(false)} autoHeight swipeToClose unmountOnClose>
      <Box className="flex max-h-[86vh] flex-col px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-4">
        <div className="mb-3 flex shrink-0 items-center justify-between"><div><Text.Title size="small" className="text-slate-900">Giỏ hàng</Text.Title><Text size="xSmall" className="mt-1 text-slate-500">{cartItems.length} mặt hàng cần xác nhận</Text></div><button aria-label="Đóng giỏ hàng" onClick={() => setCartOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-close" /></button></div>
        {cartItems.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">Giỏ hàng đang trống</div> : <div className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto">{cartItems.map((product) => <div key={product.id} className="flex items-center gap-2 py-3">
          <div className="min-w-0 flex-1"><Text size="small" className="font-medium text-slate-900">{product.name}</Text><Text size="xSmall" className="mt-1 block text-slate-500">{money(product.price)} / {priceUnit(product.billingUnit, product.unitLabel, product.timePricing?.intervalMinutes)}</Text>{product.billingUnit === "hour" && <Text size="xSmall" className="mt-1 block text-slate-500">Bắt đầu tính sau khi xác nhận</Text>}</div>
          {product.billingUnit !== "hour" && <input aria-label={`Số lượng ${product.name}`} type="number" min="0.01" step={product.billingUnit === "quantity" ? 1 : 0.01} inputMode="decimal" value={cart[product.id]} onChange={(event) => setCart((current) => ({ ...current, [product.id]: event.target.value }))} className="w-20 rounded-md border border-slate-300 bg-white px-2 py-2 text-right text-sm" />}
          <Text size="xSmall" className="w-20 text-right font-semibold text-slate-700">{product.billingUnit === "hour" ? "Theo giờ" : money(product.price * (Number(cart[product.id]) || 0))}</Text>
          <button aria-label={`Bỏ ${product.name} khỏi giỏ hàng`} title="Bỏ khỏi giỏ hàng" onClick={() => setCart((current) => { const next = { ...current }; delete next[product.id]; return next; })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-rose-700"><Icon icon="zi-delete" /></button>
        </div>)}</div>}
        {cartItems.length > 0 && <div className="mt-3 shrink-0 space-y-3 border-t border-slate-200 pt-3"><div className="flex items-center justify-between"><Text size="small" className="font-semibold text-slate-800">Tạm tính món</Text><Text size="small" className="font-semibold text-rose-700">{money(cartTotal)}{cartItems.some((product) => product.billingUnit === "hour") ? " + tính giờ" : ""}</Text></div>{!isOpen ? <Text size="xSmall" className="block text-amber-800">Bill không còn mở, không thể xác nhận món.</Text> : isBillingPaused ? <Text size="xSmall" className="block text-amber-800">Bill đang tạm dừng tính tiền, hãy tiếp tục trước khi xác nhận món.</Text> : !canOperateBill ? <Text size="xSmall" className="block text-amber-800">Món chỉ được tính vào bill sau khi nhân viên duyệt.</Text> : null}<button disabled={busy || !canAddItems} onClick={() => void confirmCart()} className="flex min-h-12 w-full items-center justify-between rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><span>{busy ? "Đang xác nhận..." : canOperateBill ? "Thêm món vào bill" : "Gửi yêu cầu món"}</span><span>{money(cartTotal)}{cartItems.some((product) => product.billingUnit === "hour") ? " + giờ" : ""}</span></button></div>}
      </Box>
    </Sheet>
  </Page>;
}
