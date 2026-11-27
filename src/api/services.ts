import pb, { Store, User, Product, ProductInput, ProductCategory, Table, TableLayout, TableMap, TableBill, TableBillSessionSummary, TableBillCustomer, TableBillProduct, TableBillHistoryEvent, TableBillingReport, TableBillProductHistoryItem, AdminDashboardReport, InventoryItem, InventoryMovement, InventorySettings, Customer, WalletOrder, WalletSummary, WalletTransactionPage, WalletUser, WalletTopup, WalletTopupCreateResult, WalletTopupPayment, WalletPromoSettings, XuAdminUser, XuCheckinResult, XuRedemption, XuReferralSummary, XuReward, XuSettings, XuSummary, XuTransactionPage, BillPaymentSettings, AdminNotification, Promotion, CustomerSegmentData, StaffAccount, StaffAttendance, StaffQueueItem, AuditLog } from './pocketbase';
import { clearSessionCachePrefix, readSessionCache, removeSessionCache, writeSessionCache } from '@/utils/session-cache';

const currentStoreId = () => String((pb.authStore.model as { store?: string } | null)?.store || '');
const cacheKey = (prefix: string, storeId = currentStoreId()) => `${prefix}:${storeId}:v1`;

export const registrationAdminService = {
  get() {
    return pb.send<{ approvalRequired: boolean; users: { id: string; username: string; fullname: string; phone: string }[] }>('/api/admin/registration', { method: 'GET' });
  },
  setApprovalRequired(approvalRequired: boolean) {
    return pb.send('/api/admin/registration', { method: 'PATCH', body: { approvalRequired } });
  },
  approve(id: string) {
    return pb.send(`/api/admin/registration/${encodeURIComponent(id)}/approve`, { method: 'POST' });
  },
};

