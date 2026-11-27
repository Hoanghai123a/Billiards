import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../pocketbase/pb_hooks/table_billing.pb.js', import.meta.url), 'utf8');
const queueSource = readFileSync(new URL('../pocketbase/pb_hooks/staff_queue.js', import.meta.url), 'utf8');

class Record {
  constructor(collection, id = '', fields = {}) {
    this.collection = collection;
    this.id = id;
    this.fields = { ...fields };
  }
  get(key) { return this.fields[key] ?? ''; }
  getString(key) { return String(this.get(key)); }
  getBool(key) { return Boolean(this.get(key)); }
  set(key, value) { this.fields[key] = value; }
}

// Run the real route with an in-memory transactional store; no live data is used.
function fixture(role = 'staff', { bill = {}, item = {}, extraItems = [], historyEvents = [], failHistory = false } = {}) {
  let records = [
    new Record('table_bills', 'bill1', { store: 'store1', table: 'table00000000001', customer: 'actor1', status: 'open', ...bill }),
    new Record('table_bill_items', 'item1', { store: 'store1', bill: 'bill1', product_name: 'Nước suối', billing_unit: 'quantity', quantity: 2, unit_price: 10000, line_total: 20000, ...item }),
    new Record('tables', 'table00000000001', { store: 'store1', name: 'Bàn 1' }),
    new Record('products', 'product1', { store: 'store1', name: 'Coca', description: '', kind: 'drink', billing_unit: 'quantity', unit_label: 'lon', price: 12000, is_active: true }),
    new Record('products', 'hourly1', { store: 'store1', name: 'Bàn bida', kind: 'service', billing_unit: 'hour', unit_label: 'giờ', price: 60000, is_active: true }),
    new Record('tables', 'table00000000002', { store: 'store1', name: 'Bàn 2' }),
    ...extraItems.map(({ id, ...fields }) => new Record('table_bill_items', id, { store: 'store1', bill: 'bill1', product_name: 'Coca', billing_unit: 'quantity', quantity: 1, unit_price: 10000, line_total: 10000, ...fields })),
    ...historyEvents.map(({ id, ...fields }) => new Record('table_bill_events', id, { store: 'store1', bill_id: 'bill1', category: 'payment', event_type: 'payment_completed', ...fields })),
  ];
  const auth = new Record('users', 'actor1', { store: 'store1', role, fullname: 'Nguyễn Văn An' });
  const hooks = new Map();
  let afterCommit = [];
  const hookGlobals = {
    Record, console, __hooks: '/pb_hooks',
    require(path) {
      assert.equal(path, '/pb_hooks/staff_queue.js');
      const module = { exports: {} };
      vm.runInNewContext(queueSource, { module, Record, console });
      return module.exports;
    },
  };
  const app = {
    findRecordById(collection, id) {
      const record = records.find((row) => row.collection === collection && row.id === id);
      if (!record) throw new Error('Record not found');
      return record;
    },
    findCollectionByNameOrId(name) { return name; },
    findFirstRecordByFilter(collection, filter, params) {
      const record = records.find((row) => row.collection === collection && row.get('store') === params.store);
      if (!record) throw new Error('Record not found');
      return record;
    },
    findRecordsByFilter(collection, filter, sort, limit, offset, params = {}) {
      return records.filter((row) => row.collection === collection && (!params.bill || row.get(collection === 'table_bill_events' ? 'bill_id' : 'bill') === params.bill) && (!params.store || row.get('store') === params.store) && (!params.table || row.get('table') === params.table) && (!params.category || row.get('category') === params.category) && (!params.actor || row.get('actor_id') === params.actor) && (!filter.includes("category = 'payment'") || row.get('category') === 'payment') && (collection !== 'products' || (row.get('is_active') === true && row.get('billing_unit') !== 'hour')));
    },
    save(record) {
      if (failHistory && record.collection === 'table_bill_events') throw new Error('History unavailable');
      const isNew = !records.includes(record);
      if (isNew) records.push(record);
      if (record.collection === 'table_bill_items') afterCommit.push({ type: isNew ? 'create' : 'update', record });
    },
    delete(record) {
      records = records.filter((row) => row !== record);
      if (record.collection === 'table_bill_items') afterCommit.push({ type: 'delete', record });
    },
    runInTransaction(callback) {
      const snapshot = records.map((row) => new Record(row.collection, row.id, row.fields));
      try { callback(app); } catch (error) { records = snapshot; afterCommit = []; throw error; }
      const pending = afterCommit;
      afterCommit = [];
      for (const { type, record } of pending) {
        // PocketBase serializes callbacks into separate runtimes without outer variables.
        const hook = vm.runInNewContext(`(${hooks.get(type).toString()})`, hookGlobals);
        hook({ app, record, next() {} });
      }
    },
  };
  const routes = new Map();
  vm.runInNewContext(source, {
    $app: app, Record, console,
    __hooks: '/pb_hooks', require: hookGlobals.require,
    BadRequestError: class BadRequestError extends Error {},
    ForbiddenError: class ForbiddenError extends Error {},
    UnauthorizedError: class UnauthorizedError extends Error {},
    routerAdd(method, path, handler) { routes.set(`${method} ${path}`, handler); },
    onRecordAfterCreateSuccess(handler) { hooks.set('create', handler); },
    onRecordAfterUpdateSuccess(handler) { hooks.set('update', handler); },
    onRecordAfterDeleteSuccess(handler) { hooks.set('delete', handler); },
  });
  const actionRoute = routes.get('POST /api/table-billing/action');
  routes.set('POST /api/table-billing/action', vm.runInNewContext(`(${actionRoute.toString()})`, {
    $app: app, Record, console,
    __hooks: '/pb_hooks', require: hookGlobals.require,
    BadRequestError: class BadRequestError extends Error {},
    ForbiddenError: class ForbiddenError extends Error {},
    UnauthorizedError: class UnauthorizedError extends Error {},
  }));
  return {
    records: () => records,
    act(action, input = {}, requestAuth = auth) {
      return routes.get('POST /api/table-billing/action')({
        requestInfo: () => ({ auth: requestAuth, body: { action, billId: 'bill1', itemId: 'item1', ...input } }),
        json: (status, body) => ({ status, body }),
      });
    },
    history(query = {}, requestAuth = auth) {
      return routes.get('GET /api/table-billing/history')({
        requestInfo: () => ({ auth: requestAuth, query }),
        json: (status, body) => ({ status, body }),
      });
    },
  };
}

