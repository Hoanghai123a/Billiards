import PocketBase from 'pocketbase';

const apiBaseUrl = (
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/public/pb`
    : import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8390'
).replace(/\/+$/, '');

const pb = new PocketBase(apiBaseUrl);

pb.autoCancellation(false);
pb.afterSend = (response, data) => {
  if (response.status === 401 && pb.authStore.token) pb.authStore.clear();
  return data;
};

export default pb;

export interface Store {
  id: string;
  name: string;
  service_type: 'billiard' | 'restaurant' | 'other';
  address?: string;
  phone?: string;
  email?: string;
  created: string;
  updated: string;
}

export interface BillPaymentSettings {
  bankId: string;
  accountNumber: string;
  accountName: string;
  tingeeVirtualAccount: string;
}

export interface AdminNotification {
  id: string;
  type: "table_bill_wallet" | "table_bill_transfer";
  title: string;
  body: string;
  referenceType: string;
  referenceId: string;
  created: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  fullname?: string;
  zalo_id?: string;
  store?: string;
  role?: 'admin' | 'staff' | 'user';
  verified: boolean;
  is_approved?: boolean;
  is_locked?: boolean;
  created: string;
  updated: string;
}

export interface ProductTimePeriod {
  price: number;
  durationMinutes: number;
}

export interface ProductSpecialPeriod {
  name: string;
  price: number;
  durationMinutes?: number;
  allDay: boolean;
  startTime: string;
  endTime: string;
  weekdays: number[];
}

export interface ProductTimePricing {
  intervalMinutes: number;
  firstPeriod: ProductTimePeriod | null;
  specialPeriod: ProductSpecialPeriod | null;
}

export interface ProductCategory {
  id: string;
  store: string;
  name: string;
  created: string;
  updated: string;
}

export interface Product {
  id: string;
  store: string;
  name: string;
  description?: string;
  price: number;
  purchase_price?: number;
  kind: 'goods' | 'food' | 'drink' | 'service';
  requires_preparation?: boolean;
  category?: string;
  billing_unit: 'hour' | 'quantity' | 'weight';
  unit_label?: string;
  time_pricing?: ProductTimePricing | null;
  image?: string;
  is_active: boolean;
  created: string;
  updated: string;
}

export type ProductInput = Omit<Partial<Product>, "image"> & { image?: string | File };

export interface Table {
  id: string;
  store: string;
  name: string;
  status: 'available' | 'occupied' | 'reserved';
  table_type: 'dining' | 'billiards' | 'karaoke' | 'other';
  row_number: number;
  position: number;
  playingSince?: string;
  created: string;
  updated: string;
}

export interface TableLayout {
  rowCount: number;
  tablesPerRow: number[];
  sortOrder: 'row' | 'column';
}

export interface TableCanvasPosition {
  x: number;
  y: number;
}

export interface TableOpenBillSummary {
  id: string;
  table: string;
  customer: string;
  status: 'open' | 'wallet_pending';
}

export interface TableMap {
  layout: TableLayout;
  tables: Table[];
  activeBills: TableOpenBillSummary[];
}

export interface TableBillItem {
  id: string;
  product: string;
  name: string;
  billingUnit: 'hour' | 'quantity' | 'weight';
  unitLabel: string;
  unitPrice: number;
  quantity: number;
  startedAt: string;
  addedAt?: string;
  stoppedAt?: string;
  lineTotal: number;
  queueStatus?: '' | 'pending' | 'done' | 'cancelled' | 'approval_pending' | 'rejected';
  queuedAt?: string;
  queueCompletedAt?: string;
  queueCancelledAt?: string;
  timePricing?: ProductTimePricing | null;
  timeBreakdown?: { type: 'first' | 'regular' | 'special'; label: string; startAt: string; endAt: string; durationMinutes: number; billedDurationMinutes: number; amount: number }[];
}

export interface StaffQueueItem {
  id: string;
  billId: string;
  billStatus: TableBill['status'];
  tableName: string;
  name: string;
  quantity: number;
  amount?: number;
  unitLabel: string;
  queuedAt: string;
  completedAt: string;
  actorName: string;
  sourceRole?: 'admin' | 'staff' | 'user';
  actionLabel?: string;
}

export interface TableBillSessionItem {
  id: string;
  tableName: string;
  status: 'open' | 'wallet_pending' | 'stopped' | 'paid' | 'cancelled';
  paymentMethod: '' | 'cash' | 'transfer' | 'wallet';
  totalAmount: number;
  paymentRequested: boolean;
  startedAt: string;
  stoppedAt: string;
  paidAt: string;
}

export interface TableBillSessionSummary {
  sessionId: string;
  bills: TableBillSessionItem[];
  totalAmount: number;
  outstandingAmount: number;
}

export interface TableBill {
  id: string;
  table: string;
  tableName: string;
  customer: string;
  status: 'open' | 'wallet_pending' | 'stopped' | 'paid' | 'cancelled';
  sessionId: string;
  stoppedAt?: string;
  paymentRequested?: boolean;
  paymentMethod: '' | 'cash' | 'transfer' | 'wallet';
  totalAmount: number;
  requestedAmount: number;
  grossAmount: number;
  discountAmount: number;
  promotion?: PromotionSnapshot | null;
  paymentError: string;
  billingPaused?: boolean;
  billingPausedAt?: string;
  startedAt: string;
  paidAt: string;
  cashReceived?: number;
  paidByName?: string;
  items: TableBillItem[];
}

export interface StaffAccount {
  id: string;
  username: string;
  fullname: string;
  phone: string;
  role: 'admin' | 'staff' | 'user';
  approved: boolean;
  locked: boolean;
}

export interface StaffAttendance {
  id: string;
  staff: string;
  workDate: string;
  status: 'present' | 'absent';
  checkIn: string;
  checkOut: string;
}

export interface AuditLog {
  id: string;
  store: string;
  actor: string;
  action: string;
  collection: string;
  record_id?: string;
  details?: string;
  created: string;
  expand?: { actor?: User };
}

export interface PromotionSnapshot {
  id: string;
  name: string;
  promotionType: 'percent' | 'amount' | 'fixed_price';
  value: number;
  scope: 'invoice' | 'category' | 'product';
  audience: 'all' | 'group' | 'card';
  minInvoiceAmount: number;
  maxDiscount: number;
  autoApply: boolean;
  startAt: string;
  endAt: string;
  weekdays: number[];
  timeStart: string;
  timeEnd: string;
  targetCategories: string[];
  targetProducts: { id: string; name: string }[];
  targetGroups: { id: string; name: string }[];
  targetCards: { id: string; name: string; code: string }[];
}

export interface Promotion {
  id: string;
  store?: string;
  name: string;
  active: boolean;
  promotionType: 'percent' | 'amount' | 'fixed_price';
  value: number;
  minInvoiceAmount: number;
  maxDiscount: number;
  autoApply: boolean;
  startAt: string;
  endAt: string;
  weekdays: number[];
  timeStart: string;
  timeEnd: string;
  scope: 'invoice' | 'category' | 'product';
  targetCategories: string[];
  targetProducts: string[];
  audience: 'all' | 'group' | 'card';
  targetGroups: string[];
  targetCards: string[];
  created?: string;
  updated?: string;
}
export interface CustomerSegmentGroup { id: string; name: string; active: boolean; members: number; }
export interface CustomerSegmentCard { id: string; code: string; name: string; active: boolean; members: number; }
export interface CustomerSegmentUser { id: string; username: string; fullname: string; }
export interface CustomerSegmentData {
  groups: CustomerSegmentGroup[];
  cards: CustomerSegmentCard[];
  users: CustomerSegmentUser[];
  memberships: { id: string; group: string; user: string }[];
  cardMemberships: { id: string; card: string; user: string; cardNumber: string }[];
}

export interface TableBillHistoryEvent {
  id: string;
  billId: string;
  tableName: string;
  category: "payment" | "action";
  eventType: string;
  title: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  paymentMethod: "" | "cash" | "transfer" | "wallet";
  amount: number;
  details: Record<string, unknown>;
  happenedAt: string;
}

export interface TableBillingReport {
  from: string;
  to: string;
  summary: { totalRevenue: number; paidBills: number; cashAmount: number; transferAmount: number; walletAmount: number };
  daily: { date: string; paidBills: number; cashAmount: number; transferAmount: number; walletAmount: number; totalRevenue: number }[];
  hourly: { hour: string; paidBills: number; cashAmount: number; transferAmount: number; walletAmount: number; totalRevenue: number }[];
  tables: { tableName: string; paidBills: number; totalRevenue: number; cashAmount: number; transferAmount: number; walletAmount: number }[];
  products: { productId: string; name: string; unitLabel: string; quantity: number; revenue: number; billCount: number; history: { billId: string; tableName: string; paidAt: string; quantity: number; amount: number }[] }[];
  payments: { id: string; billId: string; tableName: string; amount: number; paymentMethod: "cash" | "transfer" | "wallet"; paidAt: string; actorId: string; actorName: string; items: { productId: string; name: string; category: string; unitLabel: string; quantity: number; amount: number }[] }[];
  accounts: { id: string; name: string }[];
  categories: string[];
  page: number;
  hasMore: boolean;
}

export interface TableBillProductHistoryItem {
  billId: string;
  tableName: string;
  paidAt: string;
  quantity: number;
  amount: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  billingUnit: Product['billing_unit'];
  unitLabel: string;
  purchasePrice: number;
  onHand: number;
  reserved: number;
  available: number;
  output10Days: number;
  outputDays10: number;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  movementType: 'in' | 'sale' | 'adjustment';
  quantityDelta: number;
  unitCost: number;
  note: string;
  actorName: string;
  occurredAt: string;
}

export interface InventorySettings {
  inventoryRequired: boolean;
}

export interface AdminDashboardReport {
  from: string;
  to: string;
  summary: { totalRevenue: number; goodsCost: number; otherExpenses: number; totalExpenses: number; profit: number; paidBills: number };
  products: { productId: string; name: string; unitLabel: string; outputQuantity: number; revenue: number; cost: number; profit: number }[];
  daily: { date: string; revenue: number; productCost: number; expenses: number; profit: number }[];
  hourly: { hour: string; revenue: number; productCost: number; expenses: number; profit: number }[];
  expenses: { id: string; amount: number; category: string; note: string; spentAt: string }[];
}

export interface TableBillProduct extends Pick<Product, 'id' | 'store' | 'name' | 'description' | 'kind' | 'price'> {
  category: string;
  image?: string;
  billingUnit: 'hour' | 'quantity' | 'weight';
  unitLabel: string;
  timePricing?: ProductTimePricing | null;
}

export interface TableBillCustomer {
  id: string;
  username: string;
  fullname: string;
}

export interface Customer {
  id: string;
  store: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  created: string;
  updated: string;
}

export interface WalletPromoLot {
  id: string;
  originalAmount: number;
  remainingAmount: number;
  expiresAt: string;
  status: 'active' | 'expired' | 'consumed';
}

export interface WalletPromoTier {
  minTopup: number;
  type: 'fixed' | 'percent';
  value: number;
}

export interface WalletPromoSettings {
  tiers: WalletPromoTier[];
  maxPromoBalance: number;
  expiryMode: 'days' | 'date';
  expiryDate: string;
}

export interface WalletSummary {
  id: string;
  user: string;
  store: string;
  mainBalance: number;
  promoBalance: number;
  promoLots: WalletPromoLot[];
}

export interface WalletTransaction {
  id: string;
  wallet: string;
  user: string;
  store: string;
  wallet_type: 'main' | 'promo';
  direction: 'credit' | 'debit';
  amount: number;
  reason: string;
  actor?: string;
  promo_lot?: string;
  reference_type?: string;
  reference_id?: string;
  balance_before: number;
  balance_after: number;
  created: string;
}

export interface WalletTransactionPage {
  page: number;
  perPage: number;
  totalItems: number;
  items: WalletTransaction[];
}

export type WalletTopupStatus = 'pending' | 'paid' | 'rejected' | 'expired';

export interface WalletTopup {
  id: string;
  store: string;
  user: string;
  username?: string;
  fullname?: string;
  amount: number;
  status: WalletTopupStatus;
  transferCode: string;
  proof: string;
  note: string;
  reviewedBy: string;
  reviewedAt: string;
  rejectionReason: string;
  gatewayTransactionId: string;
  idempotencyKey: string;
  created: string;
  updated: string;
}

export interface WalletTopupPayment {
  bankId: string;
  accountNumber: string;
  accountName: string;
  qrCodeImage?: string;
}

export interface WalletTopupCreateResult {
  topup: WalletTopup;
  payment: WalletTopupPayment;
  alreadyCreated: boolean;
}

export interface WalletUser {
  id: string;
  username: string;
  email: string;
  role: string;
}

export interface WalletOrder {
  id: string;
  user: string;
  store: string;
  table?: string;
  totalAmount: number;
  status: 'unpaid' | 'paid' | 'cancelled';
  paymentMethod?: string;
  paidAt?: string;
}

export interface XuSummary {
  id: string;
  user: string;
  store: string;
  balance: number;
  checkedInToday?: boolean;
  weeklyCheckinCount?: number;
}

export interface XuTransaction {
  id: string;
  account: string;
  user: string;
  store: string;
  direction: 'credit' | 'debit';
  amount: number;
  reason: string;
  actor?: string;
  referenceType?: string;
  referenceId?: string;
  balanceBefore: number;
  balanceAfter: number;
  created: string;
}

export interface XuTransactionPage {
  page: number;
  perPage: number;
  totalItems: number;
  items: XuTransaction[];
}

export interface XuSettings {
  store: string;
  dailyCheckinReward: number;
  weeklyCheckinReward: number;
  referralReward: number;
  referral5Reward: number;
  referral10Reward: number;
}

export interface XuReward {
  id: string;
  store: string;
  name: string;
  description: string;
  cost: number;
  stock: number;
  active: boolean;
  created: string;
}

export interface XuRedemption {
  id: string;
  user: string;
  store: string;
  reward: string;
  rewardName: string;
  cost: number;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  note: string;
  created: string;
  updated: string;
  username?: string;
  fullname?: string;
}

export interface XuReferralSummary {
  code: string;
  approvedCount: number;
  pendingCount: number;
  milestones: number[];
}

export interface XuCheckinResult {
  checkedIn: boolean;
  alreadyCheckedIn: boolean;
  dailyReward: number;
  weeklyReward: number;
  balance: number;
}

export interface XuAdminUser {
  id: string;
  username: string;
  fullname: string;
  phone: string;
  isApproved: boolean;
  balance: number;
  approvedReferrals: number;
}