export const staffAdminService = {
  list(query = '') {
    return pb.send<{ items: StaffAccount[] }>(`/api/admin/staff?q=${encodeURIComponent(query)}`, { method: 'GET' });
  },
  update(id: string, input: { role?: 'staff' | 'user'; locked?: boolean }) {
    return pb.send<{ id: string; role: StaffAccount['role']; locked: boolean }>(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
  },
};

export const staffAttendanceService = {
  list(workDate: string) {
    return pb.send<{ items: (StaffAccount & { attendance: StaffAttendance | null })[] }>(`/api/admin/attendance?date=${encodeURIComponent(workDate)}`, { method: 'GET' });
  },
  save(input: Omit<StaffAttendance, 'id' | 'staff'> & { staff: string }) {
    return pb.send<StaffAttendance>('/api/admin/attendance', { method: 'POST', body: input });
  },
};

export const auditLogService = {
  async list(input: { from: string; to: string; actor?: string; action?: string; page?: number; perPage?: number }) {
    const filters = [`created >= "${input.from.replace(/"/g, "")}"`, `created <= "${input.to.replace(/"/g, "")}"`];
    if (input.actor) filters.push(`actor = "${input.actor.replace(/"/g, "")}"`);
    if (input.action) filters.push(`action = "${input.action.replace(/"/g, "")}"`);
    return pb.collection("audit_logs").getList<AuditLog>(input.page || 1, input.perPage || 50, { filter: filters.join(" && "), sort: "-created", expand: "actor" });
  },
};

export const authService = {
  async login(email: string, password: string) {
    const authData = await pb.collection('users').authWithPassword(email, password);
    return authData;
  },

  async logout() {
    pb.authStore.clear();
  },

  isAuthenticated() {
    return pb.authStore.isValid;
  },

  getToken() {
    return pb.authStore.token;
  },

  getCurrentUser() {
    return pb.authStore.model as User | null;
  }
};

export const storeService = {
  async list(page = 1, perPage = 50) {
    return await pb.collection('stores').getList<Store>(page, perPage, {
      sort: '-created',
    });
  },

  async getOne(id: string) {
    return await pb.collection('stores').getOne<Store>(id);
  },

  async create(data: Partial<Store>) {
    return await pb.collection('stores').create<Store>(data);
  },

  async update(id: string, data: Partial<Store>) {
    return await pb.collection('stores').update<Store>(id, data);
  },

  async delete(id: string) {
    return await pb.collection('stores').delete(id);
  }
};

export const billPaymentService = {
  getSettings(storeId = String((pb.authStore.model as { store?: string } | null)?.store || "")) {
    return pb.send<BillPaymentSettings>('/api/table-billing/payment-settings', { method: 'GET' }).then((settings) => {
      this.cacheSettings(storeId, settings);
      return settings;
    });
  },
  getCachedSettings(storeId = String((pb.authStore.model as { store?: string } | null)?.store || "")) {
    if (!storeId) return null;
    try { localStorage.removeItem(`billiard:payment-settings:${storeId}:v1`); } catch { /* Remove legacy persistent cache when possible. */ }
    return readSessionCache<BillPaymentSettings>(cacheKey('billiard:payment-settings', storeId), 30 * 60 * 1000);
  },
  cacheSettings(storeId: string, settings: BillPaymentSettings) {
    if (!storeId) return;
    writeSessionCache(cacheKey('billiard:payment-settings', storeId), settings);
  },
  clearCachedSettings(storeId = currentStoreId()) {
    if (storeId) removeSessionCache(cacheKey('billiard:payment-settings', storeId));
  },
  saveSettings(settings: BillPaymentSettings) {
    const storeId = String((pb.authStore.model as { store?: string } | null)?.store || "");
    return pb.send<BillPaymentSettings>('/api/table-billing/payment-settings', { method: 'PATCH', body: settings }).then((saved) => {
      this.cacheSettings(storeId, saved);
      return saved;
    });
  },
  getQrFast(input: { tableId?: string; billId?: string; amount: number; content: string }, settings: BillPaymentSettings) {
    const accountNumber = String(settings.accountNumber || "").replace(/\s+/g, "");
    const bankId = String(settings.bankId || "").trim();
    const accountName = String(settings.accountName || "").trim();
    if (!settings.tingeeVirtualAccount && /^\d{4,24}$/.test(accountNumber) && bankId && accountName) {
      const content = String(input.content || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, (character) => character === "Đ" ? "D" : "d").slice(0, 120);
      const query = new URLSearchParams({ bank: bankId, acc: accountNumber, template: "compact", amount: String(input.amount), des: content, showinfo: "true", holder: accountName });
      return Promise.resolve({ qrCodeImage: `https://vietqr.app/img?${query.toString()}`, qrCode: "", qrAccount: accountNumber });
    }
    return this.getQr(input);
  },
  getQr(input: { tableId?: string; billId?: string; amount: number; content: string }) {
    return pb.send<{ qrCodeImage: string; qrCode: string; qrAccount: string }>('/api/table-billing/payment-qr', { method: 'POST', body: input });
  },
};

export const productService = {
  async listAdmin(storeId: string) {
    const key = cacheKey('billiard:admin-products', storeId);
    const cached = readSessionCache<Product[]>(key, 5 * 60 * 1000);
    if (cached) return cached;
    const products = await pb.collection('products').getFullList<Product>({
      filter: `store="${storeId}"`,
      sort: 'category,name',
    });
    writeSessionCache(key, products);
    return products;
  },

  async create(data: ProductInput) {
    const result = await pb.collection('products').create<Product>(data);
    clearSessionCachePrefix('billiard:admin-products:');
    clearSessionCachePrefix('billiard:products:');
    return result;
  },

  async update(id: string, data: ProductInput) {
    const result = await pb.collection('products').update<Product>(id, data);
    clearSessionCachePrefix('billiard:admin-products:');
    clearSessionCachePrefix('billiard:products:');
    return result;
  },

  async delete(id: string) {
    const result = await pb.collection('products').delete(id);
    clearSessionCachePrefix('billiard:admin-products:');
    clearSessionCachePrefix('billiard:products:');
    return result;
  }
};

export const productCategoryService = {
  async list(storeId: string) {
    const key = cacheKey('billiard:product-categories', storeId);
    const cached = readSessionCache<ProductCategory[]>(key, 5 * 60 * 1000);
    if (cached) return cached;
    const categories = await pb.collection('product_categories').getFullList<ProductCategory>({
      filter: `store="${storeId}"`,
      sort: 'name',
    });
    writeSessionCache(key, categories);
    return categories;
  },

  async create(data: Pick<ProductCategory, 'store' | 'name'>) {
    const result = await pb.collection('product_categories').create<ProductCategory>(data);
    clearSessionCachePrefix('billiard:product-categories:');
    return result;
  },

  async update(id: string, name: string) {
    const result = await pb.collection('product_categories').update<ProductCategory>(id, { name });
    clearSessionCachePrefix('billiard:product-categories:');
    clearSessionCachePrefix('billiard:admin-products:');
    clearSessionCachePrefix('billiard:products:');
    return result;
  },

  async delete(id: string) {
    const result = await pb.collection('product_categories').delete(id);
    clearSessionCachePrefix('billiard:product-categories:');
    clearSessionCachePrefix('billiard:admin-products:');
    clearSessionCachePrefix('billiard:products:');
    return result;
  },
};

export const promotionService = {
  async list() {
    const key = cacheKey('billiard:promotions');
    const cached = readSessionCache<{ items: Promotion[] }>(key, 60 * 1000);
    if (cached) return cached;
    const result = await pb.send<{ items: Promotion[] }>('/api/admin/promotions', { method: 'GET' });
    writeSessionCache(key, result);
    return result;
  },
  async create(input: Partial<Promotion>) {
    const result = await pb.send<Promotion>('/api/admin/promotions', { method: 'POST', body: input });
    clearSessionCachePrefix('billiard:promotions:');
    return result;
  },
  async update(id: string, input: Partial<Promotion>) {
    const result = await pb.send<Promotion>('/api/admin/promotions', { method: 'POST', body: { ...input, id } });
    clearSessionCachePrefix('billiard:promotions:');
    return result;
  },
  async remove(id: string) {
    const result = await pb.send<{ ok: boolean }>('/api/admin/promotions', { method: 'DELETE', body: { id } });
    clearSessionCachePrefix('billiard:promotions:');
    return result;
  },
};

export const customerSegmentService = {
  async get() { return pb.send<CustomerSegmentData>('/api/admin/customer-segments', { method: 'GET' }); },
  async createGroup(name: string) { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'create_group', name } }); },
  async createCard(code: string, name: string) { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'create_card', code, name } }); },
  async removeGroup(id: string) { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'delete_group', id } }); },
  async removeCard(id: string) { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'delete_card', id } }); },
  async addGroupMember(groupId: string, userId: string) { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'add_group_member', parentId: groupId, userId } }); },
  async addCardMember(cardId: string, userId: string, cardNumber = '') { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'add_card_member', parentId: cardId, userId, cardNumber } }); },
  async removeGroupMember(id: string) { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'remove_group_member', id } }); },
  async removeCardMember(id: string) { return pb.send('/api/admin/customer-segments', { method: 'POST', body: { action: 'remove_card_member', id } }); },
};