const events = (state) => state.records().filter((row) => row.collection === 'table_bill_events');
const details = (state) => JSON.parse(events(state)[0].get('details'));

test('staff history only returns their own payment events, including on a bill query', () => {
  const state = fixture('staff', { historyEvents: [
    { id: 'own-payment', actor_id: 'actor1' },
    { id: 'other-payment', actor_id: 'staff2' },
    { id: 'own-action', actor_id: 'actor1', category: 'action', event_type: 'item_removed' },
  ] });
  assert.deepEqual(state.history({ category: 'payment' }).body.items.map((event) => event.id), ['own-payment']);
  assert.deepEqual(state.history({ billId: 'bill1' }).body.items.map((event) => event.id), ['own-payment']);
  assert.throws(() => state.history({ billId: 'bill1', category: 'action' }), /chỉ được xem lịch sử thanh toán/);
});

test('admins retain store-wide payment history', () => {
  const state = fixture('admin', { historyEvents: [
    { id: 'staff1-payment', actor_id: 'actor1' },
    { id: 'staff2-payment', actor_id: 'staff2' },
  ] });
  assert.deepEqual(state.history({ category: 'payment' }).body.items.map((event) => event.id), ['staff1-payment', 'staff2-payment']);
});

test('approval-pending orders use the requests realtime signal', () => {
  const module = { exports: {} };
  vm.runInNewContext(queueSource, { module, Record, console });
  assert.equal(module.exports.signalEventType(new Record('table_bill_items', 'item1', { queue_status: 'approval_pending' })), 'requests');
});

