import pb, { Store, User, Product, ProductInput, ProductCategory, Table, TableLayout, TableMap, TableBill, TableBillSessionSummary, TableBillCustomer, TableBillProduct, TableBillHistoryEvent, TableBillingReport, AdminDashboardReport, InventoryItem, InventoryMovement, InventorySettings, Customer, WalletOrder, WalletSummary, WalletTransactionPage, WalletUser, WalletTopup, WalletTopupCreateResult, WalletTopupPayment, XuAdminUser, XuCheckinResult, XuRedemption, XuReferralSummary, XuReward, XuSettings, XuSummary, XuTransactionPage, BillPaymentSettings, AdminNotification, Promotion, CustomerSegmentData, StaffAccount, StaffQueueItem, TableCanvasPosition, UserTableLayout } from './pocketbase';

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
  getSettings() {
    return pb.send<BillPaymentSettings>('/api/table-billing/payment-settings', { method: 'GET' });
  },
  saveSettings(settings: BillPaymentSettings) {
    return pb.send<BillPaymentSettings>('/api/table-billing/payment-settings', { method: 'PATCH', body: settings });
  },
};

export const productService = {
  async listAdmin(storeId: string) {
    return await pb.collection('products').getFullList<Product>({
      filter: `store="${storeId}"`,
      sort: 'category,name',
    });
  },

  async create(data: ProductInput) {
    return await pb.collection('products').create<Product>(data);
  },

  async update(id: string, data: ProductInput) {
    return await pb.collection('products').update<Product>(id, data);
  },

  async delete(id: string) {
    return await pb.collection('products').delete(id);
  }
};

export const productCategoryService = {
  async list(storeId: string) {
    return await pb.collection('product_categories').getFullList<ProductCategory>({
      filter: `store="${storeId}"`,
      sort: 'name',
    });
  },

  async create(data: Pick<ProductCategory, 'store' | 'name'>) {
    return await pb.collection('product_categories').create<ProductCategory>(data);
  },

  async delete(id: string) {
    return await pb.collection('product_categories').delete(id);
  },
};

export const promotionService = {
  async list() { return pb.send<{ items: Promotion[] }>('/api/admin/promotions', { method: 'GET' }); },
  async create(input: Partial<Promotion>) { return pb.send<Promotion>('/api/admin/promotions', { method: 'POST', body: input }); },
  async update(id: string, input: Partial<Promotion>) { return pb.send<Promotion>('/api/admin/promotions', { method: 'POST', body: { ...input, id } }); },
  async remove(id: string) { return pb.send<{ ok: boolean }>('/api/admin/promotions', { method: 'DELETE', body: { id } }); },
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

  async start(tableId: string, customerId = '') {
    return pb.send<{ ok: boolean; billId: string }>('/api/table-billing/action', { method: 'POST', body: { action: 'start', tableId, customerId } });
  },

  async delete(id: string, password: string) {
    return pb.send<{ ok: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'delete_table', tableId: id, password } });
  },

  async updateStatus(id: string, status: Table['status']) {
    return pb.send<{ ok: boolean }>('/api/table-billing/action', { method: 'POST', body: { action: 'set_table_status', tableId: id, status } });
  },

  async rename(id: string, name: string) {
    return pb.send<{ ok: boolean; name: string }>('/api/table-billing/action', { method: 'POST', body: { action: 'rename_table', tableId: id, name } });
  },

  async getUserLayout(storeId: string, userId: string) {
    try {
      return await pb.collection('user_table_layouts').getFirstListItem<UserTableLayout>(`store="${storeId}" && user="${userId}"`);
    } catch (error: any) {
      if (error?.status === 404) return null;
      throw error;
    }
  },

  async saveUserLayout(storeId: string, userId: string, positions: Record<string, TableCanvasPosition>) {
    const current = await this.getUserLayout(storeId, userId);
    if (current) return pb.collection('user_table_layouts').update<UserTableLayout>(current.id, { positions });
    return pb.collection('user_table_layouts').create<UserTableLayout>({ store: storeId, user: userId, positions });
  }
};