export const tableService = {
  async getMap() {
    return pb.send<TableMap>('/api/table-billing/map', { method: 'GET' });
  },

  async list(storeId: string, page = 1, perPage = 50) {
    return await pb.collection('tables').getList<Table>(page, perPage, {
      filter: `store="${storeId}"`,
      sort: 'row_number,position,name',
    });
  },

  async getOne(id: string) {
    return await pb.collection('tables').getOne<Table>(id);
  },

  async configureLayout(layout: TableLayout) {
    return pb.send<{ ok: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'configure_layout', ...layout } });
  },

  async start(tableId: string, customerId = '', useDefaultProducts = true) {
    return pb.send<{ ok: boolean; billId: string }>('/api/table-billing/action', { method: 'POST', body: { action: 'start', tableId, customerId, useDefaultProducts } });
  },

  async getActiveBill(tableId: string) {
    return pb.send<{ billId: string }>('/api/table-billing/action', { method: 'POST', body: { action: 'get_active_bill', tableId } });
  },

  async delete(id: string, password: string) {
    return pb.send<{ ok: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'delete_table', tableId: id, password } });
  },

  async updateStatus(id: string, status: Table['status']) {
    return pb.send<{ ok: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'set_table_status', tableId: id, status } });
  },
  async resetStatus(id: string) {
    return pb.send<{ ok: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'reset_table_status', tableId: id } });
  },

  async rename(id: string, name: string) {
    return pb.send<{ ok: boolean; name: string }>('/api/table-billing/action', { method: 'POST', body: { action: 'rename_table', tableId: id, name } });
  },

};