for (const action of ['update_item', 'update_item_time', 'delete_item']) {
  test(`user cannot call ${action} directly`, () => {
    const state = fixture('user');
    assert.throws(() => state.act(action, { quantity: 3, reason: 'Lý do' }), /Chỉ admin hoặc nhân viên/);
    assert.equal(state.records().find((row) => row.id === 'item1').get('quantity'), 2);
    assert.equal(events(state).length, 0);
  });
}

test('staff deletion requires a valid nonempty reason before any mutation', () => {
  for (const reason of [undefined, '', ' \n\t ', null, 123, {}, 'x'.repeat(501)]) {
    const state = fixture();
    assert.throws(() => state.act('delete_item', { reason }), /lý do|Lý do/);
    assert.ok(state.records().some((row) => row.id === 'item1'));
    assert.equal(events(state).length, 0);
  }
});

test('staff deletion stores trimmed Vietnamese reason, actor and item snapshot', () => {
  const state = fixture();
  const result = state.act('delete_item', { reason: '  Khách đổi món, chưa phục vụ  ' });
  assert.equal(result.status, 200);
  assert.equal(result.body.bill.items.length, 0);
  assert.equal(result.body.bill.totalAmount, 0);
  assert.equal(events(state).length, 1);
  assert.equal(events(state)[0].get('actor_role'), 'staff');
  assert.equal(events(state)[0].get('actor_id'), 'actor1');
  assert.equal(events(state)[0].get('actor_name'), 'Nguyễn Văn An');
  assert.ok(events(state)[0].get('happened_at'));
  assert.equal(details(state).reason, 'Khách đổi món, chưa phục vụ');
  assert.equal(details(state).productName, 'Nước suối');
  assert.equal(details(state).quantity, 2);
  assert.equal(details(state).lineTotal, 20000);
  assert.equal(state.records().find((row) => row.collection === 'staff_queue_signals').get('revision'), 1);
});

test('admin can delete directly without a reason and still gets history', () => {
  const state = fixture('admin');
  assert.equal(state.act('delete_item').status, 200);
  assert.equal(events(state)[0].get('actor_role'), 'admin');
  assert.equal(details(state).reason, '');
});

test('staff marking a transfer as unreceived resumes the unpaid bill and hourly timer', () => {
  const state = fixture('staff', {
    bill: { status: 'wallet_pending', payment_method: 'transfer', wallet_requested_at: '2026-11-16T00:00:00.000Z', payment_requester: '', requested_amount: 20000, total_amount: 20000, stopped_at: '2026-11-16T00:10:00.000Z' },
    item: { billing_unit: 'hour', started_at: '2026-11-16T00:00:00.000Z', stopped_at: '2026-11-16T00:10:00.000Z' },
  });
  const result = state.act('payment_request_unreceived');
  const bill = state.records().find((row) => row.collection === 'table_bills');
  const item = state.records().find((row) => row.collection === 'table_bill_items');
  assert.equal(result.status, 200);
  assert.equal(bill.get('status'), 'open');
  assert.notEqual(bill.get('status'), 'paid');
  assert.equal(bill.get('stopped_at'), '');
  assert.equal(item.get('stopped_at'), '');
  assert.equal(bill.get('payment_method'), '');
  assert.equal(bill.get('wallet_requested_at'), '');
  assert.equal(bill.get('requested_amount'), 0);
  assert.match(bill.get('payment_error'), /Chưa nhận được tiền/);
  assert.equal(events(state)[0].get('event_type'), 'payment_failed');
});

