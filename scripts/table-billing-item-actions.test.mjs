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
function fixture(role = 'staff', { bill = {}, item = {}, failHistory = false } = {}) {
  let records = [
    new Record('table_bills', 'bill1', { store: 'store1', table: 'table1', customer: 'actor1', status: 'open', ...bill }),
    new Record('table_bill_items', 'item1', { store: 'store1', bill: 'bill1', product_name: 'Nước suối', billing_unit: 'quantity', quantity: 2, unit_price: 10000, line_total: 20000, ...item }),
    new Record('tables', 'table1', { store: 'store1', name: 'Bàn 1' }),
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
      return records.filter((row) => row.collection === collection && (!params.bill || row.get('bill') === params.bill) && (!params.store || row.get('store') === params.store));
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
  return {
    records: () => records,
    act(action, input = {}) {
      return routes.get('POST /api/table-billing/action')({
        requestInfo: () => ({ auth, body: { action, billId: 'bill1', itemId: 'item1', ...input } }),
        json: (status, body) => ({ status, body }),
      });
    },
  };
}

const events = (state) => state.records().filter((row) => row.collection === 'table_bill_events');
const details = (state) => JSON.parse(events(state)[0].get('details'));

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

for (const role of ['admin', 'staff']) {
  test(`${role} quantity changes log old and new values`, () => {
    const state = fixture(role);
    assert.equal(state.act('update_item', { quantity: 3 }).body.bill.totalAmount, 30000);
    assert.equal(events(state)[0].get('event_type'), 'quantity_changed');
    assert.equal(details(state).oldQuantity, 2);
    assert.equal(details(state).newQuantity, 3);
    assert.equal(details(state).oldLineTotal, 20000);
    assert.equal(details(state).newLineTotal, 30000);
  });

  test(`${role} time changes are logged and deletion snapshots current time charges`, () => {
    const state = fixture(role, { item: { billing_unit: 'hour', unit_price: 60000, quantity: 0, line_total: 0, started_at: '2026-01-01T00:00:00Z' } });
    const stoppedAt = '2026-01-01T01:00:00Z';
    state.act('update_item_time', { startedAt: '2026-01-01T00:00:00Z', stoppedAt });
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