export const tableBillingService = {
  async getPublicDetail(tableId: string) {
    const result = await pb.send<{ ok: boolean; storeName: string; tableName: string; payment: Pick<BillPaymentSettings, 'bankId' | 'accountNumber' | 'accountName' | 'tingeeVirtualAccount'>; menu: TableBillProduct[]; bill: TableBill | null; unpaidBills: TableBill[] }>('/api/table-billing/action', { method: 'POST', body: { action: 'public_detail', tableId } });
    return result;
  },
  async getPublicTables(storeId: string) {
    return pb.send<{ ok: boolean; tables: { id: string; name: string }[] }>('/api/table-billing/action', { method: 'POST', body: { action: 'public_tables', storeId } });
  },
  async switchPublicTable(storeId: string, targetTableId: string, adminPassword: string) {
    return pb.send<{ ok: boolean; tableId: string }>('/api/table-billing/action', { method: 'POST', body: { action: 'public_switch_table', storeId, targetTableId, adminPassword } });
  },
  async requestPublicOrder(tableId: string, billId: string, items: { productId: string; quantity: number }[]) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'public_order', tableId, billId, items } });
  },
  async requestPublicTransfer(tableId: string, billId: string) {
    return pb.send<{ ok: boolean; alreadyRequested: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'public_request_transfer', tableId, billId } });
  },
  async payPublicBillWithWallet(billId: string) {
    return pb.send<{ ok: boolean; alreadyPaid: boolean; promoUsed?: number; mainUsed?: number; error?: string; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'public_wallet_payment', billId } });
  },
  async getQueue(history = false) {
    return pb.send<{ items: StaffQueueItem[] }>('/api/table-billing/action', { method: 'POST', body: { action: 'queue_list', history } });
  },
  async getOrderRequests(history = false) {
    return pb.send<{ items: StaffQueueItem[] }>('/api/table-billing/action', { method: 'POST', body: { action: 'request_list', history } });
  },
  async getPaymentRequests() {
    return pb.send<{ items: StaffQueueItem[] }>('/api/table-billing/action', { method: 'POST', body: { action: 'payment_request_list' } });
  },
  async markTransferUnreceived(billId: string) {
    return pb.send<{ ok: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'payment_request_unreceived', billId } });
  },
  async updateOrderRequest(billId: string, itemIds: string[], approve: boolean) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: approve ? 'request_approve' : 'request_reject', billId, itemIds } });
  },
  async updateQueue(billId: string, itemId: string, action: 'queue_done' | 'queue_cancel') {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action, billId, itemId } });
  },
  async getMyOpen() {
    return pb.send<{ items: Pick<TableBill, 'id' | 'table' | 'tableName' | 'status'>[] }>('/api/table-billing/my-open', { method: 'GET' });
  },
  async getDetail(billId: string) {
    const result = await pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'detail', billId } });
    return result.bill;
  },
  async getByTable(tableId: string) {
    const result = await pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'detail', tableId } });
    return result.bill;
  },
  async getSessionSummary(billId: string) {
    return pb.send<TableBillSessionSummary>('/api/table-billing/action', { method: 'POST', body: { action: 'session_summary', billId } });
  },
  async getProducts() {
    const key = cacheKey('billiard:products');
    const cached = readSessionCache<{ items?: unknown }>(key, 5 * 60 * 1000);
    if (cached && Array.isArray(cached.items)) return { items: cached.items as TableBillProduct[] };
    const result = await pb.send<{ items?: unknown }>('/api/table-billing/products', { method: 'GET' });
    if (!Array.isArray(result?.items)) throw new Error('API danh sách sản phẩm trả dữ liệu không hợp lệ');
    const products = { items: result.items as TableBillProduct[] };
    writeSessionCache(key, products);
    return products;
  },
  async getCustomers() {
    const key = cacheKey('billiard:customers');
    const cached = readSessionCache<{ items: TableBillCustomer[] }>(key, 5 * 60 * 1000);
    if (cached) return cached;
    const result = await pb.send<{ items: TableBillCustomer[] }>('/api/table-billing/customers', { method: 'GET' });
    writeSessionCache(key, result);
    return result;
  },
  async addItem(billId: string, productId: string, quantity: number) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'add_item', billId, productId, quantity } });
  },
  async togglePause(billId: string) {
    return pb.send<{ ok: boolean; billingPaused: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'toggle_pause', billId } });
  },
  async merge(billId: string, targetBillId: string) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'merge_bills', billId, targetBillId } });
  },
  async split(billId: string, tableId: string, itemIds: string[]) {
    return pb.send<{ ok: boolean; bill: TableBill; sourceBill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'split_bill', billId, tableId, itemIds } });
  },
  async splitSession(billId: string, keepCustomer: boolean) {
    return pb.send<{ ok: boolean; stoppedBill: TableBill; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'split_session', billId, keepCustomer } });
  },
  async transferTable(billId: string, targetTableId: string) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'transfer_table', billId, targetTableId } });
  },
  async updateItem(billId: string, itemId: string, quantity: number, reason = '') {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'update_item', billId, itemId, quantity, ...(reason ? { reason } : {}) } });
  },
  async updateItemTime(billId: string, itemId: string, startedAt: string, stoppedAt: string, reason = '') {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'update_item_time', billId, itemId, startedAt, stoppedAt, ...(reason ? { reason } : {}) } });
  },
  async deleteItem(billId: string, itemId: string, reason = '') {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'delete_item', billId, itemId, reason } });
  },
  async applyPromotion(billId: string, promotionId = '') {
    return pb.send<{ ok: boolean; bill: TableBill; discountAmount?: number; cleared?: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'apply_promotion', billId, promotionId } });
  },
  async requestWallet(billId: string) {
    return pb.send<{ ok: boolean; alreadyRequested: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'request_wallet', billId } });
  },
  async requestTransfer(billId: string) {
    return pb.send<{ ok: boolean; alreadyRequested: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'request_transfer', billId } });
  },
  async payManual(billId: string, paymentMethod: 'cash' | 'transfer', cashReceived?: number, paymentDiscountPercent?: number, paymentDiscountNote = '') {
    return pb.send<{ ok: boolean; bill: TableBill; change?: number; discountAmount?: number; paymentDiscountPercent?: number; paymentDiscountAmount?: number }>('/api/table-billing/action', { method: 'POST', body: { action: 'pay_manual', billId, paymentMethod, ...(paymentDiscountPercent === undefined ? {} : { paymentDiscountPercent }), ...(paymentDiscountNote ? { paymentDiscountNote } : {}), ...(cashReceived === undefined ? {} : { cashReceived }) } });
  },
  async approveWallet(billId: string, paymentDiscountPercent = 0, paymentDiscountNote = '') {
    return pb.send<{ ok: boolean; alreadyPaid: boolean; promoUsed?: number; mainUsed?: number; error?: string; bill: TableBill; discountAmount?: number; paymentDiscountPercent?: number; paymentDiscountAmount?: number }>('/api/table-billing/action', { method: 'POST', body: { action: 'approve_wallet', billId, paymentDiscountPercent, ...(paymentDiscountNote ? { paymentDiscountNote } : {}) } });
  },
  async recordPrint(billId: string) {
    return pb.send<{ ok: boolean; bill: TableBill; reprinted: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'print', billId } });
  }
};