test('public bill link can request transfer without login and freezes the payable amount for review', () => {
  const state = fixture('staff');
  assert.throws(() => state.act('public_request_transfer', { tableId: 'table00000000001', billId: 'stale-bill-id' }, null), /Bill đã thay đổi/);
  assert.equal(state.records().find((row) => row.collection === 'table_bills').get('status'), 'open');
  const result = state.act('public_request_transfer', { tableId: 'table00000000001' }, null);
  const bill = state.records().find((row) => row.collection === 'table_bills');
  assert.equal(result.status, 200);
  assert.equal(bill.get('status'), 'wallet_pending');
  assert.equal(bill.get('payment_method'), 'transfer');
  assert.equal(bill.get('requested_amount'), 20000);
  assert.ok(bill.get('wallet_requested_at'));
  assert.equal(events(state)[0].get('event_type'), 'payment_requested');
  assert.equal(events(state)[0].get('actor_role'), '');
});

test('public table link resolves its current bill by table id without login', () => {
  const state = fixture('staff');
  const result = state.act('public_detail', { tableId: 'table00000000001' }, null);
  assert.equal(result.status, 200);
  assert.equal(result.body.tableName, 'Bàn 1');
  assert.equal(result.body.bill.id, 'bill1');
});

test('public table link shows the latest paid bill and an empty bill slot when no bill exists', () => {
  const paid = fixture('staff', { bill: { status: 'paid' } });
  assert.equal(paid.act('public_detail', { tableId: 'table00000000001' }, null).body.bill.status, 'paid');
  const empty = fixture('staff');
  empty.records().splice(0, 1);
  const result = empty.act('public_detail', { tableId: 'table00000000001' }, null);
  assert.equal(result.body.bill, null);
  assert.equal(result.body.tableName, 'Bàn 1');
});

test('closed hourly bills calculate through the bill stop time', () => {
  const state = fixture('staff', {
    bill: { status: 'paid', stopped_at: '2026-11-16T00:10:00.000Z', paid_at: '2026-11-16T00:11:00.000Z' },
    item: { billing_unit: 'hour', started_at: '2026-11-16T00:00:00.000Z', unit_price: 60000, time_pricing: JSON.stringify({ intervalMinutes: 60 }) },
  });
  const bill = state.act('public_detail', { tableId: 'table00000000001' }, null).body.bill;
  assert.equal(bill.items[0].lineTotal, 60000);
});

test('public menu omits hourly products and public orders wait for store approval', () => {
  const state = fixture();
  const menu = state.act('public_detail', { tableId: 'table00000000001' }, null).body.menu;
  assert.deepEqual(menu.map((product) => product.name), ['Coca']);
  const result = state.act('public_order', {
    tableId: 'table00000000001',
    billId: 'bill1',
    items: [{ productId: 'product1', quantity: 2 }],
  }, null);
  const requested = state.records().find((row) => row.collection === 'table_bill_items' && row.get('product') === 'product1');
  const bill = state.records().find((row) => row.collection === 'table_bills');
  const signal = state.records().find((row) => row.collection === 'staff_queue_signals');
  assert.equal(result.status, 200);
  assert.equal(requested.get('queue_status'), 'approval_pending');
  assert.equal(requested.get('line_total'), 0);
  assert.equal(bill.get('total_amount'), 20000);
  assert.equal(events(state)[0].get('event_type'), 'order_requested');
  assert.equal(signal.get('revision'), 1);
});

test('public orders reject hourly products and stale table bills', () => {
  const state = fixture();
  assert.throws(() => state.act('public_order', {
    tableId: 'table00000000001', billId: 'bill1', items: [{ productId: 'hourly1', quantity: 1 }],
  }, null), /Không thể gọi món tính theo giờ/);
  assert.equal(state.records().filter((row) => row.collection === 'table_bill_items').length, 1);
  assert.throws(() => state.act('public_order', {
    tableId: 'table00000000002', billId: 'bill1', items: [{ productId: 'product1', quantity: 1 }],
  }, null), /Bill đã thay đổi/);
  assert.equal(state.records().filter((row) => row.collection === 'table_bill_items').length, 1);
});

