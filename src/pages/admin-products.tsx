import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Box, Icon, Page, Sheet, Spinner, Text, useSnackbar } from "zmp-ui";
import { Navigate, useNavigate } from "react-router-dom";

import { productCategoryService, productService } from "@/api/services";
import pb, { type Product, type ProductCategory, type ProductInput, type ProductTimePricing } from "@/api/pocketbase";
import { useAuth } from "@/contexts/AuthContext";
import { formatDuration, formatMoneyInput, handleMoneyInput } from "@/utils/format";
import AdminNav from "@/components/admin-nav";
import PinnedPageHeader from "@/components/pinned-page-header";

type DurationForm = { days: string; hours: string; minutes: string };
type ProductForm = {
  name: string;
  categoryId: string;
  price: string;
  purchasePrice: string;
  billingMode: "quantity" | "time";
  kind: Product["kind"];
  requiresPreparation: boolean;
  unitLabel: string;
  description: string;
  interval: DurationForm;
  firstEnabled: boolean;
  firstPrice: string;
  firstDuration: DurationForm;
  specialEnabled: boolean;
  specialName: string;
  specialPrice: string;
  specialDuration: DurationForm;
  specialAllDay: boolean;
  specialStart: string;
  specialEnd: string;
  specialWeekdays: number[];
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

async function compressImage(file: File): Promise<File> {
  if (file.size <= MAX_IMAGE_SIZE) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Không thể đọc ảnh này"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Không thể xử lý ảnh");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    for (let attempt = 0; attempt < 12; attempt++) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
      if (blob && blob.size <= MAX_IMAGE_SIZE) {
        const extension = type === "image/png" ? ".png" : ".jpg";
        return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}${extension}`, { type });
      }
      const nextScale = Math.max(320 / Math.max(image.width, image.height), 0.8 ** (attempt + 1));
      canvas.width = Math.round(image.width * nextScale);
      canvas.height = Math.round(image.height * nextScale);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    throw new Error("Ảnh vẫn vượt quá 5 MB sau khi nén");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const WEEKDAYS = [
  { value: 1, label: "Thứ 2" },
  { value: 2, label: "Thứ 3" },
  { value: 3, label: "Thứ 4" },
  { value: 4, label: "Thứ 5" },
  { value: 5, label: "Thứ 6" },
  { value: 6, label: "Thứ 7" },
  { value: 0, label: "Chủ nhật" },
];

const emptyDuration = (): DurationForm => ({ days: "0", hours: "1", minutes: "0" });
const emptyForm = (): ProductForm => ({
  name: "",
  categoryId: "",
  price: "",
  purchasePrice: "",
  billingMode: "quantity",
  kind: "goods",
  requiresPreparation: false,
  unitLabel: "",
  description: "",
  interval: emptyDuration(),
  firstEnabled: false,
  firstPrice: "",
  firstDuration: emptyDuration(),
  specialEnabled: false,
  specialName: "",
  specialPrice: "",
  specialDuration: emptyDuration(),
  specialAllDay: true,
  specialStart: "17:00",
  specialEnd: "22:00",
  specialWeekdays: [1, 2, 3, 4, 5],
});

const money = (value: number) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;
const categoryLabel = (product: Product) => product.category?.trim() || "Khác";
const categorySort = (items: ProductCategory[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, "vi"));
const cleanSearch = (value: string) => value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
const durationMinutes = (value: DurationForm) => Number(value.days) * 1440 + Number(value.hours) * 60 + Number(value.minutes);
const validDuration = (value: DurationForm) => {
  const days = Number(value.days);
  const hours = Number(value.hours);
  const minutes = Number(value.minutes);
  const total = durationMinutes(value);
  return Number.isInteger(days) && days >= 0 && days <= 365 && Number.isInteger(hours) && hours >= 0 && hours <= 23 && Number.isInteger(minutes) && minutes >= 0 && minutes <= 59 && total > 0 && total <= 525600;
};

function errorMessage(error: any) {
  const response = error?.response;
  const data = response?.data;
  const fieldErrors = data && typeof data === "object"
    ? Object.entries(data)
      .map(([field, detail]: [string, any]) => {
        const message = detail?.message || detail?.data?.message || detail;
        return message && typeof message !== "object" ? `${field}: ${message}` : "";
      })
      .filter(Boolean)
      .join("; ")
    : "";
  return fieldErrors || data?.message || response?.message || error?.message || "Không thể lưu dữ liệu mặt hàng";
}

function getTimePricing(value?: ProductTimePricing | null): ProductTimePricing {
  let source: any = value || {};
  if (typeof source === "string") {
    try { source = JSON.parse(source || "{}"); } catch { source = {}; }
  }
  return {
    intervalMinutes: Number(source.intervalMinutes) || 60,
    firstPeriod: source.firstPeriod || null,
    specialPeriod: source.specialPeriod || null,
  };
}

function durationParts(minutes: number): DurationForm {
  const value = Math.max(1, Math.floor(minutes || 60));
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  return { days: String(days), hours: String(hours), minutes: String(value % 60) };
}

function DurationFields({ label, value, onChange }: { label: string; value: DurationForm; onChange: (field: keyof DurationForm, value: string) => void }) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium text-slate-700">{label}</legend>
    <div className="grid grid-cols-3 gap-2">
      {(["days", "hours", "minutes"] as const).map((field) => <label key={field} className="block text-xs text-slate-500">
        {field === "days" ? "Ngày" : field === "hours" ? "Giờ" : "Phút"}
        <input aria-label={`${label}, ${field}`} type="number" min={0} max={field === "days" ? 365 : field === "hours" ? 23 : 59} step={1} inputMode="numeric" value={value[field]} onChange={(event) => onChange(field, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900" />
      </label>)}
    </div>
  </fieldset>;
}

export default function AdminProductsPage() {
  const { user, storeId } = useAuth();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [autoOpenSheetOpen, setAutoOpenSheetOpen] = useState(false);
  const [autoOpenItems, setAutoOpenItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [autoOpenDraft, setAutoOpenDraft] = useState<Record<string, string>>({});
  const [savingAutoOpen, setSavingAutoOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [filePreview, setFilePreview] = useState("");
  const [savedImageUrl, setSavedImageUrl] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const load = async () => {
    if (!storeId) {
      setItems([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    try {
      const [products, categoryItems, autoOpen] = await Promise.all([
        productService.listAdmin(storeId),
        productCategoryService.list(storeId),
        pb.send<{ items: { productId: string; quantity: number }[] }>("/api/table-billing/auto-open-products", { method: "GET" }),
      ]);
      setItems(products);
      setCategories(categorySort(categoryItems));
      setAutoOpenItems(autoOpen.items || []);
      setAutoOpenDraft(Object.fromEntries((autoOpen.items || []).map((item) => [item.productId, String(item.quantity)])));
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user?.role === "admin") void load(); }, [user?.id, storeId]);

  useEffect(() => {
    if (!imageFile) {
      setFilePreview("");
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const visibleItems = useMemo(() => {
    const search = cleanSearch(query.trim());
    return items.filter((product) => {
      const category = categoryLabel(product);
      if (categoryFilter && category !== categories.find((item) => item.id === categoryFilter)?.name) return false;
      if (!search) return true;
      return cleanSearch(`${product.name} ${category} ${product.description || ""}`).includes(search);
    });
  }, [items, categories, categoryFilter, query]);

  if (user?.role !== "admin") return <Navigate to="/" replace />;

  const openNew = () => {
    setEditing(null);
    setImageFile(null);
    setSavedImageUrl("");
    setForm({ ...emptyForm(), categoryId: categories[0]?.id || "" });
    setSheetOpen(true);
  };

  const openEdit = (product: Product) => {
    const pricing = getTimePricing(product.time_pricing);
    const categoryId = categories.find((category) => category.name.toLocaleLowerCase("vi") === categoryLabel(product).toLocaleLowerCase("vi"))?.id || "";
    setEditing(product);
    setImageFile(null);
    setSavedImageUrl(product.image ? pb.files.getURL(product, product.image) : "");
    setForm({
      ...emptyForm(),
      name: product.name,
      categoryId,
      price: String(product.price),
      purchasePrice: String(product.purchase_price ?? ""),
      billingMode: product.billing_unit === "hour" ? "time" : "quantity",
      kind: product.kind || (product.billing_unit === "hour" ? "service" : "goods"),
      requiresPreparation: product.billing_unit !== "hour" && product.requires_preparation === true,
      unitLabel: product.unit_label || "",
      description: product.description || "",
      interval: durationParts(pricing.intervalMinutes),
      firstEnabled: !!pricing.firstPeriod,
      firstPrice: pricing.firstPeriod ? String(pricing.firstPeriod.price) : "",
      firstDuration: durationParts(pricing.firstPeriod?.durationMinutes || 60),
      specialEnabled: !!pricing.specialPeriod,
      specialName: pricing.specialPeriod?.name || "",
      specialPrice: pricing.specialPeriod ? String(pricing.specialPeriod.price) : "",
      specialDuration: durationParts(pricing.specialPeriod?.durationMinutes || pricing.intervalMinutes),
      specialAllDay: pricing.specialPeriod?.allDay ?? true,
      specialStart: pricing.specialPeriod?.startTime || "17:00",
      specialEnd: pricing.specialPeriod?.endTime || "22:00",
      specialWeekdays: pricing.specialPeriod?.weekdays || [1, 2, 3, 4, 5],
    });
    setSheetOpen(true);
  };

  const save = async () => {
    const price = Number(form.price);
    const purchasePrice = Number(form.purchasePrice);
    const category = categories.find((item) => item.id === form.categoryId);
    if (!form.name.trim() || !category || !form.price.trim() || !Number.isInteger(price) || price < 0) {
      openSnackbar({ text: "Vui lòng nhập tên, chọn danh mục và nhập giá nguyên không âm", type: "warning" });
      return;
    }
    if (items.some((product) => product.id !== editing?.id && product.name.trim().toLocaleLowerCase("vi") === form.name.trim().toLocaleLowerCase("vi"))) {
      openSnackbar({ text: "Mặt hàng cùng tên đã tồn tại", type: "warning" });
      return;
    }
    if (form.billingMode === "quantity" && form.purchasePrice.trim() && (!Number.isInteger(purchasePrice) || purchasePrice < 0)) {
      openSnackbar({ text: "Giá nhập phải là số nguyên không âm", type: "warning" });
      return;
    }

    let timePricing: ProductTimePricing | null = null;
    if (form.billingMode === "time") {
      if (!validDuration(form.interval)) {
        openSnackbar({ text: "Khoảng tính thường phải từ 1 phút đến 365 ngày", type: "warning" });
        return;
      }
      if (form.firstEnabled && (!form.firstPrice.trim() || !Number.isInteger(Number(form.firstPrice)) || Number(form.firstPrice) < 0 || !validDuration(form.firstDuration))) {
        openSnackbar({ text: "Vui lòng kiểm tra giá và thời gian áp dụng đầu tiên", type: "warning" });
        return;
      }
      if (form.specialEnabled) {
        const specialPrice = Number(form.specialPrice);
        const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!form.specialName.trim() || form.specialName.trim().length > 80 || !form.specialPrice.trim() || !Number.isInteger(specialPrice) || specialPrice < 0 || !validDuration(form.specialDuration) || !form.specialWeekdays.length || (!form.specialAllDay && (!validTime.test(form.specialStart) || !validTime.test(form.specialEnd) || form.specialEnd <= form.specialStart))) {
          openSnackbar({ text: "Vui lòng kiểm tra giờ đặc biệt, giá bán và các ngày áp dụng", type: "warning" });
          return;
        }
      }
      timePricing = {
        intervalMinutes: durationMinutes(form.interval),
        firstPeriod: form.firstEnabled ? { price: Number(form.firstPrice), durationMinutes: durationMinutes(form.firstDuration) } : null,
        specialPeriod: form.specialEnabled ? {
          name: form.specialName.trim(),
          price: Number(form.specialPrice),
          durationMinutes: durationMinutes(form.specialDuration),
          allDay: form.specialAllDay,
          startTime: form.specialAllDay ? "" : form.specialStart,
          endTime: form.specialAllDay ? "" : form.specialEnd,
          weekdays: [...form.specialWeekdays].sort((a, b) => a - b),
        } : null,
      };
    }

    if (!storeId) return;
    setSaving(true);
    try {
      const data: ProductInput = {
        store: storeId,
        name: form.name.trim(),
        category: category.name,
        price,
        purchase_price: form.billingMode === "quantity" && form.purchasePrice.trim() ? purchasePrice : 0,
        kind: form.kind,
        requires_preparation: form.requiresPreparation,
        billing_unit: form.billingMode === "time" ? "hour" as const : "quantity" as const,
        unit_label: form.billingMode === "time" ? "giờ" : form.unitLabel.trim(),
        description: form.description.trim(),
        is_active: editing?.is_active ?? true,
      };
      if (timePricing) data.time_pricing = timePricing;
      if (imageFile) data.image = imageFile;
      if (editing) await productService.update(editing.id, data);
      else await productService.create(data);
      setSheetOpen(false);
      setImageFile(null);
      setSavedImageUrl("");
      if (imageInputRef.current) imageInputRef.current.value = "";
      await load();
      openSnackbar({ text: editing ? "Đã cập nhật mặt hàng" : "Đã thêm mặt hàng", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (product: Product) => {
    try {
      await productService.update(product.id, { is_active: !product.is_active });
      await load();
      openSnackbar({ text: product.is_active ? "Đã ngừng bán mặt hàng" : "Đã mở bán mặt hàng", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    }
  };

  const deleteProduct = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await productService.delete(deleting.id);
      setDeleting(null);
      await load();
      openSnackbar({ text: "Đã xóa mặt hàng", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async (event: FormEvent) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!storeId || !name) return;
    if (name.length > 80) {
      openSnackbar({ text: "Tên danh mục tối đa 80 ký tự", type: "warning" });
      return;
    }
    if (categories.some((item) => item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
      openSnackbar({ text: "Danh mục này đã tồn tại", type: "warning" });
      return;
    }
    setSavingCategory(true);
    try {
      const created = await productCategoryService.create({ store: storeId, name });
      setCategories((current) => categorySort([...current, created]));
      setForm((current) => current.categoryId ? current : { ...current, categoryId: created.id });
      setNewCategoryName("");
      openSnackbar({ text: "Đã thêm danh mục", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setSavingCategory(false);
    }
  };

  const deleteCategory = async (category: ProductCategory) => {
    const inUse = items.some((product) => categoryLabel(product) === category.name);
    if (inUse) return;
    try {
      await productCategoryService.delete(category.id);
      setCategories((current) => current.filter((item) => item.id !== category.id));
      if (categoryFilter === category.id) setCategoryFilter("");
      openSnackbar({ text: "Đã xóa danh mục", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    }
  };

  const renameCategory = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingCategory) return;
    const name = newCategoryName.trim();
    if (!name || name.length > 80) {
      openSnackbar({ text: "Tên danh mục phải từ 1 đến 80 ký tự", type: "warning" });
      return;
    }
    if (categories.some((item) => item.id !== editingCategory.id && item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
      openSnackbar({ text: "Danh mục này đã tồn tại", type: "warning" });
      return;
    }
    setSavingCategory(true);
    try {
      const affected = items.filter((product) => categoryLabel(product) === editingCategory.name);
      await productCategoryService.update(editingCategory.id, name);
      await Promise.all(affected.map((product) => productService.update(product.id, { category: name })));
      setCategories((current) => categorySort(current.map((item) => item.id === editingCategory.id ? { ...item, name } : item)));
      setItems((current) => current.map((product) => categoryLabel(product) === editingCategory.name ? { ...product, category: name } : product));
      setEditingCategory(null);
      setNewCategoryName("");
      openSnackbar({ text: "Đã đổi tên danh mục", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
      await load();
    } finally {
      setSavingCategory(false);
    }
  };

  const updateDuration = (field: "interval" | "firstDuration" | "specialDuration", key: keyof DurationForm, value: string) => {
    setForm((current) => ({ ...current, [field]: { ...current[field], [key]: value } }));
  };

  const saveAutoOpen = async () => {
    setSavingAutoOpen(true);
    try {
      const payload = items.filter((product) => product.is_active && autoOpenDraft[product.id]).map((product) => ({ productId: product.id, quantity: product.billing_unit === "hour" ? 1 : Number(autoOpenDraft[product.id]) }));
      const result = await pb.send<{ items: { productId: string; quantity: number }[] }>("/api/table-billing/auto-open-products", { method: "PATCH", body: { items: payload } });
      setAutoOpenItems(result.items);
      setAutoOpenDraft(Object.fromEntries(result.items.map((item) => [item.productId, String(item.quantity)])));
      setAutoOpenSheetOpen(false);
      openSnackbar({ text: "Đã lưu mặt hàng tự thêm khi mở bàn", type: "success" });
    } catch (error) {
      openSnackbar({ text: errorMessage(error), type: "error" });
    } finally {
      setSavingAutoOpen(false);
    }
  };

  return <Page className="min-h-screen bg-slate-50 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
    <PinnedPageHeader className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 pb-3 pt-12 sm:gap-3 sm:px-4">
      <button aria-label="Quay lại sơ đồ bàn" title="Quay lại" onClick={() => navigate("/")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Icon icon="zi-arrow-left" /></button>
      <Text.Title size="small" className="min-w-0 flex-1">Mặt hàng</Text.Title>
      <button onClick={() => setCategorySheetOpen(true)} className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 sm:gap-2 sm:px-3 sm:text-sm"><Icon icon="zi-list-1" />Danh mục</button>
      <button aria-label="Thêm mặt hàng" title="Thêm mặt hàng" onClick={openNew} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white"><Icon icon="zi-plus" /></button>
    </PinnedPageHeader>
    <AdminNav />

    <main className="mx-auto max-w-3xl space-y-3 px-4 py-4">
      <button type="button" onClick={() => navigate("/admin/inventory")} className="flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800"><Icon icon="zi-inbox" />Quản lý tồn kho</button>
      <button type="button" onClick={() => setAutoOpenSheetOpen(true)} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"><Icon icon="zi-plus" />Mặt hàng tự thêm khi mở bàn <span className="text-slate-500">({autoOpenItems.length})</span></button>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_190px]">
        <label className="relative block"><span className="sr-only">Tìm mặt hàng</span><Icon icon="zi-search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mặt hàng" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400" /></label>
        <label className="block"><span className="sr-only">Lọc theo danh mục</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      </div>
      <div className="flex items-center justify-between"><Text size="small" className="font-semibold text-slate-700">{visibleItems.length} mặt hàng</Text><Text size="xSmall" className="text-slate-500">{items.filter((item) => item.is_active).length} đang bán</Text></div>

      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : visibleItems.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center"><Text className="text-slate-500">{items.length ? "Không tìm thấy mặt hàng phù hợp" : "Chưa có mặt hàng"}</Text>{!items.length && <button onClick={openNew} className="mt-4 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Thêm mặt hàng</button>}</div> : <div className="space-y-2">{visibleItems.map((product) => {
        const isTime = product.billing_unit === "hour";
        const pricing = getTimePricing(product.time_pricing);
        const imageUrl = product.image ? pb.files.getURL({ id: product.id, collectionName: "products" }, product.image) : "";
        return <article key={product.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="flex aspect-square w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400">
                {imageUrl ? <img src={imageUrl} alt={`Ảnh ${product.name}`} loading="lazy" className="h-full w-full object-cover" /> : <Icon icon="zi-photo" size={20} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Text size="small" className="font-semibold text-slate-900">{product.name}</Text><span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${product.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{product.is_active ? "Đang bán" : "Đã ẩn"}</span></div>
                <Text size="xSmall" className="mt-1 block text-slate-500">{categoryLabel(product)} · {isTime ? "Theo thời gian" : "Theo số lượng"}</Text>
                <Text size="small" className="mt-2 block font-semibold text-rose-700">{money(product.price)} / {isTime ? formatDuration(pricing.intervalMinutes) : product.unit_label || "lần"}</Text>
                {isTime && pricing.firstPeriod && <Text size="xSmall" className="mt-1 block text-slate-500">Mức đầu tiên: {money(pricing.firstPeriod.price)} / {formatDuration(pricing.firstPeriod.durationMinutes)}</Text>}
                {isTime && pricing.specialPeriod && <Text size="xSmall" className="mt-1 block text-slate-500">Giờ đặc biệt: {pricing.specialPeriod.name}</Text>}
                {product.description && <Text size="xSmall" className="mt-1 block text-slate-500">{product.description}</Text>}
                {product.billing_unit !== "hour" && <Text size="xSmall" className="mt-1 block text-slate-500">Giá nhập: {money(product.purchase_price || 0)}</Text>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button aria-label={`Sửa ${product.name}`} title="Sửa mặt hàng" onClick={() => openEdit(product)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700"><Icon icon="zi-edit" /></button>
              <button aria-label={`Xóa ${product.name}`} title="Xóa mặt hàng" onClick={() => setDeleting(product)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-700"><Icon icon="zi-delete" /></button>
            </div>
          </div>
          <button onClick={() => void toggleActive(product)} className={`mt-3 text-xs font-semibold ${product.is_active ? "text-rose-700" : "text-emerald-700"}`}>{product.is_active ? "Ngừng bán" : "Mở bán"}</button>
        </article>;
      })}</div>}
    </main>

    <Sheet visible={autoOpenSheetOpen} onClose={() => setAutoOpenSheetOpen(false)} autoHeight swipeToClose>
      <Box className="max-h-[85vh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><Text.Title size="small">Mặt hàng tự thêm khi mở bàn</Text.Title><button aria-label="Đóng" onClick={() => setAutoOpenSheetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
        <Text size="xSmall" className="block text-slate-500">Có thể chọn nhiều mặt hàng theo số lượng và tối đa một mặt hàng tính theo giờ.</Text>
        <div className="divide-y divide-slate-200">{items.filter((product) => product.is_active).map((product) => <label key={product.id} className="flex min-h-14 items-center gap-3 py-2"><input type={product.billing_unit === "hour" ? "radio" : "checkbox"} name={product.billing_unit === "hour" ? "default-hourly-product" : undefined} checked={Boolean(autoOpenDraft[product.id])} onChange={(event) => setAutoOpenDraft((current) => { const next = { ...current }; if (product.billing_unit === "hour") { for (const id of Object.keys(next)) if (items.find((item) => item.id === id)?.billing_unit === "hour") delete next[id]; next[product.id] = "1"; } else if (event.target.checked) next[product.id] = "1"; else delete next[product.id]; return next; })} className="h-5 w-5 shrink-0 accent-emerald-700" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{product.name}</span><span className="text-xs text-slate-500">{money(product.price)} / {product.billing_unit === "hour" ? "giờ" : product.unit_label || (product.billing_unit === "weight" ? "kg" : "lần")}</span></span>{Boolean(autoOpenDraft[product.id]) && product.billing_unit !== "hour" && <input aria-label={`Số lượng mặc định ${product.name}`} type="number" min="0.01" step={product.billing_unit === "quantity" ? "1" : "0.01"} value={autoOpenDraft[product.id]} onChange={(event) => setAutoOpenDraft((current) => ({ ...current, [product.id]: event.target.value }))} className="min-h-10 w-24 rounded-lg border border-slate-300 px-2 text-right text-base" />}</label>)}{items.every((product) => !product.is_active) && <p className="py-6 text-center text-sm text-slate-500">Chưa có mặt hàng phù hợp.</p>}</div>
        <button disabled={savingAutoOpen} onClick={() => void saveAutoOpen()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{savingAutoOpen && <Spinner />}Lưu cấu hình</button>
      </Box>
    </Sheet>

    <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} autoHeight swipeToClose>
      <Box className="max-h-[88vh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><Text.Title size="small">{editing ? "Sửa mặt hàng" : "Thêm mặt hàng"}</Text.Title><button aria-label="Đóng" onClick={() => setSheetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
        <label className="block text-sm font-medium text-slate-700">Tên mặt hàng<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={255} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">Ảnh mặt hàng<input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
              input.value = "";
              openSnackbar({ text: "Ảnh phải có định dạng JPG, PNG hoặc WebP", type: "warning" });
              return;
            }
            try {
              const compressed = await compressImage(file);
              setSavedImageUrl("");
              setImageFile(compressed);
              if (compressed !== file) openSnackbar({ text: `Ảnh đã được nén còn ${(compressed.size / 1024 / 1024).toFixed(1)} MB`, type: "success" });
            } catch (error) {
              input.value = "";
              openSnackbar({ text: error instanceof Error ? error.message : "Không thể nén ảnh", type: "error" });
            }
          }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700" /></label>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex aspect-square w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-200 text-slate-400">
              {filePreview || savedImageUrl ? <img src={filePreview || savedImageUrl} alt={`Ảnh ${form.name || "mặt hàng"}`} className="h-full w-full object-cover" /> : <Icon icon="zi-photo" size={24} />}
            </div>
            <div className="min-w-0 flex-1">
              <Text size="xSmall" className="text-slate-600">JPG, PNG hoặc WebP · tối đa 5 MB</Text>
              {imageFile && <Text size="xSmall" className="mt-1 block truncate text-slate-500">{imageFile.name}</Text>}
            </div>
          </div>
        </div>
        <div className="space-y-2"><label className="block text-sm font-medium text-slate-700">Danh mục<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base"><option value="">Chọn danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><button type="button" onClick={() => setCategorySheetOpen(true)} className="text-sm font-semibold text-emerald-800">Quản lý danh mục</button></div>
        <fieldset className="space-y-2"><legend className="text-sm font-medium text-slate-700">Loại mặt hàng</legend><div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-slate-100 p-1"><button type="button" aria-pressed={form.billingMode === "quantity"} onClick={() => setForm({ ...form, billingMode: "quantity", kind: form.kind === "service" ? "goods" : form.kind })} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${form.billingMode === "quantity" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}>Theo số lượng</button><button type="button" aria-pressed={form.billingMode === "time"} onClick={() => setForm({ ...form, billingMode: "time", kind: "service", requiresPreparation: false })} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${form.billingMode === "time" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}>Theo thời gian</button></div></fieldset>
        {form.billingMode === "quantity" && <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800"><input type="checkbox" checked={form.requiresPreparation} onChange={(event) => setForm({ ...form, requiresPreparation: event.target.checked })} className="h-4 w-4 accent-emerald-700" />Mặt hàng cần chế biến</label>}

        <label className="block text-sm font-medium text-slate-700">{form.billingMode === "time" ? "Giá giờ thường (VNĐ)" : "Giá bán (VNĐ)"}<input type="text" inputMode="numeric" value={formatMoneyInput(form.price)} onChange={(event) => handleMoneyInput(event, (price) => setForm({ ...form, price }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>

        {form.billingMode === "quantity" ? <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">Giá nhập (VNĐ)<input type="text" inputMode="numeric" value={formatMoneyInput(form.purchasePrice)} onChange={(event) => handleMoneyInput(event, (purchasePrice) => setForm({ ...form, purchasePrice }))} placeholder="0" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label><label className="block text-sm font-medium text-slate-700">Đơn vị tính<input value={form.unitLabel} onChange={(event) => setForm({ ...form, unitLabel: event.target.value })} placeholder="chai, phần, lần..." maxLength={30} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label></div> : <div className="space-y-4 rounded-lg border border-slate-200 p-3">
          <DurationFields label="Áp dụng mỗi khoảng thời gian" value={form.interval} onChange={(field, value) => updateDuration("interval", field, value)} />
          <div className="border-t border-slate-200 pt-3">
            <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={form.firstEnabled} onChange={(event) => setForm({ ...form, firstEnabled: event.target.checked })} className="h-4 w-4 accent-emerald-700" />Có mức giá cho thời gian đầu tiên</label>
            {form.firstEnabled && <div className="mt-3 space-y-3"><label className="block text-sm font-medium text-slate-700">Giá bán đầu tiên (VNĐ)<input type="text" inputMode="numeric" value={formatMoneyInput(form.firstPrice)} onChange={(event) => handleMoneyInput(event, (firstPrice) => setForm({ ...form, firstPrice }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label><DurationFields label="Thời gian đầu tiên" value={form.firstDuration} onChange={(field, value) => updateDuration("firstDuration", field, value)} /></div>}
          </div>
          <div className="border-t border-slate-200 pt-3">
            <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={form.specialEnabled} onChange={(event) => setForm({ ...form, specialEnabled: event.target.checked })} className="h-4 w-4 accent-emerald-700" />Có giờ đặc biệt</label>
            {form.specialEnabled && <div className="mt-3 space-y-3">
              <label className="block text-sm font-medium text-slate-700">Tên giờ đặc biệt<input value={form.specialName} onChange={(event) => setForm({ ...form, specialName: event.target.value })} maxLength={80} placeholder="Ví dụ: Giờ cao điểm" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>
              <label className="block text-sm font-medium text-slate-700">Giá bán (VNĐ)<input type="text" inputMode="numeric" value={formatMoneyInput(form.specialPrice)} onChange={(event) => handleMoneyInput(event, (specialPrice) => setForm({ ...form, specialPrice }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>
              <DurationFields label="Tính mỗi khoảng thời gian" value={form.specialDuration} onChange={(field, value) => updateDuration("specialDuration", field, value)} />
              <fieldset className="space-y-2"><legend className="text-sm font-medium text-slate-700">Thời gian áp dụng</legend><div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-slate-100 p-1"><button type="button" aria-pressed={form.specialAllDay} onClick={() => setForm({ ...form, specialAllDay: true })} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${form.specialAllDay ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}>Cả ngày</button><button type="button" aria-pressed={!form.specialAllDay} onClick={() => setForm({ ...form, specialAllDay: false })} className={`min-h-10 rounded-md px-2 text-sm font-semibold ${!form.specialAllDay ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}>Khung giờ</button></div></fieldset>
              {!form.specialAllDay && <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium text-slate-700">Từ<input type="time" value={form.specialStart} onChange={(event) => setForm({ ...form, specialStart: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base" /></label><label className="block text-sm font-medium text-slate-700">Đến<input type="time" value={form.specialEnd} onChange={(event) => setForm({ ...form, specialEnd: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base" /></label></div>}
              <fieldset className="space-y-2"><legend className="text-sm font-medium text-slate-700">Ngày trong tuần</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{WEEKDAYS.map((day) => <label key={day.value} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-2 text-sm text-slate-700"><input type="checkbox" checked={form.specialWeekdays.includes(day.value)} onChange={(event) => setForm({ ...form, specialWeekdays: event.target.checked ? [...form.specialWeekdays, day.value] : form.specialWeekdays.filter((value) => value !== day.value) })} className="h-4 w-4 accent-emerald-700" />{day.label}</label>)}</div></fieldset>
            </div>}
          </div>
        </div>}

        <label className="block text-sm font-medium text-slate-700">Mô tả<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>
        <button disabled={saving} onClick={() => void save()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{saving && <Spinner />}{editing ? "Lưu thay đổi" : "Thêm mặt hàng"}</button>
      </Box>
    </Sheet>

    <Sheet visible={categorySheetOpen} onClose={() => setCategorySheetOpen(false)} autoHeight swipeToClose>
      <Box className="max-h-[85vh] space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <div className="flex items-center justify-between"><Text.Title size="small">Danh mục mặt hàng</Text.Title><button aria-label="Đóng" onClick={() => setCategorySheetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"><Icon icon="zi-close" /></button></div>
        <form onSubmit={editingCategory ? renameCategory : addCategory} className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm font-medium text-slate-700">{editingCategory ? "Tên danh mục mới" : "Tên danh mục"}<input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label><button type="submit" disabled={savingCategory || !newCategoryName.trim()} aria-label={editingCategory ? "Lưu tên danh mục" : "Thêm danh mục"} title={editingCategory ? "Lưu tên danh mục" : "Thêm danh mục"} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white disabled:opacity-50">{savingCategory ? <Spinner /> : <Icon icon={editingCategory ? "zi-check" : "zi-plus"} />}</button>{editingCategory && <button type="button" onClick={() => { setEditingCategory(null); setNewCategoryName(""); }} className="h-12 shrink-0 rounded-lg border border-slate-300 px-3 text-sm">Hủy</button>}</form>
        {categories.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Chưa có danh mục</div> : <div className="divide-y divide-slate-200">{categories.map((category) => {
          const itemCount = items.filter((product) => categoryLabel(product) === category.name).length;
          return <div key={category.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><Text size="small" className="font-medium text-slate-900">{category.name}</Text><Text size="xSmall" className="text-slate-500">{itemCount} mặt hàng</Text></div><div className="flex shrink-0 gap-2"><button onClick={() => { setEditingCategory(category); setNewCategoryName(category.name); }} aria-label={`Sửa tên danh mục ${category.name}`} title="Sửa tên danh mục" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700"><Icon icon="zi-edit" /></button><button disabled={itemCount > 0} onClick={() => void deleteCategory(category)} aria-label={`Xóa danh mục ${category.name}`} title={itemCount ? "Danh mục đang được sử dụng" : "Xóa danh mục"} className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-rose-200 px-2.5 text-xs font-semibold text-rose-700 disabled:border-slate-200 disabled:text-slate-400"><Icon icon="zi-delete" />Xóa</button></div></div>;
        })}</div>}
      </Box>
    </Sheet>

    <Sheet visible={!!deleting} onClose={() => setDeleting(null)} autoHeight>
      <Box className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4">
        <Text.Title size="small" className="text-rose-800">Xóa mặt hàng</Text.Title>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-900">Xóa “{deleting?.name}” khỏi danh sách mặt hàng?</div>
        <div className="grid grid-cols-2 gap-2"><button onClick={() => setDeleting(null)} className="min-h-11 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Hủy</button><button disabled={saving} onClick={() => void deleteProduct()} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-rose-700 text-sm font-semibold text-white disabled:opacity-50">{saving && <Spinner />}Xóa</button></div>
      </Box>
    </Sheet>
  </Page>;
}