export const tableBillHistoryService = {
  async list(input: { billId?: string; category?: 'payment' | 'action'; search?: string; page?: number } = {}) {
    const query = new URLSearchParams();
    if (input.billId) query.set('billId', input.billId);
    if (input.category) query.set('category', input.category);
    if (input.search) query.set('search', input.search);
    if (input.page) query.set('page', String(input.page));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return pb.send<{ items: TableBillHistoryEvent[]; page: number; hasMore: boolean }>(`/api/table-billing/history${suffix}`, { method: 'GET' });
  },
  async report(input: { from: string; to: string; tableName?: string; productName?: string; paymentMethod?: string; accountId?: string; category?: string; page?: number; pageSize?: number }) {
    const query = new URLSearchParams({ from: input.from, to: input.to });
    if (input.tableName) query.set('tableName', input.tableName);
    if (input.productName) query.set('productName', input.productName);
    if (input.paymentMethod) query.set('paymentMethod', input.paymentMethod);
    if (input.accountId) query.set('accountId', input.accountId);
    if (input.category) query.set('category', input.category);
    if (input.page) query.set('page', String(input.page));
    if (input.pageSize) query.set('pageSize', String(input.pageSize));
    const result = await pb.send<TableBillingReport>(`/api/table-billing/report?${query.toString()}`, { method: 'GET' });
    return {
      ...result,
      daily: result.daily || [],
      tables: result.tables || [],
      products: (result.products || []).map((product) => ({ ...product, history: product.history || [] })),
      payments: (result.payments || []).map((payment) => ({ ...payment, items: payment.items || [] })),
    };
  },
  async productHistory(input: { productId: string; from: string; to: string }) {
    const query = new URLSearchParams({ productId: input.productId, from: input.from, to: input.to });
    return pb.send<{ history: TableBillProductHistoryItem[] }>(`/api/table-billing/product-history?${query.toString()}`, { method: 'GET' });
  },
};