test('public multi-item order rolls back completely when one item is invalid', () => {
  const state = fixture();
  assert.throws(() => state.act('public_order', {
    tableId: 'table00000000001', billId: 'bill1',
    items: [{ productId: 'product1', quantity: 1 }, { productId: 'missing', quantity: 1 }],
  }, null));
  assert.equal(state.records().filter((row) => row.collection === 'table_bill_items').length, 1);
  assert.equal(events(state).length, 0);
  assert.equal(state.records().find((row) => row.collection === 'table_bills').get('total_amount'), '');
});

for (const role of ['admin', 'staff']) {
  test(`${role} quantity changes log old and new values`, () => {
    const state = fixture(role);
    assert.equal(state.act('update_item', { quantity: 3, ...(role === 'staff' ? { reason: 'Điều chỉnh theo yêu cầu khách' } : {}) }).body.bill.totalAmount, 30000);
    assert.equal(events(state)[0].get('event_type'), 'quantity_changed');
    assert.equal(details(state).oldQuantity, 2);
    assert.equal(details(state).newQuantity, 3);
    assert.equal(details(state).oldLineTotal, 20000);
    assert.equal(details(state).newLineTotal, 30000);
  });

  test(`${role} time changes are logged and deletion snapshots current time charges`, () => {
    const state = fixture(role, { item: { billing_unit: 'hour', unit_price: 60000, quantity: 0, line_total: 0, started_at: '2026-01-01T00:00:00Z' } });
    const stoppedAt = '2026-01-01T01:00:00Z';
    state.act('update_item_time', { startedAt: '2026-01-01T00:00:00Z', stoppedAt, ...(role === 'staff' ? { reason: 'Điều chỉnh theo yêu cầu khách' } : {}) });
    assert.equal(events(state)[0].get('event_type'), 'item_time_changed');
    assert.equal(details(state).newStoppedAt, '2026-01-01T01:00:00.000Z');
    state.act('delete_item', { reason: 'Sửa nhầm giờ' });
    const removed = JSON.parse(events(state)[1].get('details'));
    assert.equal(removed.quantity, 1);
    assert.equal(removed.lineTotal, 60000);
    assert.equal(removed.stoppedAt, '2026-01-01T01:00:00.000Z');
    assert.equal(state.records().find((row) => row.collection === 'staff_queue_signals').get('revision'), 2);
  });
}

test('queue hooks load their helper in isolated runtimes for create, update and delete', () => {
  const callbacks = [];
  const capture = (callback) => callbacks.push(callback);
  vm.runInNewContext(source, { routerAdd() {}, onRecordAfterCreateSuccess: capture, onRecordAfterUpdateSuccess: capture, onRecordAfterDeleteSuccess: capture });
  for (const callback of callbacks) {
    let signalled = false;
    let continued = false;
    const isolated = vm.runInNewContext(`(${callback.toString()})`, {
      __hooks: '/pb_hooks',
      require(path) {
        assert.equal(path, '/pb_hooks/staff_queue.js');
        return {
          requestActorId: () => '',
          signalEventType: () => 'queue',
          signalStaffQueue(app, store) { assert.equal(store, 'store1'); signalled = true; },
        };
      },
    });
    isolated({ app: {}, record: new Record('table_bill_items', 'item1', { store: 'store1' }), next() { continued = true; } });
    assert.ok(signalled);
    assert.ok(continued);
  }
  assert.equal(callbacks.length, 3);
});

