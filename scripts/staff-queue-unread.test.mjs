import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const { code } = transformSync(readFileSync(new URL('../src/contexts/StaffQueueContext.tsx', import.meta.url), 'utf8'), {
  loader: 'tsx', format: 'cjs', jsx: 'automatic',
});
const operator = { id: 'staff1', store: 'store1', role: 'staff' };

// Exercise the actual provider with deterministic hook lifecycles and a mocked SSE transport.
function fixture(storage = new Map(), storageBlocked = false) {
  let user = operator;
  let cursor = 0;
  let subscriptions = 0;
  const slots = [];
  const pendingEffects = [];
  const listeners = new Set();
  const changed = (previous, next) => !previous || next.some((value, index) => !Object.is(value, previous[index]));
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useContext() {},
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!changed(slots[index]?.deps, deps)) return;
      slots[index]?.cleanup?.();
      slots[index] = { deps };
      pendingEffects.push(() => { slots[index].cleanup = effect(); });
    },
  };
  const localStorage = {
    getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); storage.set(key, value); },
  };
  const pb = {
    collection(name) {
      assert.equal(name, 'staff_queue_signals');
      return { subscribe(topic, callback) {
        assert.equal(topic, '*');
        subscriptions++;
        listeners.add(callback);
        return Promise.resolve(async () => { listeners.delete(callback); });
      } };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console, window: { localStorage },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name === '@/api/pocketbase') return pb;
      if (name === '@/contexts/AuthContext') return { useAuth: () => ({ user }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return {
    render(page = '/home') {
      cursor = 0;
      const tree = module.exports.StaffQueueProvider({ children: page });
      pendingEffects.splice(0).forEach((effect) => effect());
      return tree.props.value;
    },
    emit(record = {}, action = 'update') {
      for (const callback of listeners) callback({ action, record: { store: 'store1', actor_id: 'staff2', event_type: 'history', ...record } });
    },
    setUser(next) { user = next; },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
    get subscriptions() { return subscriptions; },
    get listenerCount() { return listeners.size; },
  };
}

test('updates received on another page stay unread through navigation until history is explicitly opened', () => {
  const state = fixture();
  assert.equal(state.render('/account').historyUnread, false);
  state.emit();
  assert.equal(state.render('/account').historyUnread, true);
  assert.equal(state.render('/staff/queue').historyUnread, true);
  assert.equal(state.render('requests').historyUnread, true);
  assert.equal(state.render('/home').historyUnread, true);
  assert.equal(state.subscriptions, 1);
  state.render('/staff/queue').markHistoryRead();
  assert.equal(state.render('history').historyUnread, false);
  assert.equal(state.render('/home').historyUnread, false);
  state.emit();
  assert.equal(state.render().historyUnread, true);
});

test('unread and acknowledged states survive a full provider remount', () => {
  const storage = new Map();
  const first = fixture(storage);
  first.render();
  first.emit();
  first.unmount();
  const reloaded = fixture(storage);
  assert.equal(reloaded.render().historyUnread, true);
  reloaded.render().markHistoryRead();
  reloaded.unmount();
  assert.equal(fixture(storage).render().historyUnread, false);
});

test('own actions, other stores, deleted signals and ordinary queue refreshes do not create unread history', () => {
  const state = fixture();
  state.render();
  state.emit({ actor_id: 'staff1' });
  state.emit({ actor_id: '' });
  state.emit({ store: 'store2' });
  state.emit({ event_type: 'queue' });
  state.emit({}, 'delete');
  assert.equal(state.render().historyUnread, false);
  assert.equal(state.render().revision, 4);
  state.emit();
  state.emit({ event_type: 'queue' });
  state.emit({ actor_id: 'staff1' });
  assert.equal(state.render().historyUnread, true);
});

test('unread history is isolated by account and store, and customers never subscribe', async () => {
  const state = fixture();
  state.render();
  state.emit();
  state.setUser({ ...operator, id: 'admin1', role: 'admin' });
  assert.equal(state.render().historyUnread, false);
  state.emit();
  assert.equal(state.render().historyUnread, true);
  state.render().markHistoryRead();
  state.setUser({ ...operator, store: 'store2' });
  assert.equal(state.render().historyUnread, false);
  state.setUser(operator);
  assert.equal(state.render().historyUnread, true);
  state.setUser({ ...operator, role: 'user' });
  assert.equal(state.render().historyUnread, false);
  await Promise.resolve();
  assert.equal(state.listenerCount, 0);
});

test('an unresolved subscription is cleaned up and cannot set unread after unmount', async () => {
  const state = fixture();
  state.render();
  state.unmount();
  state.emit();
  assert.equal(state.render().historyUnread, false);
  await Promise.resolve();
  assert.equal(state.listenerCount, 0);
});

test('unread history still works in memory when browser storage is unavailable', () => {
  const state = fixture(new Map(), true);
  state.render();
  state.emit();
  assert.equal(state.render().historyUnread, true);
  state.render().markHistoryRead();
  assert.equal(state.render().historyUnread, false);
});