export const reportSettingsService = {
  async get() {
    const key = cacheKey('billiard:report-settings');
    const cached = readSessionCache<{ shiftType: 2 | 3; shifts: { name: string; start: string; end: string }[] }>(key, 30 * 60 * 1000);
    if (cached) return cached;
    const result = await pb.send<{ shiftType: 2 | 3; shifts: { name: string; start: string; end: string }[] }>(`/api/admin/table-billing/report-settings`, { method: 'GET' });
    writeSessionCache(key, result);
    return result;
  },
  async save(shiftType: 2 | 3, shifts: { name: string; start: string; end: string }[]) {
    const result = await pb.send<{ shiftType: 2 | 3; shifts: { name: string; start: string; end: string }[] }>(`/api/admin/table-billing/report-settings`, { method: 'PATCH', body: { shiftType, shifts } });
    writeSessionCache(cacheKey('billiard:report-settings'), result);
    return result;
  },
};

export const inventoryService = {
  async getSettings() {
    const key = cacheKey('billiard:inventory-settings');
    const cached = readSessionCache<InventorySettings>(key, 30 * 60 * 1000);
    if (cached) return cached;
    const result = await pb.send<InventorySettings>('/api/admin/inventory/settings', { method: 'GET' });
    writeSessionCache(key, result);
    return result;
  },
  async saveSettings(inventoryRequired: boolean) {
    const result = await pb.send<InventorySettings>('/api/admin/inventory/settings', { method: 'PATCH', body: { inventoryRequired } });
    writeSessionCache(cacheKey('billiard:inventory-settings'), result);
    return result;
  },
  async list(search = '') {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const key = `${cacheKey('billiard:inventory', currentStoreId())}:${search.trim().toLocaleLowerCase('vi')}`;
    const cached = readSessionCache<{ items: InventoryItem[]; movements: InventoryMovement[] }>(key, 30 * 1000);
    if (cached) return cached;
    const result = await pb.send<{ items: InventoryItem[]; movements: InventoryMovement[] }>(`/api/admin/inventory${query}`, { method: 'GET' });
    writeSessionCache(key, result);
    return result;
  },
  async move(input: { productId: string; movementType: 'in' | 'adjustment'; quantity: number; unitCost: number; note: string }) {
    const result = await pb.send<{ ok: boolean; onHand: number; reserved: number; available: number }>('/api/admin/inventory/movement', { method: 'POST', body: input });
    clearSessionCachePrefix('billiard:inventory:');
    return result;
  },
};

export const adminDashboardService = {
  async get(from: string, to: string) {
    const query = new URLSearchParams({ from, to });
    return pb.send<AdminDashboardReport>(`/api/admin/dashboard?${query.toString()}`, { method: 'GET' });
  },
  async addExpense(input: { amount: number; category: string; note: string; spentAt: string }) {
    return pb.send<AdminDashboardReport['expenses'][number]>('/api/admin/expenses', { method: 'POST', body: input });
  },
};

export const adminNotificationService = {
  async list() {
    return pb.send<{ items: AdminNotification[] }>('/api/admin/notifications', { method: 'GET' });
  },
  async markRead(id: string) {
    return pb.send<{ ok: boolean }>('/api/admin/notifications/read', { method: 'PATCH', body: { id } });
  }
};

export const customerService = {
  async list(storeId: string, page = 1, perPage = 50) {
    return await pb.collection('customers').getList<Customer>(page, perPage, {
      filter: `store="${storeId}"`,
      sort: '-created',
    });
  },

  async getOne(id: string) {
    return await pb.collection('customers').getOne<Customer>(id);
  },

  async create(data: Partial<Customer>) {
    return await pb.collection('customers').create<Customer>(data);
  },

  async update(id: string, data: Partial<Customer>) {
    return await pb.collection('customers').update<Customer>(id, data);
  },

  async delete(id: string) {
    return await pb.collection('customers').delete(id);
  },

  async search(storeId: string, query: string) {
    return await pb.collection('customers').getList<Customer>(1, 20, {
      filter: `store="${storeId}" && (name~"${query}" || phone~"${query}")`,
    });
  }
};