test('queue hooks do not fail item writes when the helper cannot load', () => {
  const callbacks = [];
  const capture = (callback) => callbacks.push(callback);
  vm.runInNewContext(source, { routerAdd() {}, onRecordAfterCreateSuccess: capture, onRecordAfterUpdateSuccess: capture, onRecordAfterDeleteSuccess: capture });
  for (const callback of callbacks) {
    let continued = false;
    const isolated = vm.runInNewContext(`(${callback.toString()})`, {
      __hooks: '/pb_hooks',
      require() { throw new Error('helper unavailable'); },
    });
    isolated({ app: {}, record: new Record('table_bill_items', 'item1', { store: 'store1' }), next() { continued = true; } });
    assert.ok(continued);
  }
});

test('bill and item store boundaries, closed bills and paused bills block deletion', () => {
  for (const options of [{ bill: { store: 'other' } }, { item: { store: 'other' } }, { item: { bill: 'other' } }, { bill: { status: 'paid' } }, { bill: { billing_paused_at: '2026-01-01T00:00:00Z' } }]) {
    const state = fixture('staff', options);
    assert.throws(() => state.act('delete_item', { reason: 'Đổi món' }));
    assert.ok(state.records().some((row) => row.id === 'item1'));
    assert.equal(events(state).length, 0);
  }
});

test('item mutations roll back if history cannot be saved', () => {
  for (const action of ['delete_item', 'update_item', 'update_item_time']) {
    const state = fixture('staff', { failHistory: true, item: action === 'update_item_time' ? { billing_unit: 'hour', started_at: '2026-01-01T00:00:00Z' } : {} });
    assert.throws(() => state.act(action, { reason: 'Đổi món', quantity: 3, startedAt: '2026-01-01T00:10:00Z', stoppedAt: '2026-01-01T01:00:00Z' }), /History unavailable/);
    const item = state.records().find((row) => row.id === 'item1');
    assert.equal(item.get('quantity'), 2);
    assert.equal(item.get('line_total'), 20000);
    assert.equal(item.get('stopped_at'), '');
    assert.equal(events(state).length, 0);
  }
});

test('repeating queue completion is idempotent after the item is already done', () => {
  const state = fixture('staff', { item: { queue_status: 'done', queue_completed_at: '2026-01-01T00:10:00Z' } });
  const result = state.act('queue_done');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(state.records().find((row) => row.id === 'item1').get('queue_status'), 'done');
  assert.equal(events(state).length, 0);
});

test('queue completion still rejects cancelled items', () => {
  const state = fixture('staff', { item: { queue_status: 'cancelled' } });
  assert.throws(() => state.act('queue_done'), /Món đã được người khác xử lý/);
  assert.equal(events(state).length, 0);
});

test('queue completion updates a pending item and records one history event', () => {
  const state = fixture('staff', { item: { queue_status: 'pending', queued_at: '2026-01-01T00:00:00Z' } });
  const result = state.act('queue_done');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(state.records().find((row) => row.id === 'item1').get('queue_status'), 'done');
  assert.equal(events(state).length, 1);
  assert.equal(events(state)[0].get('event_type'), 'queue_completed');
  assert.equal(state.records().find((row) => row.collection === 'staff_queue_signals').get('revision'), 1);
});

test('staff approves every item in one order request atomically', () => {
  const state = fixture('staff', { item: { queue_status: 'approval_pending' }, extraItems: [{ id: 'item2', queue_status: 'approval_pending' }] });
  const result = state.act('request_approve', { itemIds: ['item1', 'item2'] });
  assert.equal(result.status, 200);
  assert.deepEqual(state.records().filter((row) => row.collection === 'table_bill_items').map((row) => row.get('queue_status')), ['done', 'done']);
  assert.equal(events(state).length, 2);
});

test('group approval rolls back when one requested item is invalid', () => {
  const state = fixture('staff', { item: { queue_status: 'approval_pending' }, extraItems: [{ id: 'item2', queue_status: 'done' }] });
  assert.throws(() => state.act('request_approve', { itemIds: ['item1', 'item2'] }), /đã được xử lý/);
  assert.equal(state.records().find((row) => row.id === 'item1').get('queue_status'), 'approval_pending');
  assert.equal(events(state).length, 0);
});