export const tableBillingService = {
  async getQueue(history = false) {
    return pb.send<{ items: StaffQueueItem[] }>('/api/table-billing/action', { method: 'POST', body: { action: 'queue_list', history } });
  },
  async getOrderRequests(history = false) {
    return pb.send<{ items: StaffQueueItem[] }>('/api/table-billing/action', { method: 'POST', body: { action: 'request_list', history } });
  },
  async updateOrderRequest(billId: string, itemId: string, approve: boolean) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: approve ? 'request_approve' : 'request_reject', billId, itemId } });
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
    return pb.send<{ items: TableBillProduct[] }>('/api/table-billing/products', { method: 'GET' });
  },
  async getCustomers() {
    return pb.send<{ items: TableBillCustomer[] }>('/api/table-billing/customers', { method: 'GET' });
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
  async updateItem(billId: string, itemId: string, quantity: number) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'update_item', billId, itemId, quantity } });
  },
  async updateItemTime(billId: string, itemId: string, startedAt: string, stoppedAt: string) {
    return pb.send<{ ok: boolean; bill: TableBill }>('/api/table-billing/action', { method: 'POST', body: { action: 'update_item_time', billId, itemId, startedAt, stoppedAt } });
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
  async report(input: { from: string; to: string; tableName?: string; productName?: string; paymentMethod?: string; page?: number }) {
    const query = new URLSearchParams({ from: input.from, to: input.to });
    if (input.tableName) query.set('tableName', input.tableName);
    if (input.productName) query.set('productName', input.productName);
    if (input.paymentMethod) query.set('paymentMethod', input.paymentMethod);
    if (input.page) query.set('page', String(input.page));
    const result = await pb.send<TableBillingReport>(`/api/table-billing/report?${query.toString()}`, { method: 'GET' });
    let payments = (result.payments || []).map((payment) => ({ ...payment, items: payment.items || [] }));
    let tables = result.tables || [];
    let products = result.products || [];
    if (payments.length && (!tables.length || !products.length)) {
      const details = await Promise.all(payments.map((payment) => tableBillingService.getDetail(payment.billId).catch(() => null)));
      const tableMap: Record<string, { tableName: string; paidBills: number; totalRevenue: number; cashAmount: number; transferAmount: number; walletAmount: number }> = {};
      const productMap: Record<string, { productId: string; name: string; unitLabel: string; quantity: number; revenue: number; billCount: number }> = {};
      const productBills: Record<string, Record<string, boolean>> = {};
      payments = payments.map((payment, index) => {
        const items = (details[index]?.items || []).filter((item) => !['cancelled', 'approval_pending', 'rejected'].includes(item.queueStatus || '')).map((item) => ({ productId: item.product, name: item.name, unitLabel: item.unitLabel || 'lần', quantity: item.quantity, amount: item.lineTotal }));
        const table = tableMap[payment.tableName] || { tableName: payment.tableName, paidBills: 0, totalRevenue: 0, cashAmount: 0, transferAmount: 0, walletAmount: 0 };
        table.paidBills += 1;
        table.totalRevenue += payment.amount;
        if (payment.paymentMethod === 'cash') table.cashAmount += payment.amount;
        if (payment.paymentMethod === 'transfer') table.transferAmount += payment.amount;
        if (payment.paymentMethod === 'wallet') table.walletAmount += payment.amount;
        tableMap[payment.tableName] = table;
        for (const item of items) {
          const key = item.productId || item.name;
          const product = productMap[key] || { productId: item.productId, name: item.name, unitLabel: item.unitLabel, quantity: 0, revenue: 0, billCount: 0 };
          product.quantity += item.quantity;
          product.revenue += item.amount;
          const bills = productBills[key] || {};
          if (!bills[payment.billId]) { product.billCount += 1; bills[payment.billId] = true; productBills[key] = bills; }
          productMap[key] = product;
        }
        return { ...payment, items };
      });
      tables = Object.values(tableMap);
      products = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
    }
    return {
      ...result,
      daily: result.daily || [],
      tables,
      products,
      payments,
    };
  },
};

export const inventoryService = {
  getSettings() {
    return pb.send<InventorySettings>('/api/admin/inventory/settings', { method: 'GET' });
  },
  saveSettings(inventoryRequired: boolean) {
    return pb.send<InventorySettings>('/api/admin/inventory/settings', { method: 'PATCH', body: { inventoryRequired } });
  },
  async list(search = '') {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return pb.send<{ items: InventoryItem[]; movements: InventoryMovement[] }>(`/api/admin/inventory${query}`, { method: 'GET' });
  },
  async move(input: { productId: string; movementType: 'in' | 'adjustment'; quantity: number; unitCost: number; note: string }) {
    return pb.send<{ ok: boolean; onHand: number; reserved: number; available: number }>('/api/admin/inventory/movement', { method: 'POST', body: input });
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
};

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