export const walletService = {
  async getMine() {
    return pb.send<WalletSummary>('/api/wallet/me', { method: 'GET' });
  },
  async getMyTransactions(page = 1, perPage = 20) {
    return pb.send<WalletTransactionPage>(`/api/wallet/me/transactions?page=${page}&perPage=${perPage}`, { method: 'GET' });
  },
  async listUsers(query = '') {
    return pb.send<WalletUser[]>(`/api/admin/wallets/users?q=${encodeURIComponent(query)}`, { method: 'GET' });
  },
  async getUser(userId: string) {
    return pb.send<WalletSummary>(`/api/admin/wallets/detail?userId=${encodeURIComponent(userId)}`, { method: 'GET' });
  },
  async getUserTransactions(userId: string, page = 1, perPage = 20) {
    return pb.send<WalletTransactionPage>(`/api/admin/wallets/transactions?userId=${encodeURIComponent(userId)}&page=${page}&perPage=${perPage}`, { method: 'GET' });
  },
  async adjust(input: { userId: string; walletType: 'main' | 'promo'; direction: 'credit' | 'debit'; amount: number; reason: string; expiresAt?: string; idempotencyKey: string }) {
    return pb.send<{ mainBalance: number; promoBalance: number }>('/api/admin/wallets/adjust', { method: 'POST', body: input });
  },
  async updatePromoExpiry(input: { fromDate: string; toDate: string; newExpiresAt: string; userIds?: string[] }) {
    return pb.send<{ updated: number }>('/api/admin/wallets/promo-expiry-bulk', { method: 'POST', body: input });
  },
  async getPromoSettings() {
    return pb.send<WalletPromoSettings>('/api/admin/wallet-promo/settings', { method: 'GET' });
  },
  async savePromoSettings(input: WalletPromoSettings) {
    return pb.send<WalletPromoSettings>('/api/admin/wallet-promo/settings', { method: 'PUT', body: input });
  },
  async getOrder(orderId: string) {
    return pb.send<WalletOrder>(`/api/orders/detail?orderId=${encodeURIComponent(orderId)}`, { method: 'GET' });
  },
  async payOrder(orderId: string, idempotencyKey: string) {
    return pb.send<{ alreadyPaid: boolean; orderId: string; promoUsed?: number; mainUsed?: number; mainBalance?: number }>('/api/wallet/pay', { method: 'POST', body: { orderId, idempotencyKey } });
  },
  async createTopup(input: { amount: number; note?: string; proof?: string; idempotencyKey: string }) {
    return pb.send<WalletTopupCreateResult>('/api/wallet/topups', { method: 'POST', body: input });
  },
  async getMyTopups(page = 1, perPage = 20) {
    return pb.send<{ page: number; perPage: number; totalItems: number; items: WalletTopup[] }>(`/api/wallet/topups?page=${page}&perPage=${perPage}`, { method: 'GET' });
  },
  async cancelTopup(topupId: string) {
    return pb.send<{ topup: Pick<WalletTopup, 'id' | 'status'> }>(`/api/wallet/topups/${encodeURIComponent(topupId)}/cancel`, { method: 'POST' });
  },
  async listTopups(status = 'pending', query = '') {
    return pb.send<{ items: WalletTopup[] }>(`/api/admin/wallet-topups?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}`, { method: 'GET' });
  },
  async approveTopup(topupId: string, input: { gatewayTransactionId?: string; note?: string } = {}) {
    return pb.send<{ alreadyPaid: boolean; topup: WalletTopup; wallet?: { id: string; mainBalance: number } }>(`/api/admin/wallet-topups/${encodeURIComponent(topupId)}/approve`, { method: 'POST', body: input });
  },
  async rejectTopup(topupId: string, reason: string) {
    return pb.send<{ topup: WalletTopup }>(`/api/admin/wallet-topups/${encodeURIComponent(topupId)}/reject`, { method: 'POST', body: { reason } });
  },
  async getSpinSettings() {
    return pb.send<{ minTopup: number; prizes: WalletSpinPrize[] }>('/api/admin/wallet-spin/settings', { method: 'GET' });
  },
  async saveSpinSettings(input: { minTopup: number; prizes: WalletSpinPrize[] }) {
    return pb.send<{ minTopup: number; prizes: WalletSpinPrize[] }>('/api/admin/wallet-spin/settings', { method: 'PUT', body: input });
  },
  async getSpins() {
    return pb.send<{ minTopup: number; prizes: WalletSpinPrize[]; items: WalletSpinItem[] }>('/api/wallet/spins', { method: 'GET' });
  },
  async spinTopup(topupId: string) {
    return pb.send<{ id: string; prizeName: string; prizeAmount: number; alreadySpun: boolean }>('/api/wallet/spins', { method: 'POST', body: { topupId } });
  },
  async activateSpin(userId: string) { return pb.send<{ id: string; alreadyActive: boolean }>('/api/admin/wallet-spin/sessions', { method: 'POST', body: { userId } }); },
  async getSpinSessions() { return pb.send<{ id: string; status: string; created: string }[]>('/api/wallet/spin-sessions', { method: 'GET' }); },
  async spinSession(id: string) { return pb.send<{ prizeName: string; prizeAmount: number; alreadySpun: boolean }>(`/api/wallet/spin-sessions/${encodeURIComponent(id)}`, { method: 'POST' }); },
};

