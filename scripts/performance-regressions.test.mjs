import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("data-loading effects do not depend on the unstable snackbar wrapper", () => {
  for (const path of [
    "src/pages/admin-wallet-spin.tsx",
    "src/pages/admin-wallet-promo-settings.tsx",
    "src/pages/xu.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /openSnackbarRef\.current/);
    assert.doesNotMatch(source, /\[[^\]]*openSnackbar[^\]]*\]\);\s*\n\s*useEffect/);
  }
});

test("reports and inventory batch related records instead of querying per row", () => {
  const billing = read("pocketbase/pb_hooks/table_billing.pb.js");
  const inventory = read("pocketbase/pb_hooks/inventory_profit.pb.js");
  assert.match(billing, /const itemsByBill = \{\}/);
  assert.match(billing, /const billItems = itemsByBill\[billId\] \|\| \[\]/);
  assert.match(inventory, /const linesByBill = \{\}/);
  assert.match(inventory, /const onHandByProduct = \{\}/);
  assert.match(inventory, /const reservedByProduct = \{\}/);
});

test("wallet refresh uses realtime with a bounded fallback and server pagination", () => {
  const walletPage = read("src/pages/wallet.tsx");
  const walletHook = read("pocketbase/pb_hooks/wallet_api.pb.js");
  const migration = read("pocketbase/pb_migrations/1794369000_wallet_query_indexes.js");
  assert.match(walletPage, /collection\("wallets"\)\.subscribe/);
  assert.match(walletPage, /collection\("wallet_transactions"\)\.subscribe/);
  assert.match(walletPage, /setInterval\(refreshWhenVisible, 60000\)/);
  assert.doesNotMatch(walletPage, /setInterval\(refreshWhenVisible, 5000\)/);
  assert.match(walletHook, /COUNT\(\*\) AS count FROM wallet_transactions/);
  assert.match(walletHook, /"-created", perPage, start/);
  assert.match(migration, /idx_wallet_topups_store_user_status_created/);
});

test("routes are loaded on demand and bill detail does not reload the table map", () => {
  const layout = read("src/components/layout.tsx");
  const playing = read("src/pages/playing.tsx");
  assert.match(layout, /lazy\(\(\) => import\("@\/pages\/tables"\)\)/);
  assert.match(layout, /<Suspense fallback=/);
  assert.match(layout, /class AppErrorBoundary/);
  assert.match(layout, /Tải lại ứng dụng/);
  assert.match(layout, /return <LoadingScreen \/>/);
  assert.doesNotMatch(layout, /import TablesPage from "@\/pages\/tables"/);
  assert.doesNotMatch(playing, /sequentialTableName/);
  assert.match(playing, /const result = await tableBillingService\.getDetail\(bill\.id\)/);
});

test("table map uses realtime refresh and only active clocks rerender each second", () => {
  const tables = read("src/pages/tables.tsx");
  const notificationRules = read("pocketbase/pb_migrations/1794370000_admin_notification_realtime_rules.js");
  assert.match(tables, /collection\("tables"\)\.subscribe/);
  assert.match(tables, /collection\("admin_notifications"\)\.subscribe/);
  assert.match(tables, /setInterval\(refreshWhenVisible, 60000\)/);
  assert.match(tables, /function ElapsedClock/);
  assert.match(tables, /document\.visibilityState === "visible"/);
  assert.doesNotMatch(tables, /setClockTick/);
  assert.match(notificationRules, /recipient = @request\.auth\.id && store = @request\.auth\.store/);
});

test("safe reference data uses scoped session cache and still revalidates", () => {
  const cache = read("src/utils/session-cache.ts");
  const auth = read("src/contexts/AuthContext.tsx");
  const account = read("src/pages/account.tsx");
  const playing = read("src/pages/playing.tsx");
  assert.match(cache, /Date\.now\(\) - entry\.savedAt <= maxAgeMs/);
  assert.match(cache, /sessionStorage\.getItem/);
  assert.match(auth, /billiard:stores:v1/);
  assert.match(account, /billiard:vietqr-banks:v1/);
  assert.match(playing, /billiard:products:\$\{user\.store\}:v1/);
  assert.match(playing, /tableBillingService\.getProducts\(\)\.then/);
});

test("public bill polling cannot overlap and malformed auth tokens are cleared", () => {
  const publicBill = read("src/pages/public-bill.tsx");
  const auth = read("src/contexts/AuthContext.tsx");
  assert.match(publicBill, /load\(\)\.finally/);
  assert.match(publicBill, /setTimeout\(refresh, 5000\)/);
  assert.doesNotMatch(publicBill, /setInterval\([^\n]*5000/);
  assert.match(auth, /getTokenPayload\(token\)\.exp/);
  assert.match(auth, /catch \{\s*pb\.authStore\.clear\(\)/);
});

test("unused legacy menu components and their dependencies stay removed", () => {
  const packageJson = JSON.parse(read("package.json"));
  for (const path of ["src/components/table.tsx", "src/pages/menu.tsx", "src/components/product-card.tsx"]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false);
  }
  for (const name of ["axios", "dayjs", "jotai"]) assert.equal(packageJson.dependencies[name], undefined);
});