export interface WalletSpinPrize { name: string; amount: number; probability: number }
export interface WalletSpinItem { topupId: string; amount: number; eligible: boolean; created: string; result: { id: string; prizeName: string; prizeAmount: number; created: string } | null }

export const xuService = {
  getMine() {
    return pb.send<XuSummary>('/api/xu/me', { method: 'GET' });
  },
  getTransactions(page = 1, perPage = 20) {
    return pb.send<XuTransactionPage>(`/api/xu/me/transactions?page=${page}&perPage=${perPage}`, { method: 'GET' });
  },
  checkin() {
    return pb.send<XuCheckinResult>('/api/xu/checkin', { method: 'POST', body: {} });
  },
  getReferral() {
    return pb.send<XuReferralSummary>('/api/xu/referral', { method: 'GET' });
  },
  listRewards() {
    return pb.send<XuReward[]>('/api/xu/rewards', { method: 'GET' });
  },
  redeem(rewardId: string, idempotencyKey: string) {
    return pb.send<XuRedemption>('/api/xu/redeem', { method: 'POST', body: { rewardId, idempotencyKey } });
  },
  listRedemptions() {
    return pb.send<XuRedemption[]>('/api/xu/redemptions', { method: 'GET' });
  },
  getAdminSettings() {
    return pb.send<XuSettings>('/api/admin/xu/settings', { method: 'GET' });
  },
  updateAdminSettings(input: Omit<XuSettings, 'store'>) {
    return pb.send<XuSettings>('/api/admin/xu/settings', { method: 'PATCH', body: input });
  },
  listAdminUsers(query = '') {
    return pb.send<XuAdminUser[]>(`/api/admin/xu/users?q=${encodeURIComponent(query)}`, { method: 'GET' });
  },
  adjust(input: { userId: string; direction: 'credit' | 'debit'; amount: number; reason: string; idempotencyKey: string }) {
    return pb.send<XuSummary>('/api/admin/xu/adjust', { method: 'POST', body: input });
  },
  listAdminRewards() {
    return pb.send<XuReward[]>('/api/admin/xu/rewards', { method: 'GET' });
  },
  createReward(input: { name: string; description: string; cost: number; stock: number; active: boolean }) {
    return pb.send<XuReward>('/api/admin/xu/rewards', { method: 'POST', body: input });
  },
  updateReward(id: string, input: Partial<Pick<XuReward, 'name' | 'description' | 'cost' | 'stock' | 'active'>>) {
    return pb.send<XuReward>(`/api/admin/xu/rewards/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
  },
  deactivateReward(id: string) {
    return pb.send<XuReward>(`/api/admin/xu/rewards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  listAdminRedemptions(status = '') {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return pb.send<(XuRedemption & { username: string })[]>(`/api/admin/xu/redemptions${query}`, { method: 'GET' });
  },
  updateRedemption(id: string, status: 'approved' | 'rejected' | 'fulfilled', note = '') {
    return pb.send<XuRedemption>(`/api/admin/xu/redemptions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status, note } });
  },
};
