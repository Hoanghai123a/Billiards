/// <reference path="../pb_data/types.d.ts" />

onRecordAfterCreateSuccess((e) => {
  try {
    const queue = require(`${__hooks}/staff_queue.js`);
    const eventType = queue.signalEventType(e.record);
    if (eventType !== "history")
      queue.signalStaffQueue(
        e.app,
        e.record.get("store"),
        queue.requestActorId(e),
        eventType,
      );
  } catch (e) {}
  return e.next();
}, "table_bill_items");

onRecordAfterUpdateSuccess((e) => {
  try {
    const queue = require(`${__hooks}/staff_queue.js`);
    const eventType = queue.signalEventType(e.record);
    if (eventType !== "history")
      queue.signalStaffQueue(
        e.app,
        e.record.get("store"),
        queue.requestActorId(e),
        eventType,
      );
  } catch (e) {}
  return e.next();
}, "table_bill_items");

onRecordAfterDeleteSuccess((e) => {
  try {
    const queue = require(`${__hooks}/staff_queue.js`);
    queue.signalStaffQueue(
      e.app,
      e.record.get("store"),
      queue.requestActorId(e),
      "queue",
    );
  } catch (e) {}
  return e.next();
}, "table_bill_items");

const roundPaymentAmount = (value) => {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return amount >= 1000 ? Math.floor(amount / 1000) * 1000 : amount;
};

routerAdd("GET", "/api/admin/notifications", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin")
    throw new ForbiddenError("Chỉ admin mới được xem thông báo");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  let notifications = [];
  try {
    notifications = $app.findRecordsByFilter(
      "admin_notifications",
      "store = {:store} && recipient = {:recipient} && read = false",
      "-created",
      50,
      0,
      { store, recipient: auth.id },
    );
  } catch (e) {}
  return c.json(200, {
    items: notifications.map((item) => ({
      id: item.id,
      type: item.get("type"),
      title: item.get("title"),
      body: item.get("body"),
      referenceType: item.get("reference_type") || "",
      referenceId: item.get("reference_id") || "",
      created: item.get("created"),
    })),
  });
});

routerAdd("PATCH", "/api/admin/notifications/read", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin")
    throw new ForbiddenError("Chỉ admin mới được cập nhật thông báo");
  const store = String(auth.get("store") || "");
  const input = info.body || {};
  const id = String(input.id || "");
  let notifications = [];
  try {
    notifications = id
      ? [$app.findRecordById("admin_notifications", id)]
      : $app.findRecordsByFilter(
          "admin_notifications",
          "store = {:store} && recipient = {:recipient} && read = false",
          "-created",
          -1,
          0,
          { store, recipient: auth.id },
        );
  } catch (e) {
    return c.json(200, { ok: true });
  }
  for (const notification of notifications) {
    if (
      notification.get("store") !== store ||
      notification.get("recipient") !== auth.id
    )
      continue;
    notification.set("read", true);
    $app.save(notification);
  }
  return c.json(200, { ok: true });
});

routerAdd("GET", "/api/table-billing/history", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const query = info.query || {};
  const billId = String(query.billId || "");
  const category = String(query.category || "");
  const search = String(query.search || "")
    .trim()
    .slice(0, 80);
  const page = Number(query.page || 1);
  const isAdmin = !!auth && auth.get("role") === "admin";
  const isStaff = !!auth && auth.get("role") === "staff";
  const canOperateBill = isAdmin || isStaff;
  if (!Number.isSafeInteger(page) || page < 1)
    throw new BadRequestError("Trang lịch sử không hợp lệ");
  if (category && !["payment", "action"].includes(category))
    throw new BadRequestError("Loại lịch sử không hợp lệ");
  if (isStaff && category && category !== "payment")
    throw new ForbiddenError("Nhân viên chỉ được xem lịch sử thanh toán");
  if (billId) {
    const bill = $app.findRecordById("table_bills", billId);
    if (bill.get("store") !== store)
      throw new ForbiddenError("Hóa đơn khác cửa hàng");
    if (!canOperateBill && bill.get("customer") !== auth.id)
      throw new ForbiddenError("Không có quyền xem lịch sử hóa đơn");
  } else if (!isAdmin && !(isStaff && category === "payment"))
    throw new ForbiddenError("Chỉ admin mới được xem lịch sử cửa hàng");

  let filter = "store = {:store} && event_type != 'payment_started'";
  const params = { store };
  if (isStaff) {
    filter += " && category = 'payment' && actor_id = {:actor}";
    params.actor = auth.id;
  }
  if (billId) {
    filter += " && bill_id = {:bill}";
    params.bill = billId;
  }
  if (category) {
    filter += " && category = {:category}";
    params.category = category;
  }
  if (search) {
    filter +=
      " && (table_name ~ {:search} || actor_name ~ {:search} || title ~ {:search})";
    params.search = search;
  }
  const events = $app.findRecordsByFilter(
    "table_bill_events",
    filter,
    "-happened_at",
    51,
    (page - 1) * 50,
    params,
  );
  const hasMore = events.length > 50;
  const items = events.slice(0, 50).map((event) => {
    let details = event.get("details") || {};
    if (typeof details === "string") {
      try {
        details = details ? JSON.parse(details) : {};
      } catch (e) {
        details = {};
      }
    }
    return {
      id: event.id,
      billId: event.get("bill_id"),
      tableName: event.get("table_name"),
      category: event.get("category"),
      eventType: event.get("event_type"),
      title: event.get("title"),
      actorId: event.get("actor_id") || "",
      actorName: event.get("actor_name") || "Hệ thống",
      actorRole: event.get("actor_role") || "",
      paymentMethod: event.get("payment_method") || "",
      amount: Number(event.get("amount")) || 0,
      details,
      happenedAt: event.get("happened_at") || event.get("created"),
    };
  });
  return c.json(200, { items, page, hasMore });
});

routerAdd("GET", "/api/table-billing/report", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin")
    throw new ForbiddenError("Chỉ admin mới được xem báo cáo");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const query = info.query || {};
  const from = String(query.from || "");
  const to = String(query.to || "");
  const tableName = String(query.tableName || "")
    .trim()
    .slice(0, 100);
  const productName = String(query.productName || "")
    .trim()
    .slice(0, 100);
  const paymentMethod = String(query.paymentMethod || "");
  const accountId = String(query.accountId || "").trim().slice(0, 40);
  const selectedCategory = String(query.category || "").trim().slice(0, 80);
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 50);
  const parseRange = (value, end) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(`${value}T00:00:00+07:00`);
      return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
        ? new Date(parsed.getTime() + (end ? 86400000 : 0))
        : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
      return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
      ? new Date(parsed.getTime() + (end ? 60000 : 0))
      : null;
  };
  const fromDate = parseRange(from, false);
  const toDate = parseRange(to, true);
  if (!fromDate || !toDate || fromDate >= toDate)
    throw new BadRequestError("Khoảng thời gian không hợp lệ");
  if (toDate.getTime() - fromDate.getTime() > 32 * 24 * 60 * 60 * 1000)
    throw new BadRequestError("Chỉ được lọc tối đa 32 ngày");
  if (!Number.isSafeInteger(page) || page < 1)
    throw new BadRequestError("Trang báo cáo không hợp lệ");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000)
    throw new BadRequestError("Số dòng báo cáo không hợp lệ");
  if (paymentMethod && !["cash", "transfer", "wallet"].includes(paymentMethod))
    throw new BadRequestError("Phương thức thanh toán không hợp lệ");
  const fromDb = fromDate.toISOString().replace("T", " ");
  const toDb = toDate.toISOString().replace("T", " ");
  let filter =
    "store = {:store} && category = 'payment' && event_type = 'payment_completed' && happened_at >= {:from} && happened_at < {:to}";
  const params = { store, from: fromDb, to: toDb };
  if (tableName) {
    filter += " && table_name ~ {:tableName}";
    params.tableName = tableName;
  }
  if (paymentMethod) {
    filter += " && payment_method = {:paymentMethod}";
    params.paymentMethod = paymentMethod;
  }
  const events = $app.findRecordsByFilter(
    "table_bill_events",
    filter,
    "-happened_at",
    -1,
    0,
    params,
  );
  const accountOptions = {};
  for (const event of events) {
    const id = String(event.get("actor_id") || "");
    if (id) accountOptions[id] = String(event.get("actor_name") || "Không rõ");
  }
  const productCategories = {};
  const categoryOptions = { "Khác": true };
  const storeProducts = $app.findRecordsByFilter("products", "store = {:store}", "category,name", -1, 0, { store });
  for (const product of storeProducts) {
    const category = String(product.get("category") || "").trim() || "Khác";
    productCategories[product.id] = category;
    categoryOptions[category] = true;
  }
  const accounts = Object.keys(accountOptions).map((id) => ({ id, name: accountOptions[id] })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const categories = Object.keys(categoryOptions).sort((a, b) => a.localeCompare(b, "vi"));
  const seenBills = {};
  const daily = {};
  const hourly = {};
  const payments = [];
  const tables = {};
  const products = {};
  const itemsByBill = {};
  $app.findRecordsByFilter(
    "table_bill_items",
    "store = {:store} && bill.status = 'paid' && bill.paid_at >= {:from} && bill.paid_at < {:to}",
    "created",
    -1,
    0,
    { store, from: fromDb, to: toDb },
  ).forEach((item) => {
    const billId = String(item.get("bill") || "");
    if (billId) (itemsByBill[billId] ||= []).push(item);
  });
  let totalRevenue = 0;
  let cashAmount = 0;
  let transferAmount = 0;
  let walletAmount = 0;
  for (const event of events) {
    const billId = String(event.get("bill_id") || event.id);
    if (seenBills[billId]) continue;
    if (accountId && String(event.get("actor_id") || "") !== accountId) continue;
    seenBills[billId] = true;
    const paidAt = String(
      event.get("happened_at") || event.get("created") || "",
    );
    const localDate = new Date(new Date(paidAt).getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const hour = new Date(
      Math.floor((new Date(paidAt).getTime() + 7 * 60 * 60 * 1000) / 3600000) *
        3600000 -
        7 * 60 * 60 * 1000,
    ).toISOString();
    const amount = Math.max(0, Math.round(Number(event.get("amount")) || 0));
    const method = String(event.get("payment_method") || "");
    const billItems = itemsByBill[billId] || [];
    const paidItems = billItems
      .filter(
        (item) =>
          !["cancelled", "approval_pending", "rejected"].includes(
            String(item.get("queue_status") || ""),
          ),
      )
      .map((item) => ({
        productId: String(item.get("product") || ""),
        name: String(item.get("product_name") || "Mặt hàng"),
        category: productCategories[String(item.get("product") || "")] || "Khác",
        unitLabel: String(item.get("unit_label") || "lần"),
        quantity: Number(item.get("quantity")) || 0,
        amount: Math.max(0, Math.round(Number(item.get("line_total")) || 0)),
      }));
    const matchingItems = paidItems.filter((item) =>
      (!productName || item.name.toLocaleLowerCase().includes(productName.toLocaleLowerCase())) &&
      (!selectedCategory || item.category === selectedCategory),
    );
    if ((productName || selectedCategory) && matchingItems.length === 0) continue;
    const day = daily[localDate] || {
      date: localDate,
      paidBills: 0,
      cashAmount: 0,
      transferAmount: 0,
      walletAmount: 0,
      totalRevenue: 0,
    };
    day.paidBills += 1;
    day.totalRevenue += amount;
    if (method === "cash") {
      day.cashAmount += amount;
      cashAmount += amount;
    }
    if (method === "transfer") {
      day.transferAmount += amount;
      transferAmount += amount;
    }
    if (method === "wallet") {
      day.walletAmount += amount;
      walletAmount += amount;
    }
    daily[localDate] = day;
    const hourRow = hourly[hour] || {
      hour,
      paidBills: 0,
      cashAmount: 0,
      transferAmount: 0,
      walletAmount: 0,
      totalRevenue: 0,
    };
    hourRow.paidBills += 1;
    hourRow.totalRevenue += amount;
    if (method === "cash") hourRow.cashAmount += amount;
    if (method === "transfer") hourRow.transferAmount += amount;
    if (method === "wallet") hourRow.walletAmount += amount;
    hourly[hour] = hourRow;
    totalRevenue += amount;
    payments.push({
      id: event.id,
      billId,
      tableName: event.get("table_name") || "Bàn",
      amount,
      paymentMethod: method,
      paidAt,
      actorId: event.get("actor_id") || "",
      actorName: event.get("actor_name") || "Hệ thống",
    });
    payments[payments.length - 1].items = matchingItems;
    const table = tables[payments[payments.length - 1].tableName] || {
      tableName: payments[payments.length - 1].tableName,
      paidBills: 0,
      totalRevenue: 0,
      cashAmount: 0,
      transferAmount: 0,
      walletAmount: 0,
    };
    table.paidBills += 1;
    table.totalRevenue += amount;
    if (method === "cash") table.cashAmount += amount;
    if (method === "transfer") table.transferAmount += amount;
    if (method === "wallet") table.walletAmount += amount;
    tables[table.tableName] = table;
    for (const item of matchingItems) {
      const key = item.productId || item.name;
      const product = products[key] || {
        productId: item.productId,
        name: item.name,
        unitLabel: item.unitLabel,
        quantity: 0,
        revenue: 0,
        billCount: 0,
        bills: {},
        history: [],
      };
      product.quantity += item.quantity;
      product.revenue += item.amount;
      if (!product.bills[billId]) {
        product.billCount += 1;
        product.bills[billId] = true;
      }
      product.history.push({
        billId,
        tableName: event.get("table_name") || "Bàn",
        paidAt,
        quantity: item.quantity,
        amount: item.amount,
      });
      products[key] = product;
    }
  }
  const start = (page - 1) * pageSize;
  return c.json(200, {
    from,
    to,
    summary: {
      totalRevenue,
      paidBills: payments.length,
      cashAmount,
      transferAmount,
      walletAmount,
    },
    daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)),
    hourly: Object.values(hourly).sort((a, b) => a.hour.localeCompare(b.hour)),
    tables: Object.values(tables).sort((a, b) =>
      a.tableName.localeCompare(b.tableName, "vi"),
    ),
    products: Object.values(products)
      .map((product) => ({
        productId: product.productId,
        name: product.name,
        unitLabel: product.unitLabel,
        quantity: product.quantity,
        revenue: product.revenue,
        billCount: product.billCount,
        history: product.history,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    payments: payments.slice(start, start + pageSize),
    accounts,
    categories,
    page,
    hasMore: start + pageSize < payments.length,
  });
});

routerAdd("GET", "/api/admin/table-billing/report-settings", (c) => {
  const auth = c.requestInfo().auth || c.auth
  if (!auth) throw new UnauthorizedError("Cần đăng nhập")
  if (auth.get("role") !== "admin") throw new ForbiddenError("Chỉ admin mới được thao tác")
  const store = String(auth.get("store") || "")
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng")
  let settings = null
  try { settings = $app.findFirstRecordByFilter("report_settings", "store = {:store}", { store }) } catch (e) {}
  const defaults = [{ name: "Ca 1", start: "08:00", end: "20:00" }, { name: "Ca 2", start: "20:00", end: "08:00" }]
  let shifts = defaults
  let shiftType = 2
  if (settings) {
    shiftType = Number(settings.get("shift_type")) === 3 ? 3 : 2
    try { const parsed = JSON.parse(String(settings.get("shifts") || "[]")); if (Array.isArray(parsed) && parsed.length === shiftType) shifts = parsed } catch (e) {}
  }
  return c.json(200, { shiftType, shifts })
})

routerAdd("PATCH", "/api/admin/table-billing/report-settings", (c) => {
  const info = c.requestInfo()
  const auth = info.auth || c.auth
  if (!auth) throw new UnauthorizedError("Cần đăng nhập")
  if (auth.get("role") !== "admin") throw new ForbiddenError("Chỉ admin mới được thao tác")
  const store = String(auth.get("store") || "")
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng")
  const shiftType = Number(info.body && info.body.shiftType)
  const shifts = info.body && info.body.shifts
  if (![2, 3].includes(shiftType) || !Array.isArray(shifts) || shifts.length !== shiftType) throw new BadRequestError("Cấu hình số ca không hợp lệ")
  const cleanShifts = shifts.map((shift) => {
    const name = String(shift && shift.name || "").trim().slice(0, 40)
    const start = String(shift && shift.start || "")
    const end = String(shift && shift.end || "")
    if (!name || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end) || start === end) throw new BadRequestError("Giờ bắt đầu và kết thúc ca không hợp lệ")
    return { name, start, end }
  })
  if (cleanShifts.some((shift, index) => cleanShifts.some((other, otherIndex) => index !== otherIndex && shift.name.toLowerCase() === other.name.toLowerCase()))) throw new BadRequestError("Tên ca không được trùng")
  if (cleanShifts.some((shift, index) => shift.end !== cleanShifts[(index + 1) % shiftType].start)) throw new BadRequestError("Các ca phải nối tiếp nhau đủ 24 giờ")
  let settings
  try { settings = $app.findFirstRecordByFilter("report_settings", "store = {:store}", { store }) }
  catch (e) { settings = new Record($app.findCollectionByNameOrId("report_settings")); settings.set("store", store) }
  settings.set("shift_hours", 8)
  settings.set("shift_type", shiftType)
  settings.set("shifts", JSON.stringify(cleanShifts))
  settings.set("updated_by", auth.id)
  $app.save(settings)
  return c.json(200, { shiftType, shifts: cleanShifts })
})

routerAdd("GET", "/api/table-billing/product-history", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin") throw new ForbiddenError("Chỉ admin mới được xem lịch sử mặt hàng");
  const store = String(auth.get("store") || "");
  const query = info.query || {};
  const productId = String(query.productId || "").trim();
  const from = String(query.from || "");
  const to = String(query.to || "");
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (!store || !productId || !Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || fromDate >= toDate)
    throw new BadRequestError("Tham số lịch sử mặt hàng không hợp lệ");
  const items = $app.findRecordsByFilter(
    "table_bill_items",
    "store = {:store} && product = {:product} && bill.status = 'paid' && bill.paid_at >= {:from} && bill.paid_at < {:to}",
    "created",
    -1,
    0,
    { store, product: productId, from: fromDate.toISOString().replace("T", " "), to: toDate.toISOString().replace("T", " ") },
  );
  const history = items.map((item) => {
    const bill = $app.findRecordById("table_bills", String(item.get("bill") || ""));
    return {
      billId: bill.id,
      tableName: String(bill.get("table_name") || "Bàn"),
      paidAt: String(bill.get("paid_at") || ""),
      quantity: Number(item.get("quantity")) || 0,
      amount: Math.max(0, Math.round(Number(item.get("line_total")) || 0)),
    };
  });
  return c.json(200, { history });
});

routerAdd("GET", "/api/table-billing/payment-settings", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  let settings = null;
  try {
    settings = $app.findFirstRecordByFilter(
      "bill_payment_settings",
      "store = {:store}",
      { store },
    );
  } catch (e) {}
  return c.json(200, {
    bankId: settings ? settings.get("bank_id") || "" : "",
    accountNumber: settings ? settings.get("account_number") || "" : "",
    accountName: settings ? settings.get("account_name") || "" : "",
    tingeeVirtualAccount: settings ? settings.get("tingee_virtual_account") || "" : "",
  });
});

routerAdd("PATCH", "/api/table-billing/payment-settings", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin")
    throw new ForbiddenError("Chỉ admin mới được cập nhật tài khoản nhận tiền");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");

  const input = info.body || {};
  const bankId = String(input.bankId || "").trim();
  const accountNumber = String(input.accountNumber || "").replace(/\s+/g, "");
  const accountName = String(input.accountName || "").trim();
  const tingeeVirtualAccount = String(input.tingeeVirtualAccount || "").replace(/\s+/g, "").toUpperCase();
  const populatedFields = [bankId, accountNumber, accountName].filter(
    Boolean,
  ).length;
  if (populatedFields !== 0 && populatedFields !== 3)
    throw new BadRequestError(
      "Vui lòng nhập đầy đủ mã ngân hàng, số tài khoản và tên chủ tài khoản",
    );
  if (bankId && !/^[a-z0-9_-]{2,40}$/i.test(bankId))
    throw new BadRequestError("Mã ngân hàng VietQR không hợp lệ");
  if (accountNumber && !/^\d{4,24}$/.test(accountNumber))
    throw new BadRequestError("Số tài khoản phải gồm 4 đến 24 chữ số");
  if (accountName.length > 100)
    throw new BadRequestError("Tên chủ tài khoản tối đa 100 ký tự");
  if (tingeeVirtualAccount && !/^[A-Z0-9]{4,24}$/.test(tingeeVirtualAccount))
    throw new BadRequestError("Tài khoản ảo Tingee không hợp lệ");

  let settings = null;
  try {
    settings = $app.findFirstRecordByFilter(
      "bill_payment_settings",
      "store = {:store}",
      { store },
    );
  } catch (e) {}
  if (!settings)
    settings = new Record(
      $app.findCollectionByNameOrId("bill_payment_settings"),
    );
  settings.set("store", store);
  settings.set("bank_id", bankId);
  settings.set("account_number", accountNumber);
  settings.set("account_name", accountName);
  settings.set("tingee_virtual_account", tingeeVirtualAccount);
  $app.save(settings);
  return c.json(200, {
    bankId: settings.get("bank_id") || "",
    accountNumber: settings.get("account_number") || "",
    accountName: settings.get("account_name") || "",
    tingeeVirtualAccount: settings.get("tingee_virtual_account") || "",
  });
});

routerAdd("POST", "/api/table-billing/payment-qr", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  const input = info.body || {};
  const billId = String(input.billId || "").trim();
  const tableId = String(input.tableId || "").trim();
  const amount = Number(input.amount);
  const content = String(input.content || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, (character) => character === "Đ" ? "D" : "d").slice(0, 120);
  if (!billId || !Number.isSafeInteger(amount) || amount <= 0 || !content) throw new BadRequestError("Thông tin QR thanh toán không hợp lệ");
  let bill;
  try { bill = $app.findRecordById("table_bills", billId); } catch (e) { throw new BadRequestError("Không tìm thấy bill"); }
  const store = String(bill.get("store") || "");
  if (auth && String(auth.get("store") || "") !== store) throw new ForbiddenError("Bill không thuộc cửa hàng");
  if (!auth && (!tableId || String(bill.get("table") || "") !== tableId)) throw new ForbiddenError("Không có quyền xem bill");
  let settings;
  try {
    settings = $app.findFirstRecordByFilter("bill_payment_settings", "store = {:store}", { store });
  } catch (e) {
    throw new BadRequestError("Cửa hàng chưa cấu hình tài khoản nhận tiền");
  }
  if (!settings) throw new BadRequestError("Cửa hàng chưa cấu hình tài khoản nhận tiền");
  const accountNumber = String(settings.get("tingee_virtual_account") || "").trim().toUpperCase();
  const bankId = String(settings.get("bank_id") || "").trim();
  const bankAccountNumber = String(settings.get("account_number") || "").replace(/\s+/g, "");
  const accountName = String(settings.get("account_name") || "").trim();
  if (!accountNumber) {
    if (!bankId || !/^\d{4,24}$/.test(bankAccountNumber) || !accountName) throw new BadRequestError("Cửa hàng chưa cấu hình đầy đủ tài khoản nhận tiền");
    const qrParams = "bank=" + encodeURIComponent(bankId) + "&acc=" + encodeURIComponent(bankAccountNumber) + "&template=compact&amount=" + encodeURIComponent(String(amount)) + "&des=" + encodeURIComponent(content) + "&showinfo=true&holder=" + encodeURIComponent(accountName);
    return c.json(200, { qrCodeImage: "https://vietqr.app/img?" + qrParams, qrCode: "", qrAccount: bankAccountNumber });
  }
  const clientId = String($os.getenv("TINGEE_CLIENT_ID") || "").trim();
  const secret = String($os.getenv("TINGEE_SECRET") || "").trim();
  const bankName = String($os.getenv("TINGEE_BANK_NAME") || "BIDV").trim().toUpperCase();
  // Keep bill payment usable when the optional Tingee QR service is unavailable.
  if (!clientId || !secret) {
    if (!bankId || !/^\d{4,24}$/.test(bankAccountNumber) || !accountName) throw new BadRequestError("Cửa hàng chưa cấu hình đầy đủ tài khoản nhận tiền");
    const qrParams = "bank=" + encodeURIComponent(bankId) + "&acc=" + encodeURIComponent(bankAccountNumber) + "&template=compact&amount=" + encodeURIComponent(String(amount)) + "&des=" + encodeURIComponent(content) + "&showinfo=true&holder=" + encodeURIComponent(accountName);
    return c.json(200, { qrCodeImage: "https://vietqr.app/img?" + qrParams, qrCode: "", qrAccount: bankAccountNumber });
  }
  const timestamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
  const body = JSON.stringify({ bankName, accountNumber, amount, content });
  const signature = $security.hs512(timestamp + ":" + body, secret);
  const response = $http.send({ method: "POST", url: String($os.getenv("TINGEE_API_URL") || "https://open-api.tingee.vn/v1/generate-viet-qr"), headers: { "accept": "application/json", "Content-Type": "application/json", "x-request-timestamp": timestamp, "x-client-id": clientId, "x-signature": signature }, body });
  if (!response || Number(response.statusCode || 0) >= 400) throw new Error("Không thể tạo mã QR Tingee");
  const payload = response.json || (typeof response.body === "string" ? JSON.parse(response.body) : response.body);
  if (String(payload.code || "") !== "00" || !payload.data?.qrCodeImage) throw new Error(payload.message || "Tingee không tạo được mã QR");
  return c.json(200, { qrCodeImage: payload.data.qrCodeImage, qrCode: payload.data.qrCode || "", qrAccount: payload.data.qrAccount || accountNumber });
});

routerAdd("GET", "/api/table-billing/auto-open-products", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin") throw new ForbiddenError("Chỉ admin mới được xem cấu hình");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const record = $app.findRecordById("stores", store);
  let items = [];
  try { items = JSON.parse(record.getString("auto_open_products") || "[]"); } catch (e) {}
  return c.json(200, { items: Array.isArray(items) ? items : [] });
});

routerAdd("PATCH", "/api/table-billing/auto-open-products", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin") throw new ForbiddenError("Chỉ admin mới được cập nhật cấu hình");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const input = info.body || {};
  if (!Array.isArray(input.items) || input.items.length > 100) throw new BadRequestError("Danh sách mặt hàng tự thêm không hợp lệ");
  const seen = {};
  let hasHourlyProduct = false;
  const items = input.items.map((item) => {
    const productId = String(item.productId || "");
    const quantity = Number(item.quantity);
    if (!productId || seen[productId] || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) throw new BadRequestError("Mặt hàng hoặc số lượng mặc định không hợp lệ");
    seen[productId] = true;
    const product = $app.findRecordById("products", productId);
    if (product.get("store") !== store || product.get("is_active") !== true) throw new BadRequestError("Chỉ chọn mặt hàng đang bán tại cửa hàng");
    if (product.get("billing_unit") === "hour") {
      if (hasHourlyProduct) throw new BadRequestError("Chỉ được chọn một mặt hàng tính theo giờ");
      hasHourlyProduct = true;
      return { productId, quantity: 1 };
    }
    if (product.get("billing_unit") === "quantity" && !Number.isInteger(quantity)) throw new BadRequestError("Số lượng mặt hàng phải là số nguyên");
    return { productId, quantity };
  });
  const record = $app.findRecordById("stores", store);
  record.set("auto_open_products", items);
  $app.save(record);
  return c.json(200, { items });
});

routerAdd("GET", "/api/table-billing/map", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");

  const tables = $app.findRecordsByFilter(
    "tables",
    "store = {:store}",
    "row_number,position,name",
    -1,
    0,
    { store },
  );
  let layout = null;
  try {
    layout = $app.findFirstRecordByFilter("table_layouts", "store = {:store}", {
      store,
    });
  } catch (e) {}
  let rowCount = 2;
  let counts = [3, 3];
  if (layout) {
    rowCount = Number(layout.get("row_count")) || 1;
    try {
      counts = JSON.parse(String(layout.get("tables_per_row") || "[]"));
    } catch (e) {
      counts = [];
    }
    if (!Array.isArray(counts)) counts = [];
  }

  const activeBills = $app.findRecordsByFilter(
    "table_bills",
    "store = {:store} && (status = 'open' || status = 'wallet_pending')",
    "created",
    -1,
    0,
    { store },
  );
  const playingBills = {};
  for (const bill of activeBills) {
    playingBills[bill.get("table")] = bill;
  }
  const canOperateBill = ["admin", "staff"].includes(
    String(auth.get("role") || ""),
  );
  const visibleSessions = {};
  if (!canOperateBill) {
    const customerBills = $app.findRecordsByFilter(
      "table_bills",
      "store = {:store} && customer = {:customer}",
      "created",
      -1,
      0,
      { store, customer: auth.id },
    );
    customerBills.forEach((bill) => {
      visibleSessions[String(bill.get("session_id") || bill.id)] = true;
    });
  }
  const visibleBills = activeBills.filter(
    (bill) =>
      canOperateBill ||
      bill.get("customer") === auth.id ||
      visibleSessions[String(bill.get("session_id") || bill.id)],
  );
  return c.json(200, {
    layout: { rowCount, tablesPerRow: counts },
    tables: tables.map((table, index) => ({
      ...table.publicExport(),
      name: String(table.get("name") || "Bàn " + (index + 1)),
      playingSince: playingBills[table.id]
        ? playingBills[table.id].get("started_at") || ""
        : "",
    })),
    activeBills: visibleBills.map((bill) => ({
      id: bill.id,
      table: bill.get("table"),
      customer: bill.get("customer"),
      status: bill.get("status"),
    })),
  });
});

routerAdd("GET", "/api/table-billing/my-open", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const bills = $app.findRecordsByFilter(
    "table_bills",
    "store = {:store} && customer = {:customer} && (status = 'open' || status = 'wallet_pending')",
    "-created",
    -1,
    0,
    { store, customer: auth.id },
  );
  const tables = $app.findRecordsByFilter(
    "tables",
    "store = {:store}",
    "row_number,position,name",
    -1,
    0,
    { store },
  );
  const tableNames = {};
  tables.forEach((table, index) => {
    tableNames[table.id] = String(table.get("name") || "Bàn " + (index + 1));
  });
  return c.json(200, {
    items: bills.map((bill) => ({
      id: bill.id,
      table: bill.get("table"),
      tableName: tableNames[bill.get("table")] || "Bàn",
      status: bill.get("status"),
    })),
  });
});

routerAdd("GET", "/api/table-billing/products", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const products = $app.findRecordsByFilter(
    "products",
    "store = {:store} && is_active = true",
    "category,name",
    -1,
    0,
    { store },
  );
  return c.json(200, {
    items: products.map((product) => ({
      id: product.id,
      store,
      name: product.get("name"),
      description: product.get("description") || "",
      image: product.get("image") || "",
      category: product.get("category") || product.get("kind") || "Khác",
      kind: product.get("kind") || "goods",
      price: Number(product.get("price")) || 0,
      billingUnit: product.get("billing_unit") || "quantity",
      unitLabel: product.get("unit_label") || "",
      timePricing:
        product.get("billing_unit") === "hour"
          ? product.get("time_pricing") || null
          : null,
    })),
  });
});

routerAdd("GET", "/api/table-billing/customers", (c) => {
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  if (!auth) throw new UnauthorizedError("Cần đăng nhập");
  if (auth.get("role") !== "admin")
    throw new ForbiddenError("Chỉ admin mới được thao tác");
  const store = String(auth.get("store") || "");
  if (!store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const users = $app.findRecordsByFilter(
    "users",
    "store = {:store} && role = 'user'",
    "fullname,username",
    -1,
    0,
    { store },
  );
  return c.json(200, {
    items: users.map((user) => ({
      id: user.id,
      username: user.get("username"),
      fullname: user.get("fullname") || "",
    })),
  });
});

routerAdd("POST", "/api/table-billing/action", (c) => {
  const publishStaffQueue = (app, store, actorId = "", eventType = "queue") => {
    try {
      require(`${__hooks}/staff_queue.js`).signalStaffQueue(
        app,
        store,
        actorId,
        eventType,
      );
    } catch (e) {}
  };
  const info = c.requestInfo();
  const auth = info.auth || c.auth;
  const input = info.body || {};
  const action = String(input.action || "");
  const needsPreparation = (product) => product && product.get("billing_unit") !== "hour" && product.get("requires_preparation") === true;
  if (!auth && !["public_detail", "public_tables", "public_switch_table", "public_request_transfer", "public_order"].includes(action)) throw new UnauthorizedError("Cần đăng nhập");
  let store = auth ? String(auth.get("store") || "") : "";
  if (!auth && action === "public_order") {
    const tableId = String(input.tableId || "").trim();
    if (!tableId || !/^[a-zA-Z0-9_-]{10,40}$/.test(tableId)) throw new BadRequestError("Mã bàn không hợp lệ");
    store = String($app.findRecordById("tables", tableId).get("store") || "");
    if (!store) throw new BadRequestError("Bàn không thuộc cửa hàng");
  }
  if (auth && !store) throw new ForbiddenError("Tài khoản chưa thuộc cửa hàng");
  const isAdmin = !!auth && auth.get("role") === "admin";
  const isStaff = !!auth && auth.get("role") === "staff";
  const canOperateBill = isAdmin || isStaff;
  // Custom bill actions save records inside a transaction, so record request hooks cannot see them.
  if (auth && ["admin", "staff"].includes(String(auth.get("role") || "")) && !["detail", "session_summary", "queue_list", "request_list", "payment_request_list", "public_detail", "get_active_bill"].includes(action)) {
    try {
      const audit = new Record($app.findCollectionByNameOrId("audit_logs"));
      audit.set("store", store);
      audit.set("actor", auth.id);
      audit.set("action", action);
      audit.set("collection", "table_billing");
      audit.set("record_id", String(input.billId || input.itemId || input.tableId || ""));
      audit.set("details", JSON.stringify({ action, billId: input.billId || "", itemId: input.itemId || "", tableId: input.tableId || "" }).slice(0, 5000));
      $app.save(audit);
    } catch (error) { console.error("Failed to audit bill action:", error); }
  }
  const requireAdmin = () => {
    if (!isAdmin) throw new ForbiddenError("Chỉ admin mới được thao tác");
  };
  const requireBillOperator = () => {
    if (!canOperateBill)
      throw new ForbiddenError("Chỉ admin hoặc nhân viên mới được thao tác");
  };
  const inventoryRequired = (app) => {
    const value = app.findRecordById("stores", store).get("inventory_required");
    return value === undefined || value === null || value === ""
      ? true
      : value === true || value === 1 || value === "true";
  };
  const productOnHand = (app, productId) =>
    app
      .findRecordsByFilter(
        "inventory_movements",
        "store = {:store} && product = {:product}",
        "created",
        -1,
        0,
        { store, product: productId },
      )
      .reduce(
        (sum, movement) => sum + (Number(movement.get("quantity_delta")) || 0),
        0,
      );
  const productReserved = (app, productId, excludeItemId = "") => {
    const bills = app.findRecordsByFilter(
      "table_bills",
      "store = {:store} && (status = 'open' || status = 'wallet_pending')",
      "created",
      -1,
      0,
      { store },
    );
    const active = {};
    bills.forEach((bill) => {
      active[bill.id] = true;
    });
    const items = app.findRecordsByFilter(
      "table_bill_items",
      "store = {:store} && product = {:product}",
      "created",
      -1,
      0,
      { store, product: productId },
    );
    return items.reduce(
      (sum, item) =>
        item.id === excludeItemId ||
        ["cancelled", "approval_pending", "rejected"].includes(
          String(item.get("queue_status") || ""),
        ) ||
        !active[String(item.get("bill") || "")] ||
        item.get("billing_unit") === "hour"
          ? sum
          : sum + Math.max(0, Number(item.get("quantity")) || 0),
      0,
    );
  };
  const ensureProductAvailable = (
    app,
    productId,
    quantity,
    excludeItemId = "",
  ) => {
    if (!inventoryRequired(app)) return;
    if (
      productOnHand(app, productId) -
        productReserved(app, productId, excludeItemId) <
      quantity
    )
      throw new BadRequestError("Tồn kho khả dụng không đủ cho mặt hàng này");
  };
  const recordInventorySales = (app, bill) => {
    const items = billItems(app, bill.id);
    const grouped = {};
    for (const item of items) {
      if (
        ["cancelled", "approval_pending", "rejected"].includes(
          String(item.get("queue_status") || ""),
        )
      )
        continue;
      const productId = String(item.get("product") || "");
      if (!productId || item.get("billing_unit") === "hour") continue;
      try {
        if (app.findRecordById("products", productId).get("kind") === "service")
          continue;
      } catch (e) {}
      const quantity = Math.max(0, Number(item.get("quantity")) || 0);
      if (!quantity) continue;
      const row = grouped[productId] || {
        quantity: 0,
        unitCost: Number(item.get("purchase_price")) || 0,
      };
      row.quantity += quantity;
      grouped[productId] = row;
    }
    for (const productId in grouped) {
      const sourceKey = "table-bill-" + bill.id + "-product-" + productId;
      try {
        app.findFirstRecordByFilter(
          "inventory_movements",
          "source_key = {:sourceKey}",
          { sourceKey },
        );
        continue;
      } catch (e) {}
      if (
        inventoryRequired(app) &&
        productOnHand(app, productId) < grouped[productId].quantity
      )
        throw new BadRequestError(
          "Tồn kho thực tế không đủ để hoàn tất hóa đơn",
        );
      const movement = new Record(
        app.findCollectionByNameOrId("inventory_movements"),
      );
      movement.set("store", store);
      movement.set("product", productId);
      movement.set("movement_type", "sale");
      movement.set("quantity_delta", -grouped[productId].quantity);
      movement.set("unit_cost", grouped[productId].unitCost);
      movement.set("reference_type", "table_bill");
      movement.set("reference_id", bill.id);
      movement.set("source_key", sourceKey);
      movement.set("note", "Xuất kho theo hóa đơn " + bill.id);
      movement.set("actor", auth.id);
      movement.set(
        "occurred_at",
        bill.get("paid_at") || new Date().toISOString(),
      );
      app.save(movement);
    }
  };
  const hasPaymentDiscount = Object.prototype.hasOwnProperty.call(
    input,
    "paymentDiscountPercent",
  );
  const hasPaymentDiscountNote = Object.prototype.hasOwnProperty.call(
    input,
    "paymentDiscountNote",
  );
  if (Object.prototype.hasOwnProperty.call(input, "discountPercent"))
    throw new BadRequestError(
      "Chiết khấu chỉ được áp dụng qua chương trình khuyến mại",
    );
  if (
    (hasPaymentDiscount || hasPaymentDiscountNote) &&
    !["pay_manual", "approve_wallet"].includes(action)
  )
    throw new BadRequestError("Chiết khấu chỉ áp dụng khi xác nhận thanh toán");
  const requestedPaymentDiscount = hasPaymentDiscount
    ? Number(input.paymentDiscountPercent)
    : 0;
  const requestedPaymentDiscountNote = hasPaymentDiscountNote
    ? String(input.paymentDiscountNote || "").trim()
    : "";
  if (
    !isAdmin &&
    (requestedPaymentDiscount !== 0 || requestedPaymentDiscountNote)
  )
    throw new ForbiddenError(
      "Chỉ admin mới được áp dụng chiết khấu thanh toán",
    );
  const paymentDiscountPercent = () => {
    if (!hasPaymentDiscount) return 0;
    const value = input.paymentDiscountPercent;
    if (!Number.isSafeInteger(value) || value < 0 || value > 100)
      throw new BadRequestError(
        "Chiết khấu thanh toán phải là số nguyên từ 0 đến 100%",
      );
    return value;
  };
  const paymentDiscountNote = () => {
    if (!hasPaymentDiscountNote) return "";
    const value = input.paymentDiscountNote;
    if (typeof value !== "string" || value.trim().length > 200)
      throw new BadRequestError(
        "Ghi chú chiết khấu không được vượt quá 200 ký tự",
      );
    return value.trim();
  };
  const promotionJson = (value, fallback = []) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : fallback;
      } catch (e) {}
    }
    return fallback;
  };
  const promotionObject = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value))
      return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : null;
      } catch (e) {}
    }
    return null;
  };
  const promotionTimeMinutes = (value) => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return -1;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : -1;
  };
  const promotionSnapshot = (record, app) => {
    const targets = (collection, field) =>
      promotionJson(record.get(field), []).map((id) => {
        try {
          const target = app.findRecordById(collection, String(id));
          return {
            id: String(id),
            name: String(target.get("name") || target.get("code") || id),
            ...(collection === "member_card_types"
              ? { code: String(target.get("code") || "") }
              : {}),
          };
        } catch (e) {
          return { id: String(id), name: String(id) };
        }
      });
    return {
      id: record.id,
      name: record.get("name"),
      promotionType: record.get("promotion_type"),
      value: Number(record.get("value")) || 0,
      scope: record.get("scope"),
      audience: record.get("audience"),
      minInvoiceAmount: Number(record.get("min_invoice_amount")) || 0,
      maxDiscount: Number(record.get("max_discount")) || 0,
      autoApply: record.getBool("auto_apply"),
      startAt: record.get("start_at"),
      endAt: record.get("end_at"),
      weekdays: promotionJson(record.get("weekdays"), []),
      timeStart: record.get("time_start") || "",
      timeEnd: record.get("time_end") || "",
      targetCategories: promotionJson(record.get("target_categories"), []),
      targetProducts: targets("products", "target_products"),
      targetGroups: targets("customer_groups", "target_groups"),
      targetCards: targets("member_card_types", "target_cards"),
    };
  };
  const findPromotionForBill = (
    app,
    storeId,
    bill,
    lines,
    gross,
    at,
    forcedId = "",
    autoOnly = false,
  ) => {
    let records = [];
    try {
      records = app.findRecordsByFilter(
        "promotions",
        "store = {:store} && active = true",
        "created",
        -1,
        0,
        { store: storeId },
      );
    } catch (e) {
      return null;
    }
    const customerId = String(bill.get("customer") || "");
    const local = new Date(at + 7 * 60 * 60 * 1000);
    const weekday = local.getUTCDay();
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    const candidates = [];
    for (const record of records) {
      if (forcedId && record.id !== forcedId) continue;
      if (!forcedId && autoOnly && record.getBool("auto_apply") !== true)
        continue;
      const start = Date.parse(String(record.get("start_at") || ""));
      const end = Date.parse(String(record.get("end_at") || ""));
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        at < start ||
        at > end
      )
        continue;
      if (!promotionJson(record.get("weekdays"), []).includes(weekday))
        continue;
      const timeStart = promotionTimeMinutes(record.get("time_start"));
      const timeEnd = promotionTimeMinutes(record.get("time_end"));
      if (
        timeStart >= 0 &&
        (timeEnd <= timeStart || minute < timeStart || minute >= timeEnd)
      )
        continue;
      const audience = String(record.get("audience") || "all");
      if (audience !== "all") {
        if (!customerId) continue;
        const targets = promotionJson(
          record.get(audience === "group" ? "target_groups" : "target_cards"),
          [],
        );
        const collection =
          audience === "group"
            ? "customer_group_members"
            : "customer_member_cards";
        const field = audience === "group" ? "group" : "card";
        let memberships = [];
        try {
          memberships = app.findRecordsByFilter(
            collection,
            "store = {:store} && user = {:user}",
            "created",
            -1,
            0,
            { store: storeId, user: customerId },
          );
        } catch (e) {
          memberships = [];
        }
        if (
          !memberships.some((membership) =>
            targets.includes(String(membership.get(field))),
          )
        )
          continue;
      }
      if (gross < (Number(record.get("min_invoice_amount")) || 0)) continue;
      const scope = String(record.get("scope") || "invoice");
      const type = String(record.get("promotion_type") || "");
      const targetCategories = promotionJson(
        record.get("target_categories"),
        [],
      );
      const targetProducts = promotionJson(record.get("target_products"), []);
      const eligible = lines.filter((line) => {
        const inScope =
          scope === "invoice" ||
          (scope === "product" &&
            targetProducts.includes(String(line.product))) ||
          (scope === "category" &&
            (targetCategories.includes(String(line.category || "")) ||
              targetCategories.includes(String(line.categoryId || ""))));
        return (
          inScope && (type !== "fixed_price" || line.billingUnit !== "hour")
        );
      });
      const eligibleSubtotal = eligible.reduce(
        (sum, line) => sum + Math.max(0, Number(line.lineTotal) || 0),
        0,
      );
      if (!eligibleSubtotal) continue;
      const value = Number(record.get("value")) || 0;
      let discount = 0;
      if (type === "percent")
        discount = Math.round((eligibleSubtotal * value) / 100);
      else if (type === "amount") discount = Math.min(eligibleSubtotal, value);
      else if (type === "fixed_price")
        discount = eligible.reduce(
          (sum, line) =>
            sum +
            Math.max(
              0,
              Math.round(
                (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0) -
                  value * (Number(line.quantity) || 0),
              ),
            ),
          0,
        );
      else continue;
      const maxDiscount = Number(record.get("max_discount")) || 0;
      if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
      discount = Math.max(0, Math.min(gross, Math.round(discount)));
      if (discount <= 0) continue;
      candidates.push({
        record,
        discount,
        total: Math.max(0, gross - discount),
        eligibleSubtotal,
      });
    }
    candidates.sort(
      (a, b) =>
        b.discount - a.discount ||
        String(a.record.get("created")).localeCompare(
          String(b.record.get("created")),
        ),
    );
    const winner = candidates[0];
    return winner
      ? {
          promotion: winner.record,
          discountAmount: winner.discount,
          total: winner.total,
          eligibleSubtotal: winner.eligibleSubtotal,
          snapshot: promotionSnapshot(winner.record, app),
        }
      : null;
  };
  const savePromotionState = (bill, result, gross) => {
    bill.set("gross_amount", Math.max(0, Math.round(gross)));
    bill.set("discount_amount", result ? result.discountAmount : 0);
    bill.set("promotion", result ? result.promotion.id : "");
    bill.set(
      "promotion_snapshot",
      result ? JSON.stringify(result.snapshot) : "",
    );
    bill.set(
      "total_amount",
      result ? result.total : Math.max(0, Math.round(gross)),
    );
    if (bill.get("status") === "wallet_pending")
      bill.set(
        "requested_amount",
        result ? result.total : Math.max(0, Math.round(gross)),
      );
  };
  const notifyAdmins = (app, storeId, type, title, body, billId) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId("admin_notifications");
    } catch (e) {
      return;
    }
    let admins = [];
    try {
      admins = app.findRecordsByFilter(
        "users",
        "store = {:store} && role = 'admin'",
        "created",
        -1,
        0,
        { store: storeId },
      );
    } catch (e) {
      return;
    }
    for (const admin of admins) {
      try {
        app.findFirstRecordByFilter(
          "admin_notifications",
          "recipient = {:recipient} && reference_id = {:reference_id} && type = {:type} && read = false",
          { recipient: admin.id, reference_id: billId, type },
        );
        continue;
      } catch (e) {}
      const notification = new Record(collection);
      notification.set("store", storeId);
      notification.set("recipient", admin.id);
      notification.set("type", type);
      notification.set("title", title);
      notification.set("body", body);
      notification.set("reference_type", "table_bill");
      notification.set("reference_id", billId);
      notification.set("read", false);
      app.save(notification);
    }
  };
  const markBillNotificationsRead = (app, storeId, recipientId, billId) => {
    let notifications = [];
    try {
      notifications = app.findRecordsByFilter(
        "admin_notifications",
        "store = {:store} && recipient = {:recipient} && reference_type = 'table_bill' && reference_id = {:bill}",
        "created",
        -1,
        0,
        { store: storeId, recipient: recipientId, bill: billId },
      );
    } catch (e) {
      return;
    }
    for (const notification of notifications) {
      notification.set("read", true);
      app.save(notification);
    }
  };
  const recordEvent = (app, eventInput) => {
    const event = new Record(app.findCollectionByNameOrId("table_bill_events"));
    const actor = eventInput.actor;
    event.set("store", eventInput.store);
    event.set("bill_id", eventInput.billId);
    event.set("table_name", eventInput.tableName || "Bàn");
    event.set("category", eventInput.category);
    event.set("event_type", eventInput.eventType);
    event.set("title", eventInput.title);
    event.set("actor_id", actor ? actor.id : "");
    event.set(
      "actor_name",
      actor
        ? actor.get("fullname") || actor.get("username") || "Không rõ"
        : "Hệ thống",
    );
    event.set("actor_role", actor ? actor.get("role") || "" : "");
    if (eventInput.paymentMethod)
      event.set("payment_method", eventInput.paymentMethod);
    if (Number.isFinite(Number(eventInput.amount)) && eventInput.amount >= 0)
      event.set("amount", Math.round(Number(eventInput.amount)));
    event.set("details", JSON.stringify(eventInput.details || {}));
    event.set("happened_at", eventInput.happenedAt || new Date().toISOString());
    app.save(event);
  };
  const displayTableName = (app, tableId) => {
    const tables = app.findRecordsByFilter(
      "tables",
      "store = {:store}",
      "row_number,position,name",
      -1,
      0,
      { store },
    );
    const index = tables.findIndex((table) => table.id === tableId);
    if (index < 0) return "Bàn";
    return String(tables[index].get("name") || "Bàn " + (index + 1));
  };
  const renumberStoreTables = (app) => {
    const tables = app.findRecordsByFilter(
      "tables",
      "store = {:store}",
      "row_number,position,name",
      -1,
      0,
      { store },
    );
    const tableNames = {};
    tables.forEach((table, index) => {
      const currentName = String(table.get("name") || "");
      const name =
        currentName && !/^Bàn \d+$/.test(currentName)
          ? currentName
          : "Bàn " + (index + 1);
      tableNames[table.id] = name;
      if (table.get("name") === name) return;
      table.set("name", name);
      app.save(table);
    });
    const billNames = {};
    const bills = app.findRecordsByFilter(
      "table_bills",
      "store = {:store}",
      "created",
      -1,
      0,
      { store },
    );
    bills.forEach((bill) => {
      const name = tableNames[String(bill.get("table") || "")];
      if (!name) return;
      billNames[bill.id] = name;
      if (bill.get("table_name") === name) return;
      bill.set("table_name", name);
      app.save(bill);
    });
    const transactions = app.findRecordsByFilter(
      "wallet_transactions",
      "store = {:store} && reference_type = 'table_bill'",
      "created",
      -1,
      0,
      { store },
    );
    transactions.forEach((transaction) => {
      const tableName =
        billNames[String(transaction.get("reference_id") || "")];
      if (!tableName) return;
      const reason = "Thanh toán hóa đơn bàn " + tableName;
      if (transaction.get("reason") === reason) return;
      transaction.set("reason", reason);
      app.save(transaction);
    });
  };
  const minuteMs = 60000;
  const dayMs = 24 * 60 * minuteMs;
  const timezoneOffset = 7 * 60 * 60000;
  const timeTextToMinutes = (value) => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return -1;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : -1;
  };
  const normalizeTimePricing = (value, strict) => {
    let source = value;
    if (typeof source === "string") {
      try {
        source = source ? JSON.parse(source) : {};
      } catch (e) {
        source = null;
      }
    }
    if (!source || typeof source !== "object" || Array.isArray(source))
      source = {};
    const invalid = () => {
      if (strict)
        throw new BadRequestError("Cấu hình giá theo thời gian không hợp lệ");
      return { intervalMinutes: 60, firstPeriod: null, specialPeriod: null };
    };
    const intervalMinutes =
      source.intervalMinutes == null || source.intervalMinutes === ""
        ? 60
        : Number(source.intervalMinutes);
    if (
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < 1 ||
      intervalMinutes > 525600
    )
      return invalid();
    let firstPeriod = null;
    if (source.firstPeriod != null) {
      const price = Number(source.firstPeriod.price);
      const durationMinutes = Number(source.firstPeriod.durationMinutes);
      if (
        !Number.isInteger(price) ||
        price < 0 ||
        !Number.isInteger(durationMinutes) ||
        durationMinutes < 1 ||
        durationMinutes > 525600
      )
        return invalid();
      firstPeriod = { price, durationMinutes };
    }
    let specialPeriod = null;
    if (source.specialPeriod != null) {
      const special = source.specialPeriod;
      const price = Number(special.price);
      const weekdays = special.weekdays;
      if (
        !String(special.name || "").trim() ||
        String(special.name).length > 80 ||
        !Number.isInteger(price) ||
        price < 0 ||
        !Array.isArray(weekdays) ||
        !weekdays.length
      )
        return invalid();
      const seenDays = {};
      for (const weekday of weekdays) {
        if (
          !Number.isInteger(weekday) ||
          weekday < 0 ||
          weekday > 6 ||
          seenDays[weekday]
        )
          return invalid();
        seenDays[weekday] = true;
      }
      const allDay = special.allDay === true;
      const startTime = String(special.startTime || "");
      const endTime = String(special.endTime || "");
      if (
        !allDay &&
        (timeTextToMinutes(startTime) < 0 ||
          timeTextToMinutes(endTime) <= timeTextToMinutes(startTime))
      )
        return invalid();
      const durationMinutes =
        special.durationMinutes == null
          ? intervalMinutes
          : Number(special.durationMinutes);
      if (
        !Number.isInteger(durationMinutes) ||
        durationMinutes < 1 ||
        durationMinutes > 525600
      )
        return invalid();
      specialPeriod = {
        name: String(special.name).trim(),
        price,
        durationMinutes,
        allDay,
        startTime,
        endTime,
        weekdays: weekdays.slice(),
      };
    }
    return { intervalMinutes, firstPeriod, specialPeriod };
  };
  const calculateTimePrice = (startMs, endMs, regularPrice, rawPricing) => {
    const pricing = normalizeTimePricing(rawPricing, false);
    const firstPeriod = pricing.firstPeriod;
    const special = pricing.specialPeriod;
    const segments = [];
    const addSegment = (from, to, type, label, price, intervalMinutes) => {
      if (from >= to) return;
      const last = segments[segments.length - 1];
      if (
        last &&
        last.type === type &&
        last.label === label &&
        last.price === price &&
        last.intervalMinutes === intervalMinutes &&
        last.to === from
      ) {
        last.to = to;
        return;
      }
      segments.push({ from, to, type, label, price, intervalMinutes });
    };
    let cursor = startMs;
    if (firstPeriod && cursor < endMs) {
      const firstDuration = Math.max(
        1,
        Number(firstPeriod.durationMinutes) || 1,
      );
      const firstEnd = Math.min(endMs, startMs + firstDuration * minuteMs);
      addSegment(
        cursor,
        firstEnd,
        "first",
        "Giờ đầu",
        Number(firstPeriod.price) || 0,
        firstDuration,
      );
      cursor = firstEnd;
    }
    while (cursor < endMs) {
      const dayStart =
        Math.floor((cursor + timezoneOffset) / dayMs) * dayMs - timezoneOffset;
      const segmentEnd = Math.min(endMs, dayStart + dayMs);
      const localDay = new Date(dayStart + timezoneOffset).getUTCDay();
      const applies = special && special.weekdays.includes(localDay);
      let specialStart = segmentEnd;
      let specialEnd = segmentEnd;
      if (applies && special.allDay) {
        specialStart = cursor;
        specialEnd = segmentEnd;
      } else if (applies) {
        const startMinutes = timeTextToMinutes(special.startTime);
        const endMinutes = timeTextToMinutes(special.endTime);
        if (startMinutes >= 0 && endMinutes > startMinutes) {
          specialStart = Math.max(cursor, dayStart + startMinutes * minuteMs);
          specialEnd = Math.min(segmentEnd, dayStart + endMinutes * minuteMs);
        }
      }
      if (specialStart < specialEnd) {
        addSegment(
          cursor,
          specialStart,
          "regular",
          "Giờ thường",
          Number(regularPrice) || 0,
          Math.max(1, Number(pricing.intervalMinutes) || 60),
        );
        addSegment(
          specialStart,
          specialEnd,
          "special",
          special.name || "Giờ đặc biệt",
          Number(special.price) || 0,
          Math.max(
            1,
            Number(special.durationMinutes) ||
              Number(pricing.intervalMinutes) ||
              60,
          ),
        );
        addSegment(
          specialEnd,
          segmentEnd,
          "regular",
          "Giờ thường",
          Number(regularPrice) || 0,
          Math.max(1, Number(pricing.intervalMinutes) || 60),
        );
      } else
        addSegment(
          cursor,
          segmentEnd,
          "regular",
          "Giờ thường",
          Number(regularPrice) || 0,
          Math.max(1, Number(pricing.intervalMinutes) || 60),
        );
      cursor = segmentEnd;
    }
    const breakdown = segments.map((segment) => {
      const durationMinutes = (segment.to - segment.from) / minuteMs;
      const blocks =
        segment.type === "first"
          ? 1
          : Math.max(1, Math.ceil(durationMinutes / segment.intervalMinutes));
      return {
        type: segment.type,
        label: segment.label,
        startAt: new Date(segment.from).toISOString(),
        endAt: new Date(segment.to).toISOString(),
        durationMinutes,
        billedDurationMinutes: blocks * segment.intervalMinutes,
        amount:
          segment.type === "first" ? segment.price : blocks * segment.price,
      };
    });
    return {
      amount: breakdown.reduce((sum, segment) => sum + segment.amount, 0),
      breakdown,
    };
  };
  const calculateBillItem = (item, at, bill) => {
    const unit = item.get("billing_unit");
    const price = Number(item.get("unit_price")) || 0;
    let quantity = Number(item.get("quantity")) || 0;
    let amount = Number(item.get("line_total")) || 0;
    let timeBreakdown = [];
    if (unit === "hour") {
      const start = Date.parse(
        String(item.get("started_at") || "").replace(" ", "T"),
      );
      const stoppedAt = item.get("stopped_at")
        ? Date.parse(String(item.get("stopped_at")).replace(" ", "T"))
        : NaN;
      const end = Number.isFinite(stoppedAt) ? stoppedAt : at;
      const pausedAtText = bill ? bill.getString("billing_paused_at") : "";
      const pausedAt = pausedAtText
        ? Date.parse(String(pausedAtText).replace(" ", "T"))
        : NaN;
      const completedPause = bill
        ? Math.max(
            0,
            (Number(bill.get("paused_seconds")) || 0) -
              (Number(item.get("paused_seconds_at_start")) || 0),
          ) * 1000
        : 0;
      const currentPause = Number.isFinite(pausedAt)
        ? Math.max(0, at - pausedAt)
        : 0;
      const elapsed = Number.isFinite(start)
        ? Math.max(0, end - start - completedPause - currentPause)
        : 0;
      const minutes = Math.max(1, Math.ceil(elapsed / minuteMs));
      quantity = minutes / 60;
      const priceStart = Number.isFinite(start) ? start : end - minuteMs;
      const calculated = calculateTimePrice(
        priceStart,
        priceStart + minutes * minuteMs,
        price,
        item.getString("time_pricing"),
      );
      amount = calculated.amount;
      timeBreakdown = calculated.breakdown;
      if (Number.isFinite(stoppedAt) && timeBreakdown.length)
        timeBreakdown[timeBreakdown.length - 1].endAt = new Date(stoppedAt).toISOString();
    } else amount = Math.round(price * quantity);
    return { amount, quantity, timeBreakdown };
  };
  const findActiveBill = (app, tableId) => {
    try {
      return app.findFirstRecordByFilter(
        "table_bills",
        "table = {:table} && (status = 'open' || status = 'wallet_pending')",
        { table: tableId },
      );
    } catch (e) {
      return null;
    }
  };
  const findStoreTable = (app, tableId) => {
    const table = app.findRecordById("tables", tableId);
    if (table.get("store") !== store)
      throw new ForbiddenError("Bàn khác cửa hàng");
    return table;
  };
  const findStoreBill = (app, billId) => {
    const bill = app.findRecordById("table_bills", billId);
    if (bill.get("store") !== store)
      throw new ForbiddenError("Hóa đơn khác cửa hàng");
    return bill;
  };
  const billSessionId = (bill) => String(bill.get("session_id") || bill.id);
  const sessionBills = (app, bill) =>
    app.findRecordsByFilter(
      "table_bills",
      "store = {:store} && (session_id = {:session} || id = {:session})",
      "created",
      -1,
      0,
      { store, session: billSessionId(bill) },
    );
  const isSessionMember = (app, bill, userId) =>
    sessionBills(app, bill).some(
      (memberBill) => String(memberBill.get("customer") || "") === userId,
    );
  const canViewBill = (app, bill, userId) =>
    bill.get("customer") === userId || isSessionMember(app, bill, userId);
  const shouldReleaseTable = (app, tableId) => !findActiveBill(app, tableId);
  const lineAmount = (item, at, bill) => {
    return calculateBillItem(item, at, bill);
  };
  const billCalculationAt = (bill) => {
    if (["stopped", "paid", "cancelled"].includes(String(bill.get("status")))) {
      for (const value of [bill.get("stopped_at"), bill.get("paid_at")]) {
        const timestamp = value ? Date.parse(String(value).replace(" ", "T")) : NaN;
        if (Number.isFinite(timestamp)) return timestamp;
      }
    }
    return Date.now();
  };
  const billItems = (app, billId) =>
    app.findRecordsByFilter(
      "table_bill_items",
      "bill = {:bill}",
      "created",
      -1,
      0,
      { bill: billId },
    );
  const ensureOrderRequestsResolved = (app, bill) => {
    if (
      billItems(app, bill.id).some(
        (item) => item.get("queue_status") === "approval_pending",
      )
    )
      throw new BadRequestError(
        "Vui lòng chờ nhân viên xử lý yêu cầu món trước khi thanh toán",
      );
  };
  const moveItems = (app, items, source, target) => {
    const sourcePaused = Number(source.get("paused_seconds")) || 0;
    const targetPaused = Number(target.get("paused_seconds")) || 0;
    for (const item of items) {
      if (item.get("billing_unit") === "hour") {
        const pausedAfterItemStart = Math.max(
          0,
          sourcePaused - (Number(item.get("paused_seconds_at_start")) || 0),
        );
        const start = Date.parse(
          String(item.get("started_at") || "").replace(" ", "T"),
        );
        if (Number.isFinite(start) && pausedAfterItemStart)
          item.set(
            "started_at",
            new Date(start + pausedAfterItemStart * 1000).toISOString(),
          );
        item.set("paused_seconds_at_start", targetPaused);
      }
      item.set("bill", target.id);
      item.set("customer", target.get("customer"));
      app.save(item);
    }
  };
  const currentTotal = (app, bill) =>
    billItems(app, bill.id).reduce((sum, item) => {
      if (
        ["cancelled", "approval_pending", "rejected"].includes(
          String(item.get("queue_status") || ""),
        )
      )
        return sum;
      const amount = lineAmount(item, Date.now(), bill).amount;
      if (!Number.isFinite(amount))
        throw new BadRequestError(
          "Không thể tính tổng hóa đơn từ dữ liệu dòng hàng",
        );
      return sum + amount;
    }, 0);
  const freezeBill = (app, bill, at) => {
    const pausedAtText = bill.getString("billing_paused_at");
    const pausedAt = pausedAtText
      ? Date.parse(String(pausedAtText).replace(" ", "T"))
      : NaN;
    if (pausedAtText) {
      if (Number.isFinite(pausedAt))
        bill.set(
          "paused_seconds",
          (Number(bill.get("paused_seconds")) || 0) +
            Math.max(0, Math.floor((at - pausedAt) / 1000)),
        );
      bill.set("billing_paused_at", "");
    }
    const items = billItems(app, bill.id);
    let total = 0;
    for (const item of items) {
      if (
        ["cancelled", "approval_pending", "rejected"].includes(
          String(item.get("queue_status") || ""),
        )
      )
        continue;
      if (item.get("billing_unit") === "hour" && !item.get("stopped_at"))
        item.set("stopped_at", new Date(at).toISOString());
      const calculated = lineAmount(item, at, bill);
      item.set("quantity", calculated.quantity);
      item.set("line_total", calculated.amount);
      app.save(item);
      total += calculated.amount;
    }
    bill.set("total_amount", total);
    return total;
  };
  const recalculatePromotion = (app, bill, at, grossOverride) => {
    if (["wallet_pending", "stopped"].includes(String(bill.get("status")))) {
      const gross =
        Number(bill.get("gross_amount")) || Number(grossOverride) || 0;
      const discountAmount = Number(bill.get("discount_amount")) || 0;
      const snapshot = promotionObject(bill.getString("promotion_snapshot"));
      return {
        gross,
        result:
          discountAmount > 0
            ? {
                discountAmount,
                total:
                  Number(bill.get("total_amount")) ||
                  Math.max(0, gross - discountAmount),
                snapshot,
              }
            : null,
      };
    }
    const items = billItems(app, bill.id);
    const lines = items
      .filter(
        (item) =>
          !["cancelled", "approval_pending", "rejected"].includes(
            String(item.get("queue_status") || ""),
          ),
      )
      .map((item) => {
        const calc = lineAmount(item, at, bill);
        let product = null;
        try {
          product = item.get("product")
            ? app.findRecordById("products", item.get("product"))
            : null;
        } catch (e) {}
        return {
          product: item.get("product"),
          billingUnit: item.get("billing_unit"),
          unitPrice: Number(item.get("unit_price")) || 0,
          quantity: calc.quantity,
          lineTotal: calc.amount,
          category: product ? product.get("category") || "" : "",
          categoryId: "",
        };
      });
    const gross =
      grossOverride === undefined
        ? lines.reduce(
            (sum, line) => sum + Math.max(0, Number(line.lineTotal) || 0),
            0,
          )
        : grossOverride;
    const manualId = bill.getBool("promotion_manual")
      ? String(bill.get("promotion") || "")
      : "";
    const result = findPromotionForBill(
      app,
      store,
      bill,
      lines,
      gross,
      at,
      manualId,
      !manualId,
    );
    if (!result && manualId) bill.set("promotion_manual", false);
    savePromotionState(bill, result, gross);
    app.save(bill);
    return { gross, result };
  };
  const detail = (app, bill) => {
    const items = billItems(app, bill.id);
    const calculatedAt = billCalculationAt(bill);
    let total = 0;
    const lines = items.map((item) => {
      const calc = lineAmount(item, calculatedAt, bill);
      const excluded = ["cancelled", "approval_pending", "rejected"].includes(
        String(item.get("queue_status") || ""),
      );
      if (!excluded) total += calc.amount;
      return {
        id: item.id,
        product: item.get("product"),
        name: item.get("product_name"),
        billingUnit: item.get("billing_unit"),
        unitLabel: item.get("unit_label") || "",
        unitPrice: Number(item.get("unit_price")) || 0,
        quantity: calc.quantity,
        startedAt: item.get("started_at") || "",
        addedAt: item.get("created") || "",
        stoppedAt: item.get("stopped_at") || "",
        lineTotal: excluded ? 0 : calc.amount,
        queueStatus: item.get("queue_status") || "",
        queuedAt: item.get("queued_at") || "",
        queueCompletedAt: item.get("queue_completed_at") || "",
        queueCancelledAt: item.get("queue_cancelled_at") || "",
        timePricing:
          item.get("billing_unit") === "hour"
            ? item.get("time_pricing") || null
            : null,
        timeBreakdown: calc.timeBreakdown,
      };
    });
    const promotionLines = items
      .map((item, index) => {
        if (
          ["cancelled", "approval_pending", "rejected"].includes(
            String(item.get("queue_status") || ""),
          )
        )
          return null;
        let product = null;
        try {
          product = item.get("product")
            ? app.findRecordById("products", item.get("product"))
            : null;
        } catch (e) {}
        return {
          ...lines[index],
          category: product ? product.get("category") || "" : "",
          categoryId: "",
        };
      })
      .filter(Boolean);
    let promotionResult = null;
    if (bill.get("status") === "open") {
      const manualId = bill.getBool("promotion_manual")
        ? String(bill.get("promotion") || "")
        : "";
      promotionResult = findPromotionForBill(
        app,
        store,
        bill,
        promotionLines,
        total,
        Date.now(),
        manualId,
        !manualId,
      );
      if (!promotionResult && manualId) bill.set("promotion_manual", false);
      savePromotionState(bill, promotionResult, total);
      app.save(bill);
    }
    const grossAmount = Number(bill.get("gross_amount")) || total;
    const discountAmount = Number(bill.get("discount_amount")) || 0;
    const storedPayableAmount = Number(bill.get("total_amount"));
    const payableAmount =
      Number.isFinite(storedPayableAmount) && storedPayableAmount >= 0
        ? storedPayableAmount
        : Math.max(0, grossAmount - discountAmount);
    const status = String(bill.get("status") || "");
    const walletRequestedAt = String(bill.get("wallet_requested_at") || "");
    let paidByName = "";
    try {
      const paidBy = String(bill.get("paid_by") || "");
      if (paidBy) {
        const user = app.findRecordById("users", paidBy);
        paidByName = user.get("fullname") || user.get("username") || "";
      }
    } catch (e) {}
    return {
      id: bill.id,
      table: bill.get("table"),
      tableName: displayTableName(app, bill.get("table")),
      customer: bill.get("customer"),
      status,
      sessionId: billSessionId(bill),
      stoppedAt: bill.get("stopped_at") || "",
      paymentRequested:
        status === "wallet_pending" ||
        (status === "stopped" && Boolean(walletRequestedAt)),
      paymentMethod: bill.get("payment_method") || "",
      totalAmount: payableAmount,
      requestedAmount: Number(bill.get("requested_amount")) || 0,
      grossAmount,
      discountAmount,
      promotion: promotionResult
        ? promotionSnapshot(promotionResult.promotion, app)
        : promotionObject(bill.getString("promotion_snapshot")),
      paymentError: bill.get("payment_error") || "",
      billingPaused: Boolean(bill.getString("billing_paused_at")),
      billingPausedAt: bill.getString("billing_paused_at") || "",
      startedAt: bill.get("started_at"),
      paidAt: bill.get("paid_at") || "",
      cashReceived: Number(bill.get("cash_received")) || 0,
      paidByName,
      items: lines,
    };
  };

  if (action === "public_detail") {
    const tableId = String(input.tableId || "").trim();
    if (!tableId || !/^[a-zA-Z0-9_-]{10,40}$/.test(tableId))
      throw new BadRequestError("Mã bàn không hợp lệ");
    const table = $app.findRecordById("tables", tableId);
    store = String(table.get("store") || "");
    const bills = $app.findRecordsByFilter("table_bills", "store = {:store} && table = {:table}", "-created", -1, 0, { store, table: tableId });
    const latestBill = bills[0] || null;
    const bill = latestBill || null;
    const value = bill ? detail($app, bill) : null;
    const unpaidBills = bill
      ? sessionBills($app, bill)
        .map((sessionBill) => detail($app, sessionBill))
        .filter((sessionBill) => !["paid", "cancelled"].includes(sessionBill.status))
      : [];
    const menu = $app.findRecordsByFilter("products", "store = {:store} && is_active = true && billing_unit != 'hour'", "category,name", -1, 0, { store }).map((product) => ({
      id: product.id,
      store,
      name: product.get("name"),
      description: product.get("description") || "",
      image: product.get("image") || "",
      category: product.get("category") || product.get("kind") || "Khác",
      kind: product.get("kind") || "goods",
      price: Number(product.get("price")) || 0,
      billingUnit: product.get("billing_unit") || "quantity",
      unitLabel: product.get("unit_label") || (product.get("billing_unit") === "weight" ? "kg" : "lần"),
    }));
    let storeName = "H2 Billiards";
    try { storeName = String($app.findRecordById("stores", store).get("name") || storeName); } catch (e) {}
    let payment = { bankId: "", accountNumber: "", accountName: "" };
    try {
      const settings = $app.findFirstRecordByFilter("bill_payment_settings", "store = {:store}", { store });
      payment = { bankId: settings.get("bank_id") || "", accountNumber: settings.get("account_number") || "", accountName: settings.get("account_name") || "", tingeeVirtualAccount: settings.get("tingee_virtual_account") || "" };
    } catch (e) {}
    return c.json(200, { ok: true, storeName, tableName: table.get("name") || "Bàn", payment, menu, bill: value, unpaidBills });
  }

  if (action === "public_tables") {
    const storeId = String(input.storeId || "").trim();
    const tableId = String(input.tableId || "").trim();
    if (!storeId && !tableId) throw new BadRequestError("Thiếu mã cửa hàng");
    if (storeId && !/^[a-zA-Z0-9_-]{10,40}$/.test(storeId)) throw new BadRequestError("Mã cửa hàng không hợp lệ");
    if (tableId && !/^[a-zA-Z0-9_-]{10,40}$/.test(tableId)) throw new BadRequestError("Mã bàn không hợp lệ");
    if (storeId) store = storeId;
    else store = String($app.findRecordById("tables", tableId).get("store") || "");
    if (!store) throw new BadRequestError("Bàn không thuộc cửa hàng");
    $app.findRecordById("stores", store);
    const tables = $app.findRecordsByFilter("tables", "store = {:store}", "name,created", -1, 0, { store });
    return c.json(200, { ok: true, tables: tables.map((table) => ({ id: table.id, name: table.get("name") || "Bàn" })) });
  }

  if (action === "public_switch_table") {
    const storeId = String(input.storeId || "").trim();
    const targetTableId = String(input.targetTableId || "").trim();
    const adminPassword = String(input.adminPassword || "");
    if (!storeId || !targetTableId || !adminPassword) throw new BadRequestError("Thiếu thông tin chọn bàn");
    if (!/^[a-zA-Z0-9_-]{10,40}$/.test(storeId) || !/^[a-zA-Z0-9_-]{10,40}$/.test(targetTableId)) throw new BadRequestError("Mã bàn không hợp lệ");
    const targetTable = $app.findRecordById("tables", targetTableId);
    store = storeId;
    if (targetTable.get("store") !== store) throw new ForbiddenError("Bàn không thuộc cửa hàng");
    const admins = $app.findRecordsByFilter("users", "store = {:store} && role = 'admin' && is_approved = true", "created", -1, 0, { store });
    if (!admins.some((admin) => admin.validatePassword(adminPassword))) throw new ForbiddenError("Mật khẩu admin không đúng");
    return c.json(200, { ok: true, tableId: targetTable.id });
  }

  if (action === "session_summary") {
    const bill = findStoreBill($app, String(input.billId || ""));
    if (!canOperateBill && !canViewBill($app, bill, auth.id))
      throw new ForbiddenError("Không có quyền xem phiên hóa đơn");
    const bills = sessionBills($app, bill);
    const items = bills.map((item) => {
      const value = detail($app, item);
      return {
        id: value.id,
        tableName: value.tableName,
        status: value.status,
        paymentMethod: value.paymentMethod,
        totalAmount: value.totalAmount,
        paymentRequested: value.paymentRequested,
        startedAt: value.startedAt,
        stoppedAt: value.stoppedAt,
        paidAt: value.paidAt,
      };
    });
    const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0);
    const outstandingAmount = items.reduce(
      (sum, item) =>
        ["paid", "cancelled"].includes(item.status)
          ? sum
          : sum + item.totalAmount,
      0,
    );
    return c.json(200, {
      sessionId: billSessionId(bill),
      bills: items,
      totalAmount,
      outstandingAmount,
    });
  }

  if (action === "detail") {
    let bill;
    if (input.billId) bill = findStoreBill($app, String(input.billId));
    else if (input.tableId) {
      const table = findStoreTable($app, String(input.tableId));
      bill = findActiveBill($app, table.id);
      if (!bill) throw new BadRequestError("Không tìm thấy hóa đơn đang mở");
    } else throw new BadRequestError("Thiếu mã hóa đơn hoặc bàn");
    if (!canOperateBill && !canViewBill($app, bill, auth.id))
      throw new ForbiddenError("Không có quyền xem hóa đơn");
    return c.json(200, { ok: true, bill: detail($app, bill) });
  }

  if (action === "queue_list") {
    requireBillOperator();
    if (input.history === true) {
      const labels = {
        queue_completed: "Hoàn thành",
        queue_cancelled: "Đã hủy",
        order_approved: "Đã duyệt yêu cầu",
        order_rejected: "Đã từ chối yêu cầu",
      };
      const filter =
        "store = {:store} && (event_type = 'queue_completed' || event_type = 'queue_cancelled' || event_type = 'order_approved' || event_type = 'order_rejected')";
      const events = $app.findRecordsByFilter(
        "table_bill_events",
        filter,
        "-happened_at",
        500,
        0,
        { store },
      );
      const items = events.flatMap((event) => {
        let bill;
        try {
          bill = $app.findRecordById("table_bills", event.get("bill_id"));
        } catch (e) {
          return [];
        }
        let details = event.get("details") || {};
        if (typeof details === "string") {
          try {
            details = details ? JSON.parse(details) : {};
          } catch (e) {
            details = {};
          }
        }
        let item = null;
        try {
          if (details.itemId)
            item = $app.findRecordById("table_bill_items", details.itemId);
        } catch (e) {}
        return [
          {
            id: event.id,
            billId: bill.id,
            billStatus: bill.get("status"),
            tableName:
              event.get("table_name") ||
              displayTableName($app, bill.get("table")),
            name: item
              ? item.get("product_name")
              : details.productName || event.get("title"),
            quantity: item
              ? Number(item.get("quantity")) || 0
              : Number(details.quantity) || 0,
            unitLabel: item ? item.get("unit_label") || "" : "",
            queuedAt: "",
            completedAt: event.get("happened_at") || event.get("created"),
            actorName: event.get("actor_name") || "Hệ thống",
            actionLabel: labels[event.get("event_type")] || "Đã xử lý",
          },
        ];
      });
      return c.json(200, { items });
    }
    const status = "pending";
    const records = $app.findRecordsByFilter(
      "table_bill_items",
      "store = {:store} && queue_status = {:status}",
      "queued_at,created",
      500,
      0,
      { store, status },
    );
    const tables = $app.findRecordsByFilter(
      "tables",
      "store = {:store}",
      "row_number,position,name",
      -1,
      0,
      { store },
    );
    const tableNames = {};
    tables.forEach((table, index) => {
      tableNames[table.id] = String(table.get("name") || "Bàn " + (index + 1));
    });
    const items = records.flatMap((item) => {
      let bill;
      try {
        bill = $app.findRecordById("table_bills", item.get("bill"));
      } catch (e) {
        return [];
      }
      if (!["open", "wallet_pending"].includes(String(bill.get("status"))))
        return [];
      return [
        {
          id: item.id,
          billId: bill.id,
          billStatus: bill.get("status"),
          tableName: tableNames[bill.get("table")] || "Bàn",
          name: item.get("product_name"),
          quantity: Number(item.get("quantity")) || 0,
          unitLabel: item.get("unit_label") || "",
          queuedAt: item.get("queued_at") || "",
          completedAt: "",
          actorName: "",
        },
      ];
    });
    return c.json(200, { items });
  }

  if (action === "request_list") {
    requireBillOperator();
    const status = input.history === true ? "rejected" : "approval_pending";
    const records = $app.findRecordsByFilter(
      "table_bill_items",
      "store = {:store} && queue_status = {:status}",
      input.history === true ? "-queue_cancelled_at" : "queued_at,created",
      500,
      0,
      { store, status },
    );
    const tables = $app.findRecordsByFilter(
      "tables",
      "store = {:store}",
      "row_number,position,name",
      -1,
      0,
      { store },
    );
    const tableNames = {};
    tables.forEach((table, index) => {
      tableNames[table.id] = String(table.get("name") || "Bàn " + (index + 1));
    });
    const items = records.flatMap((item) => {
      let bill;
      try {
        bill = $app.findRecordById("table_bills", item.get("bill"));
      } catch (e) {
        return [];
      }
      if (status === "approval_pending" && bill.get("status") !== "open")
        return [];
      let customer = null;
      try {
        customer = $app.findRecordById("users", item.get("customer"));
      } catch (e) {}
      return [
        {
          id: item.id,
          billId: bill.id,
          billStatus: bill.get("status"),
          tableName: tableNames[bill.get("table")] || "Bàn",
          name: item.get("product_name"),
          quantity: Number(item.get("quantity")) || 0,
          unitLabel: item.get("unit_label") || "",
          queuedAt: item.get("queued_at") || "",
          completedAt: item.get("queue_cancelled_at") || "",
          actorName: customer
            ? customer.get("fullname") || customer.get("username") || "Khách"
            : "Khách",
          sourceRole: "user",
        },
      ];
    });
    return c.json(200, { items });
  }

  if (action === "payment_request_list") {
    requireBillOperator();
    const bills = $app.findRecordsByFilter("table_bills", "store = {:store} && status = 'wallet_pending' && payment_method = 'transfer'", "wallet_requested_at,created", -1, 0, { store });
    return c.json(200, { items: bills.map((bill) => ({ id: bill.id, billId: bill.id, billStatus: bill.get("status"), tableName: displayTableName($app, bill.get("table")), name: "Khách báo đã chuyển khoản", quantity: 1, unitLabel: "", amount: Number(bill.get("requested_amount")) || Number(bill.get("total_amount")) || 0, queuedAt: bill.get("wallet_requested_at") || "", actorName: "Khách từ link bill" })) });
  }

  if (action === "payment_request_unreceived") {
    requireBillOperator();
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") !== "wallet_pending" || bill.get("payment_method") !== "transfer") throw new BadRequestError("Yêu cầu chuyển khoản đã được xử lý");
      bill.set("status", "open");
      bill.set("stopped_at", "");
      billItems(txApp, bill.id).forEach((item) => {
        if (item.get("billing_unit") === "hour") {
          item.set("stopped_at", "");
          txApp.save(item);
        }
      });
      bill.set("payment_method", "");
      bill.set("wallet_requested_at", "");
      bill.set("payment_requester", "");
      bill.set("requested_amount", 0);
      bill.set("payment_error", "Chưa nhận được tiền. Bill vẫn chưa thanh toán.");
      txApp.save(bill);
      recordEvent(txApp, { store, billId: bill.id, tableName: displayTableName(txApp, bill.get("table")), category: "payment", eventType: "payment_failed", title: "Chưa nhận được tiền chuyển khoản", actor: auth, paymentMethod: "transfer", amount: Number(bill.get("total_amount")) || 0, details: { reason: "Chưa nhận được tiền" } });
      billId = bill.id;
    });
    markBillNotificationsRead($app, store, auth.id, billId);
    publishStaffQueue($app, store, auth.id, "queue");
    return c.json(200, { ok: true, bill: detail($app, $app.findRecordById("table_bills", billId)) });
  }

  if (action === "request_approve" || action === "request_reject") {
    requireBillOperator();
    const itemIds = (Array.isArray(input.itemIds) ? input.itemIds : [input.itemId])
      .map((id) => String(id || ""))
      .filter((id, index, values) => id && values.indexOf(id) === index);
    if (!itemIds.length || itemIds.length > 100)
      throw new BadRequestError("Danh sách yêu cầu món không hợp lệ");
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") !== "open")
        throw new BadRequestError("Chỉ duyệt món trên hóa đơn đang mở");
      const items = itemIds.map((itemId) => txApp.findRecordById("table_bill_items", itemId));
      if (items.some((item) => item.get("bill") !== bill.id || item.get("store") !== store || item.get("queue_status") !== "approval_pending"))
        throw new BadRequestError("Yêu cầu món đã được xử lý hoặc không hợp lệ");
      const approved = action === "request_approve";
      const now = new Date().toISOString();
      for (const item of items) {
        if (approved && item.get("billing_unit") !== "hour" && item.get("product"))
          ensureProductAvailable(txApp, String(item.get("product")), Number(item.get("quantity")) || 0);
        let product = null;
        if (item.get("product")) {
          try { product = txApp.findRecordById("products", item.get("product")); } catch (e) {}
        }
        item.set("queue_status", approved ? (needsPreparation(product) ? "pending" : "done") : "rejected");
        if (approved && item.get("billing_unit") === "hour") item.set("started_at", now);
        if (approved && needsPreparation(product)) item.set("queued_at", now);
        else if (!approved) item.set("queue_cancelled_at", now);
        txApp.save(item);
        recordEvent(txApp, {
          store,
          billId: bill.id,
          tableName: displayTableName(txApp, bill.get("table")),
          category: "action",
          eventType: approved ? "order_approved" : "order_rejected",
          title: (approved ? "Duyệt yêu cầu " : "Từ chối yêu cầu ") + item.get("product_name"),
          actor: auth,
          details: { itemId: item.id, productName: item.get("product_name"), quantity: Number(item.get("quantity")) || 0 },
        });
      }
      bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      billId = bill.id;
    });
    publishStaffQueue($app, store, auth.id, "queue");
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
    });
  }

  if (action === "apply_promotion") {
    requireAdmin();
    const bill = findStoreBill($app, String(input.billId || ""));
    if (!["open", "wallet_pending"].includes(String(bill.get("status"))))
      throw new BadRequestError("Hóa đơn không còn mở");
    const promotionId = String(input.promotionId || "");
    const items = billItems($app, bill.id);
    const now = Date.now();
    const lines = items.map((item) => {
      const calc = lineAmount(item, now, bill);
      let product = null;
      try {
        product = item.get("product")
          ? $app.findRecordById("products", item.get("product"))
          : null;
      } catch (e) {}
      return ["cancelled", "approval_pending", "rejected"].includes(
        String(item.get("queue_status") || ""),
      )
        ? null
        : {
            product: item.get("product"),
            billingUnit: item.get("billing_unit"),
            unitPrice: Number(item.get("unit_price")) || 0,
            quantity: calc.quantity,
            lineTotal: calc.amount,
            category: product ? product.get("category") || "" : "",
            categoryId: "",
          };
    });
    const eligibleLines = lines.filter(Boolean);
    const gross = eligibleLines.reduce(
      (sum, line) => sum + Math.max(0, Number(line.lineTotal) || 0),
      0,
    );
    if (!promotionId) {
      bill.set("promotion_manual", false);
      savePromotionState(bill, null, gross);
      $app.save(bill);
      return c.json(200, { ok: true, bill: detail($app, bill), cleared: true });
    }
    const result = findPromotionForBill(
      $app,
      store,
      bill,
      eligibleLines,
      gross,
      now,
      promotionId,
      false,
    );
    if (!result)
      throw new BadRequestError(
        "Khuyến mại không hợp lệ hoặc chưa đủ điều kiện",
      );
    bill.set("promotion_manual", true);
    savePromotionState(bill, result, gross);
    $app.save(bill);
    recordEvent($app, {
      store,
      billId: bill.id,
      tableName: displayTableName($app, bill.get("table")),
      category: "action",
      eventType: "promotion_applied",
      title: "Áp dụng " + result.snapshot.name,
      actor: auth,
      amount: result.discountAmount,
      details: result.snapshot,
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, bill),
      discountAmount: result.discountAmount,
    });
  }

  if (action === "configure_layout") {
    requireAdmin();
    const rowCount = Number(input.rowCount);
    const counts = input.tablesPerRow;
    if (
      !Number.isInteger(rowCount) ||
      rowCount < 1 ||
      rowCount > 20 ||
      !Array.isArray(counts) ||
      counts.length !== rowCount
    )
      throw new BadRequestError("Số hàng hoặc số bàn mỗi hàng không hợp lệ");
    let totalRequested = 0;
    for (const count of counts) {
      if (
        !Number.isInteger(Number(count)) ||
        Number(count) < 0 ||
        Number(count) > 100
      )
        throw new BadRequestError("Số bàn mỗi hàng phải từ 0 đến 100");
      totalRequested += Number(count);
    }
    if (totalRequested > 500) throw new BadRequestError("Tối đa 500 bàn");
    $app.runInTransaction((txApp) => {
      const allTables = txApp.findRecordsByFilter(
        "tables",
        "store = {:store}",
        "row_number,position",
        -1,
        0,
        { store },
      );
      const positions = {};
      for (const table of allTables)
        positions[
          String(table.get("row_number")) + ":" + String(table.get("position"))
        ] = true;
      const tableCollection = txApp.findCollectionByNameOrId("tables");
      for (let row = 1; row <= rowCount; row++) {
        for (
          let position = 1;
          position <= Number(counts[row - 1]);
          position++
        ) {
          const key = row + ":" + position;
          if (positions[key]) continue;
          const table = new Record(tableCollection);
          table.set("store", store);
          table.set("name", "Bàn " + (allTables.length + 1));
          table.set("status", "available");
          table.set("table_type", "billiards");
          table.set("row_number", row);
          table.set("position", position);
          txApp.save(table);
          allTables.push(table);
        }
      }
      renumberStoreTables(txApp);
      let layout;
      try {
        layout = txApp.findFirstRecordByFilter(
          "table_layouts",
          "store = {:store}",
          { store },
        );
      } catch (e) {
        layout = new Record(txApp.findCollectionByNameOrId("table_layouts"));
        layout.set("store", store);
      }
      layout.set("row_count", rowCount);
      layout.set("tables_per_row", JSON.stringify(counts.map(Number)));
      txApp.save(layout);
    });
    return c.json(200, { ok: true });
  }

  if (action === "delete_table") {
    requireAdmin();
    const tableId = String(input.tableId || "");
    const password = String(input.password || "");
    if (!tableId || !password)
      throw new BadRequestError("Cần chọn bàn và nhập lại mật khẩu admin");
    if (!auth.validatePassword(password))
      throw new ForbiddenError("Mật khẩu admin không đúng");
    $app.runInTransaction((txApp) => {
      const table = findStoreTable(txApp, tableId);
      if (table.get("status") !== "available")
        throw new BadRequestError("Chỉ được xóa bàn đang trống");
      if (findActiveBill(txApp, tableId))
        throw new BadRequestError("Bàn còn hóa đơn đang mở");
      txApp.delete(table);
    });
    return c.json(200, { ok: true });
  }

  if (action === "set_table_status") {
    requireAdmin();
    const status = String(input.status || "");
    if (!["available", "reserved"].includes(status))
      throw new BadRequestError("Trạng thái bàn không hợp lệ");
    $app.runInTransaction((txApp) => {
      const table = findStoreTable(txApp, String(input.tableId || ""));
      if (table.get("status") === "occupied" || findActiveBill(txApp, table.id))
        throw new BadRequestError("Bàn đang có hóa đơn, cần thanh toán trước");
      table.set("status", status);
      txApp.save(table);
    });
    return c.json(200, { ok: true });
  }

  if (action === "reset_table_status") {
    requireAdmin();
    $app.runInTransaction((txApp) => {
      const table = findStoreTable(txApp, String(input.tableId || ""));
      if (findActiveBill(txApp, table.id))
        throw new BadRequestError("Bàn còn hóa đơn đang mở, cần xử lý hóa đơn trước");
      table.set("status", "available");
      txApp.save(table);
    });
    return c.json(200, { ok: true });
  }

  if (action === "rename_table") {
    requireAdmin();
    const name = String(input.name || "").trim();
    if (!name || name.length > 80)
      throw new BadRequestError("Tên bàn phải từ 1 đến 80 ký tự");
    $app.runInTransaction((txApp) => {
      const table = findStoreTable(txApp, String(input.tableId || ""));
      table.set("name", name);
      txApp.save(table);
    });
    return c.json(200, { ok: true, name });
  }

  if (action === "start") {
    if (!canOperateBill && auth.get("role") !== "user")
      throw new ForbiddenError("Tài khoản không được mở bàn");
    const tableId = String(input.tableId || "");
    const customerId =
      auth.get("role") === "user" ? auth.id : String(input.customerId || "");
    let billId = "";
    $app.runInTransaction((txApp) => {
      const table = findStoreTable(txApp, tableId);
      if (table.get("status") !== "available" || findActiveBill(txApp, tableId))
        throw new BadRequestError("Bàn không còn trống");
      if (customerId) {
        const customer = txApp.findRecordById("users", customerId);
        if (customer.get("store") !== store || customer.get("role") !== "user")
          throw new ForbiddenError("Khách hàng không thuộc cửa hàng");
      }
      const bill = new Record(txApp.findCollectionByNameOrId("table_bills"));
      const tableName = displayTableName(txApp, table.id);
      const openedAt = new Date().toISOString();
      bill.set("store", store);
      bill.set("table", table.id);
      bill.set("table_name", tableName);
      bill.set("customer", customerId);
      bill.set("opened_by", auth.id);
      bill.set("status", "open");
      bill.set("total_amount", 0);
      bill.set("started_at", openedAt);
      txApp.save(bill);
      const storeRecord = txApp.findRecordById("stores", store);
      let autoItems = [];
      if (input.useDefaultProducts !== false) {
        try { autoItems = JSON.parse(storeRecord.getString("auto_open_products") || "[]"); } catch (e) {}
      }
      (Array.isArray(autoItems) ? autoItems : []).forEach((configured) => {
        const quantity = Number(configured.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        let product;
        try { product = txApp.findRecordById("products", String(configured.productId || "")); } catch (e) { return; }
        const unit = String(product.get("billing_unit") || "quantity");
        if (product.get("store") !== store || product.get("is_active") !== true) return;
        if (unit === "hour" && billItems(txApp, bill.id).some((existing) => existing.get("billing_unit") === "hour")) return;
        if (unit === "quantity" && !Number.isInteger(quantity)) return;
        const itemQuantity = unit === "hour" ? 1 : quantity;
        if (unit !== "hour" && product.get("kind") !== "service") ensureProductAvailable(txApp, product.id, quantity);
        const price = Number(product.get("price"));
        if (!Number.isInteger(price) || price < 0) throw new BadRequestError("Giá mặt hàng phải là số nguyên không âm");
        const item = new Record(txApp.findCollectionByNameOrId("table_bill_items"));
        item.set("store", store);
        item.set("bill", bill.id);
        item.set("customer", bill.get("customer"));
        item.set("product", product.id);
        item.set("product_name", product.get("name"));
        item.set("billing_unit", unit);
        item.set("unit_label", product.get("unit_label") || (unit === "weight" ? "kg" : "lần"));
        item.set("unit_price", price);
        item.set("purchase_price", Math.max(0, Math.round(Number(product.get("purchase_price")) || 0)));
        if (unit === "hour") item.set("time_pricing", normalizeTimePricing(product.getString("time_pricing"), true));
        item.set("quantity", itemQuantity);
        item.set("started_at", unit === "hour" ? openedAt : "");
        item.set("paused_seconds_at_start", 0);
        item.set("line_total", unit === "hour" ? 0 : Math.round(price * quantity));
        if (needsPreparation(product)) {
          item.set("queue_status", "pending");
          item.set("queued_at", openedAt);
        }
        txApp.save(item);
        recordEvent(txApp, {
          store, billId: bill.id, tableName, category: "action",
          eventType: "item_added",
          title: "Thêm " + product.get("name"),
          actor: auth,
          amount: lineAmount(item, Date.parse(openedAt), bill).amount,
          details: { itemId: item.id, productId: product.id, productName: product.get("name"), billingUnit: unit, quantity, unitPrice: price },
          happenedAt: openedAt,
        });
      });
      table.set("status", "occupied");
      txApp.save(table);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName,
        category: "action",
        eventType: "bill_opened",
        title: "Mở " + tableName,
        actor: auth,
        details: { customerId },
        happenedAt: openedAt,
      });
      billId = bill.id;
    });
    return c.json(200, { ok: true, billId });
  }

  if (action === "get_active_bill") {
    requireBillOperator();
    const table = findStoreTable($app, String(input.tableId || ""));
    const bill = findActiveBill($app, table.id);
    return c.json(200, { billId: bill ? bill.id : "" });
  }

  if (action === "toggle_pause") {
    requireBillOperator();
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") !== "open")
        throw new BadRequestError("Hóa đơn không còn mở");
      const now = Date.now();
      const pausedAtText = bill.getString("billing_paused_at");
      const pausedAt = pausedAtText
        ? Date.parse(String(pausedAtText).replace(" ", "T"))
        : NaN;
      if (Number.isFinite(pausedAt)) {
        const elapsedSeconds = Math.max(0, Math.floor((now - pausedAt) / 1000));
        bill.set(
          "paused_seconds",
          (Number(bill.get("paused_seconds")) || 0) + elapsedSeconds,
        );
        bill.set("billing_paused_at", "");
      } else {
        bill.set("billing_paused_at", new Date(now).toISOString());
      }
      bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      const isPaused = Boolean(bill.getString("billing_paused_at"));
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: displayTableName(txApp, bill.get("table")),
        category: "action",
        eventType: isPaused ? "billing_paused" : "billing_resumed",
        title: isPaused ? "Tạm dừng tính giờ" : "Tiếp tục tính giờ",
        actor: auth,
        details: {},
      });
      billId = bill.id;
    });
    const result = $app.findRecordById("table_bills", billId);
    return c.json(200, {
      ok: true,
      billingPaused: Boolean(result.getString("billing_paused_at")),
      bill: detail($app, result),
    });
  }

  if (action === "split_session") {
    requireBillOperator();
    if (typeof input.keepCustomer !== "boolean")
      throw new BadRequestError("Cần chọn có giữ khách cho bill mới hay không");
    let stoppedBillId = "";
    let newBillId = "";
    $app.runInTransaction((txApp) => {
      const source = findStoreBill(txApp, String(input.billId || ""));
      if (source.get("status") !== "open")
        throw new BadRequestError("Chỉ được tách phiên từ bill đang mở");
      const table = findStoreTable(txApp, String(source.get("table") || ""));
      const activeBill = findActiveBill(txApp, table.id);
      if (!activeBill || activeBill.id !== source.id)
        throw new BadRequestError(
          "Bill này không còn là bill đang chạy của bàn",
        );
      const now = Date.now();
      const stoppedAt = new Date(now).toISOString();
      const pausedAtText = source.getString("billing_paused_at");
      const pausedAt = pausedAtText
        ? Date.parse(String(pausedAtText).replace(" ", "T"))
        : NaN;
      if (Number.isFinite(pausedAt)) {
        source.set(
          "paused_seconds",
          (Number(source.get("paused_seconds")) || 0) +
            Math.max(0, Math.floor((now - pausedAt) / 1000)),
        );
        source.set("billing_paused_at", "");
        txApp.save(source);
      }
      const grossTotal = freezeBill(txApp, source, now);
      recalculatePromotion(txApp, source, now, grossTotal);
      const sessionId = billSessionId(source);
      const tableName = displayTableName(txApp, table.id);
      source.set("session_id", sessionId);
      source.set("stopped_at", stoppedAt);
      source.set("status", "stopped");
      txApp.save(source);

      const next = new Record(txApp.findCollectionByNameOrId("table_bills"));
      next.set("store", store);
      next.set("table", table.id);
      next.set("table_name", tableName);
      next.set("customer", input.keepCustomer ? source.get("customer") : "");
      next.set("opened_by", auth.id);
      next.set("status", "open");
      next.set("total_amount", 0);
      next.set("started_at", stoppedAt);
      next.set("session_id", sessionId);
      txApp.save(next);

      for (const item of billItems(txApp, source.id)) {
        if (
          item.get("billing_unit") !== "hour" ||
          ["cancelled", "approval_pending", "rejected"].includes(
            String(item.get("queue_status") || ""),
          )
        )
          continue;
        const nextItem = new Record(txApp.findCollectionByNameOrId("table_bill_items"));
        for (const field of ["store", "product", "product_name", "billing_unit", "unit_label", "unit_price", "purchase_price", "time_pricing", "queue_status", "queue_completed_at"]) {
          const value = item.get(field);
          if (value !== undefined && value !== null && value !== "") nextItem.set(field, value);
        }
        nextItem.set("bill", next.id);
        nextItem.set("customer", next.get("customer"));
        nextItem.set("quantity", 1);
        nextItem.set("started_at", stoppedAt);
        nextItem.set("stopped_at", "");
        nextItem.set("paused_seconds_at_start", Number(next.get("paused_seconds")) || 0);
        nextItem.set("line_total", 0);
        txApp.save(nextItem);
      }
      next.set("total_amount", currentTotal(txApp, next));
      txApp.save(next);

      recordEvent(txApp, {
        store,
        billId: source.id,
        tableName,
        category: "action",
        eventType: "bill_session_stopped",
        title: "Chốt bill trong phiên",
        actor: auth,
        amount: Number(source.get("total_amount")) || 0,
        details: {
          sessionId,
          nextBillId: next.id,
          customerId: String(next.get("customer") || ""),
        },
        happenedAt: stoppedAt,
      });
      recordEvent(txApp, {
        store,
        billId: next.id,
        tableName,
        category: "action",
        eventType: "bill_session_started",
        title: "Mở bill tiếp theo trong phiên",
        actor: auth,
        details: { sessionId, previousBillId: source.id },
        happenedAt: stoppedAt,
      });
      stoppedBillId = source.id;
      newBillId = next.id;
    });
    return c.json(200, {
      ok: true,
      stoppedBill: detail(
        $app,
        $app.findRecordById("table_bills", stoppedBillId),
      ),
      bill: detail($app, $app.findRecordById("table_bills", newBillId)),
    });
  }

  if (action === "merge_bills") {
    requireBillOperator();
    let targetId = "";
    $app.runInTransaction((txApp) => {
      const source = findStoreBill(txApp, String(input.billId || ""));
      const target = findStoreBill(txApp, String(input.targetBillId || ""));
      if (source.id === target.id)
        throw new BadRequestError("Không thể gộp bill với chính nó");
      if (source.get("status") !== "open" || target.get("status") !== "open")
        throw new BadRequestError("Chỉ được gộp các bill đang mở");
      if (
        source.getString("billing_paused_at") ||
        target.getString("billing_paused_at")
      )
        throw new BadRequestError("Hãy tiếp tục tính tiền trước khi gộp bill");
      const sourceCustomer = String(source.get("customer") || "");
      const targetCustomer = String(target.get("customer") || "");
      if (sourceCustomer && targetCustomer && sourceCustomer !== targetCustomer)
        throw new BadRequestError(
          "Hai bill đang thuộc hai tài khoản khách khác nhau",
        );
      const targetCustomerId = targetCustomer || sourceCustomer;
      const sourceTableName = displayTableName(txApp, source.get("table"));
      const targetTableName = displayTableName(txApp, target.get("table"));
      const sourceItems = billItems(txApp, source.id);
      const targetItems = billItems(txApp, target.id);
      if (
        sourceItems.filter((item) => item.get("billing_unit") === "hour")
          .length +
          targetItems.filter((item) => item.get("billing_unit") === "hour")
            .length >
        1
      )
        throw new BadRequestError(
          "Mỗi bàn chỉ được có một mặt hàng tính theo thời gian",
        );
      const mergedAt = Date.now();
      const mergedAtText = new Date(mergedAt).toISOString();
      for (const item of sourceItems) {
        if (
          item.get("billing_unit") !== "hour" ||
          ["cancelled", "approval_pending", "rejected"].includes(
            String(item.get("queue_status") || ""),
          )
        )
          continue;
        item.set("stopped_at", mergedAtText);
        const calculated = lineAmount(item, mergedAt, source);
        item.set("quantity", calculated.quantity);
        item.set("line_total", calculated.amount);
        txApp.save(item);
      }
      if (!targetCustomer && targetCustomerId)
        target.set("customer", targetCustomerId);
      moveItems(txApp, sourceItems, source, target);
      target.set("total_amount", currentTotal(txApp, target));
      txApp.save(target);
      const sourceTable = findStoreTable(
        txApp,
        String(source.get("table") || ""),
      );
      source.set("status", "cancelled");
      source.set("total_amount", 0);
      source.set("payment_error", "");
      txApp.save(source);
      if (sourceTable.id !== target.get("table")) {
        sourceTable.set("status", "available");
        txApp.save(sourceTable);
      }
      recordEvent(txApp, {
        store,
        billId: source.id,
        tableName: sourceTableName,
        category: "action",
        eventType: "bill_merged_into",
        title: "Bill được gộp vào " + targetTableName,
        actor: auth,
        details: { targetBillId: target.id, targetTableName },
      });
      recordEvent(txApp, {
        store,
        billId: target.id,
        tableName: targetTableName,
        category: "action",
        eventType: "bill_merged_from",
        title: "Nhận bill từ " + sourceTableName,
        actor: auth,
        details: { sourceBillId: source.id, sourceTableName },
      });
      targetId = target.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", targetId)),
    });
  }

  if (action === "transfer_table") {
    requireBillOperator();
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      const targetTableId = String(input.targetTableId || "");
      if (bill.get("status") !== "open")
        throw new BadRequestError("Chỉ được chuyển bill đang mở");
      if (!targetTableId) throw new BadRequestError("Cần chọn bàn chuyển đến");
      const sourceTable = findStoreTable(
        txApp,
        String(bill.get("table") || ""),
      );
      const targetTable = findStoreTable(txApp, targetTableId);
      if (sourceTable.id === targetTable.id)
        throw new BadRequestError("Bill đã ở bàn này");
      if (
        targetTable.get("status") !== "available" ||
        findActiveBill(txApp, targetTable.id)
      )
        throw new BadRequestError("Bàn đích không còn trống");
      const sourceTableName = displayTableName(txApp, sourceTable.id);
      const targetTableName = displayTableName(txApp, targetTable.id);
      bill.set("table", targetTable.id);
      bill.set("table_name", targetTableName);
      bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      sourceTable.set("status", "available");
      txApp.save(sourceTable);
      targetTable.set("status", "occupied");
      txApp.save(targetTable);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: targetTableName,
        category: "action",
        eventType: "bill_table_transferred",
        title: "Chuyển bill từ " + sourceTableName + " sang " + targetTableName,
        actor: auth,
        details: {
          sourceTableId: sourceTable.id,
          sourceTableName,
          targetTableId: targetTable.id,
          targetTableName,
        },
      });
      billId = bill.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
    });
  }

  if (action === "split_bill") {
    requireBillOperator();
    let newBillId = "";
    let sourceBillId = "";
    $app.runInTransaction((txApp) => {
      const source = findStoreBill(txApp, String(input.billId || ""));
      const tableId = String(input.tableId || "");
      const itemIds = Array.isArray(input.itemIds)
        ? input.itemIds.map(String).filter(Boolean)
        : [];
      if (source.get("status") !== "open")
        throw new BadRequestError("Chỉ được tách bill đang mở");
      if (source.getString("billing_paused_at"))
        throw new BadRequestError("Hãy tiếp tục tính tiền trước khi tách bill");
      if (!tableId || tableId === String(source.get("table") || ""))
        throw new BadRequestError("Cần chọn một bàn khác để tạo bill mới");
      if (!itemIds.length)
        throw new BadRequestError("Cần chọn ít nhất một mặt hàng để tách");
      const table = findStoreTable(txApp, tableId);
      if (
        table.get("status") !== "available" ||
        findActiveBill(txApp, table.id)
      )
        throw new BadRequestError("Bàn đích không còn trống");
      const sourceItems = billItems(txApp, source.id);
      const selected = sourceItems.filter((item) => itemIds.includes(item.id));
      if (selected.length !== itemIds.length)
        throw new BadRequestError("Có mặt hàng không thuộc bill này");
      const hourlyCount = sourceItems.filter(
        (item) => item.get("billing_unit") === "hour",
      ).length;
      const selectedHourlyCount = selected.filter(
        (item) => item.get("billing_unit") === "hour",
      ).length;
      if (selectedHourlyCount > 1 || hourlyCount - selectedHourlyCount > 1)
        throw new BadRequestError(
          "Mỗi bàn chỉ được có một mặt hàng tính theo thời gian",
        );
      const newBill = new Record(txApp.findCollectionByNameOrId("table_bills"));
      const sourceTableName = displayTableName(txApp, source.get("table"));
      const newTableName = displayTableName(txApp, table.id);
      newBill.set("store", store);
      newBill.set("table", table.id);
      newBill.set("table_name", newTableName);
      newBill.set("customer", source.get("customer"));
      newBill.set("opened_by", auth.id);
      newBill.set("status", "open");
      newBill.set("total_amount", 0);
      newBill.set(
        "started_at",
        source.get("started_at") || new Date().toISOString(),
      );
      txApp.save(newBill);
      newBill.set("paused_seconds", Number(source.get("paused_seconds")) || 0);
      const splitAt = new Date().toISOString();
      const splitAtMs = Date.parse(splitAt);
      const targetItemIds = [];
      for (const item of selected) {
        if (item.get("billing_unit") !== "hour") {
          moveItems(txApp, [item], source, newBill);
          targetItemIds.push(item.id);
          continue;
        }

        item.set("stopped_at", splitAt);
        const calculated = lineAmount(item, splitAtMs, source);
        item.set("quantity", calculated.quantity);
        item.set("line_total", calculated.amount);
        txApp.save(item);

        const nextItem = new Record(txApp.findCollectionByNameOrId("table_bill_items"));
        for (const field of ["store", "product", "product_name", "billing_unit", "unit_label", "unit_price", "purchase_price", "time_pricing", "queue_status", "queue_completed_at"]) {
          const value = item.get(field);
          if (value !== undefined && value !== null && value !== "") nextItem.set(field, value);
        }
        nextItem.set("bill", newBill.id);
        nextItem.set("customer", newBill.get("customer"));
        nextItem.set("quantity", 1);
        nextItem.set("started_at", splitAt);
        nextItem.set("stopped_at", "");
        nextItem.set("paused_seconds_at_start", Number(newBill.get("paused_seconds")) || 0);
        nextItem.set("line_total", 0);
        txApp.save(nextItem);
        targetItemIds.push(nextItem.id);
      }
      source.set("total_amount", currentTotal(txApp, source));
      newBill.set("total_amount", currentTotal(txApp, newBill));
      txApp.save(source);
      txApp.save(newBill);
      table.set("status", "occupied");
      txApp.save(table);
      recordEvent(txApp, {
        store,
        billId: source.id,
        tableName: sourceTableName,
        category: "action",
        eventType: "bill_split_out",
        title: "Tách mặt hàng sang " + newTableName,
        actor: auth,
        details: {
          targetBillId: newBill.id,
          targetTableName: newTableName,
          itemIds,
          targetItemIds,
        },
      });
      recordEvent(txApp, {
        store,
        billId: newBill.id,
        tableName: newTableName,
        category: "action",
        eventType: "bill_split_created",
        title: "Tạo bill từ " + sourceTableName,
        actor: auth,
        details: { sourceBillId: source.id, sourceTableName, itemIds: targetItemIds },
      });
      newBillId = newBill.id;
      sourceBillId = source.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", newBillId)),
      sourceBill: detail(
        $app,
        $app.findRecordById("table_bills", sourceBillId),
      ),
    });
  }

  const publicOrder = action === "public_order";
  if (action === "add_item" || publicOrder) {
    const requestedItems = publicOrder ? input.items : [{ productId: input.productId, quantity: input.quantity }];
    if (!Array.isArray(requestedItems) || !requestedItems.length || requestedItems.length > 30)
      throw new BadRequestError("Danh sách món không hợp lệ");
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (publicOrder) {
        const tableId = String(input.tableId || "");
        const latest = txApp.findRecordsByFilter("table_bills", "store = {:store} && table = {:table}", "-created", 1, 0, { store, table: tableId })[0];
        if (bill.get("table") !== tableId || !latest || latest.id !== bill.id)
          throw new BadRequestError("Bill đã thay đổi. Vui lòng tải lại trang.");
      }
      if (!publicOrder && !canOperateBill && bill.get("customer") !== auth.id)
        throw new ForbiddenError(
          "Chỉ admin, nhân viên hoặc khách của bàn mới được thêm mặt hàng",
        );
      if (bill.get("status") !== "open")
        throw new BadRequestError(
          "Hóa đơn không ở trạng thái có thể chỉnh sửa",
        );
      if (bill.getString("billing_paused_at"))
        throw new BadRequestError(
          "Hãy tiếp tục tính tiền trước khi thêm mặt hàng",
        );
      const selectedAt = new Date().toISOString();
      const approvalRequired = publicOrder || !canOperateBill;
      for (const requested of requestedItems) {
        const product = txApp.findRecordById("products", String(requested.productId || ""));
        if (product.get("store") !== store || product.get("is_active") !== true)
          throw new ForbiddenError("Mặt hàng không khả dụng tại cửa hàng");
        const unit = String(product.get("billing_unit") || "quantity");
        if (publicOrder && unit === "hour") throw new BadRequestError("Không thể gọi món tính theo giờ từ menu");
        if (unit === "hour" && billItems(txApp, bill.id).some((item) => item.get("billing_unit") === "hour"))
          throw new BadRequestError("Mỗi bàn chỉ được có một mặt hàng tính theo thời gian");
        const quantity = unit === "hour" ? 1 : Number(requested.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0 || (unit === "quantity" && !Number.isInteger(quantity)))
          throw new BadRequestError("Số lượng không hợp lệ");
        if (!approvalRequired && unit !== "hour" && product.get("kind") !== "service")
          ensureProductAvailable(txApp, product.id, quantity);
        const price = Number(product.get("price"));
        if (!Number.isInteger(price) || price < 0) throw new BadRequestError("Giá mặt hàng phải là số nguyên không âm");
        const timePricing = unit === "hour" ? normalizeTimePricing(product.getString("time_pricing"), true) : null;
        const item = new Record(txApp.findCollectionByNameOrId("table_bill_items"));
        item.set("store", store);
        item.set("bill", bill.id);
        item.set("customer", bill.get("customer"));
        item.set("product", product.id);
        item.set("product_name", product.get("name"));
        item.set("billing_unit", unit);
        item.set("unit_label", product.get("unit_label") || (unit === "hour" ? "giờ" : unit === "weight" ? "kg" : "lần"));
        item.set("unit_price", price);
        item.set("purchase_price", Math.max(0, Math.round(Number(product.get("purchase_price")) || 0)));
        if (timePricing) item.set("time_pricing", timePricing);
        item.set("quantity", quantity);
        item.set("started_at", unit === "hour" && !approvalRequired ? selectedAt : "");
        item.set("paused_seconds_at_start", Number(bill.get("paused_seconds")) || 0);
        item.set("line_total", unit === "hour" || approvalRequired ? 0 : Math.round(price * quantity));
        if (approvalRequired) {
          item.set("queue_status", "approval_pending");
          item.set("queued_at", selectedAt);
        } else if (needsPreparation(product)) {
          item.set("queue_status", "pending");
          item.set("queued_at", selectedAt);
        }
        txApp.save(item);
        recordEvent(txApp, {
          store, billId: bill.id, tableName: displayTableName(txApp, bill.get("table")),
          category: "action", eventType: approvalRequired ? "order_requested" : "item_added",
          title: (approvalRequired ? "Yêu cầu " : "Thêm ") + product.get("name"), actor: auth,
          amount: approvalRequired ? 0 : lineAmount(item, Date.now(), bill).amount,
          details: { itemId: item.id, productId: product.id, productName: product.get("name"), billingUnit: unit, quantity, unitPrice: price },
        });
      }
      if (!bill.get("started_at")) bill.set("started_at", selectedAt);
      bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      billId = bill.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
    });
  }

  if (action === "queue_done" || action === "queue_cancel") {
    requireBillOperator();
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") !== "open")
        throw new BadRequestError("Chỉ xử lý món trên hóa đơn đang mở");
      const item = txApp.findRecordById(
        "table_bill_items",
        String(input.itemId || ""),
      );
      if (item.get("bill") !== bill.id || item.get("store") !== store)
        throw new ForbiddenError("Món không thuộc hóa đơn của cửa hàng");
      if (item.get("queue_status") !== "pending") {
        if (action === "queue_done" && item.get("queue_status") === "done") {
          billId = bill.id;
          return;
        }
        throw new BadRequestError("Món đã được người khác xử lý");
      }
      const completed = action === "queue_done";
      const now = new Date().toISOString();
      item.set("queue_status", completed ? "done" : "cancelled");
      item.set(completed ? "queue_completed_at" : "queue_cancelled_at", now);
      txApp.save(item);
      if (!completed) bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: displayTableName(txApp, bill.get("table")),
        category: "action",
        eventType: completed ? "queue_completed" : "queue_cancelled",
        title: (completed ? "Hoàn thành " : "Hủy ") + item.get("product_name"),
        actor: auth,
        details: {
          itemId: item.id,
          productName: item.get("product_name"),
          quantity: Number(item.get("quantity")) || 0,
        },
      });
      publishStaffQueue(txApp, store, auth.id, "history");
      billId = bill.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
    });
  }

  if (action === "update_item") {
    requireBillOperator();
    if (input.reason !== undefined && typeof input.reason !== "string")
      throw new BadRequestError("Lý do điều chỉnh không hợp lệ");
    const reason = String(input.reason || "").trim();
    if (isStaff && !reason)
      throw new BadRequestError("Nhân viên cần nhập lý do điều chỉnh số lượng");
    if (reason.length > 500)
      throw new BadRequestError("Lý do điều chỉnh không được vượt quá 500 ký tự");
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") !== "open")
        throw new BadRequestError(
          "Hóa đơn không ở trạng thái có thể chỉnh sửa",
        );
      if (bill.getString("billing_paused_at"))
        throw new BadRequestError(
          "Hãy tiếp tục tính tiền trước khi sửa mặt hàng",
        );
      const item = txApp.findRecordById(
        "table_bill_items",
        String(input.itemId || ""),
      );
      if (item.get("bill") !== bill.id || item.get("store") !== store)
        throw new ForbiddenError("Dòng hàng không thuộc hóa đơn");
      if (item.get("billing_unit") === "hour")
        throw new BadRequestError(
          "Mặt hàng tính giờ tự tính từ lúc thêm; hãy xóa và thêm lại nếu cần",
        );
      const quantity = Number(input.quantity);
      if (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        (item.get("billing_unit") === "quantity" && !Number.isInteger(quantity))
      )
        throw new BadRequestError("Số lượng không hợp lệ");
      if (item.get("product"))
        ensureProductAvailable(
          txApp,
          String(item.get("product")),
          quantity,
          item.id,
        );
      const oldQuantity = Number(item.get("quantity")) || 0;
      const oldLineTotal = Number(item.get("line_total")) || 0;
      const productName = item.get("product_name");
      item.set("quantity", quantity);
      item.set(
        "line_total",
        Math.round(Number(item.get("unit_price")) * quantity),
      );
      txApp.save(item);
      bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: displayTableName(txApp, bill.get("table")),
        category: "action",
        eventType: "quantity_changed",
        title: "Điều chỉnh số lượng " + productName,
        actor: auth,
        details: {
          itemId: item.id,
          productName,
          billingUnit: item.get("billing_unit"),
          oldQuantity,
          newQuantity: quantity,
          quantityDelta: quantity - oldQuantity,
          oldLineTotal,
          newLineTotal: Number(item.get("line_total")) || 0,
          lineTotalDelta: (Number(item.get("line_total")) || 0) - oldLineTotal,
           ...(reason ? { reason } : {}),
        },
      });
      billId = bill.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
    });
  }

  if (action === "update_item_time") {
    requireBillOperator();
    if (input.reason !== undefined && typeof input.reason !== "string")
      throw new BadRequestError("Lý do điều chỉnh không hợp lệ");
    const reason = String(input.reason || "").trim();
    if (isStaff && !reason)
      throw new BadRequestError("Nhân viên cần nhập lý do điều chỉnh thời gian");
    if (reason.length > 500)
      throw new BadRequestError("Lý do điều chỉnh không được vượt quá 500 ký tự");
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") !== "open")
        throw new BadRequestError(
          "Hóa đơn không ở trạng thái có thể chỉnh sửa",
        );
      if (bill.getString("billing_paused_at"))
        throw new BadRequestError(
          "Hãy tiếp tục tính tiền trước khi sửa thời gian",
        );
      const item = txApp.findRecordById(
        "table_bill_items",
        String(input.itemId || ""),
      );
      if (item.get("bill") !== bill.id || item.get("store") !== store)
        throw new ForbiddenError("Dòng hàng không thuộc hóa đơn");
      if (item.get("billing_unit") !== "hour")
        throw new BadRequestError(
          "Chỉ mặt hàng tính theo thời gian mới sửa được mốc giờ",
        );
      const startedAtText = String(input.startedAt || "");
      const stoppedAtText = String(input.stoppedAt || "");
      const isoDateTime =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
      const startedAt = isoDateTime.test(startedAtText)
        ? Date.parse(startedAtText)
        : NaN;
      const stoppedAt = stoppedAtText
        ? isoDateTime.test(stoppedAtText)
          ? Date.parse(stoppedAtText)
          : NaN
        : NaN;
      const now = Date.now();
      if (!Number.isFinite(startedAt) || startedAt > now)
        throw new BadRequestError("Giờ bắt đầu không hợp lệ");
      if (
        stoppedAtText &&
        (!Number.isFinite(stoppedAt) ||
          stoppedAt <= startedAt ||
          stoppedAt > now)
      )
        throw new BadRequestError(
          "Giờ kết thúc phải sau giờ bắt đầu và không ở tương lai",
        );
      const oldStartedAt = item.get("started_at") || "";
      const oldStoppedAt = item.get("stopped_at") || "";
      const oldAmount = lineAmount(item, now, bill).amount;
      item.set("started_at", new Date(startedAt).toISOString());
      item.set(
        "stopped_at",
        stoppedAtText ? new Date(stoppedAt).toISOString() : "",
      );
      const calculated = lineAmount(item, now, bill);
      item.set("quantity", calculated.quantity);
      item.set("line_total", calculated.amount);
      txApp.save(item);
      bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: displayTableName(txApp, bill.get("table")),
        category: "action",
        eventType: "item_time_changed",
        title: "Điều chỉnh thời gian " + item.get("product_name"),
        actor: auth,
        amount: calculated.amount - oldAmount,
        details: {
          itemId: item.id,
          productName: item.get("product_name"),
          oldStartedAt,
          newStartedAt: item.get("started_at"),
          oldStoppedAt,
          newStoppedAt: item.get("stopped_at") || "",
          oldLineTotal: oldAmount,
          newLineTotal: calculated.amount,
           ...(reason ? { reason } : {}),
        },
      });
      billId = bill.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
    });
  }

  if (action === "delete_item") {
    requireBillOperator();
    if (input.reason !== undefined && typeof input.reason !== "string")
      throw new BadRequestError("Lý do xóa không hợp lệ");
    const reason = (input.reason || "").trim();
    if (isStaff && !reason)
      throw new BadRequestError("Nhân viên cần nhập lý do xóa mặt hàng");
    if (reason.length > 500)
      throw new BadRequestError("Lý do xóa không được vượt quá 500 ký tự");
    let billId = "";
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") !== "open")
        throw new BadRequestError(
          "Hóa đơn không ở trạng thái có thể chỉnh sửa",
        );
      if (bill.getString("billing_paused_at"))
        throw new BadRequestError(
          "Hãy tiếp tục tính tiền trước khi xóa mặt hàng",
        );
      const item = txApp.findRecordById(
        "table_bill_items",
        String(input.itemId || ""),
      );
      if (item.get("bill") !== bill.id || item.get("store") !== store)
        throw new ForbiddenError("Dòng hàng không thuộc hóa đơn");
      const calculated = lineAmount(item, Date.now(), bill);
      const itemSnapshot = {
        itemId: item.id,
        productId: item.get("product") || "",
        productName: item.get("product_name"),
        billingUnit: item.get("billing_unit"),
        quantity: calculated.quantity,
        unitPrice: Number(item.get("unit_price")) || 0,
        lineTotal: calculated.amount,
        startedAt: item.get("started_at") || "",
        stoppedAt: item.get("stopped_at") || "",
        reason,
      };
      txApp.delete(item);
      bill.set("total_amount", currentTotal(txApp, bill));
      txApp.save(bill);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: displayTableName(txApp, bill.get("table")),
        category: "action",
        eventType: "item_removed",
        title: "Xóa " + itemSnapshot.productName,
        actor: auth,
        details: itemSnapshot,
      });
      billId = bill.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
    });
  }

  if (action === "request_wallet") {
    const bill = findStoreBill($app, String(input.billId || ""));
    if (isAdmin || !canViewBill($app, bill, auth.id))
      throw new ForbiddenError(
        "Chỉ khách thuộc phiên mới gửi yêu cầu thanh toán",
      );
    let response;
    $app.runInTransaction((txApp) => {
      const txBill = findStoreBill(txApp, bill.id);
      ensureOrderRequestsResolved(txApp, txBill);
      if (txBill.get("status") === "wallet_pending") {
        if (txBill.get("payment_method") !== "wallet")
          throw new BadRequestError("Hóa đơn đang chờ xác nhận chuyển khoản");
        response = {
          ok: true,
          alreadyRequested: true,
          bill: detail(txApp, txBill),
        };
        return;
      }
      const status = String(txBill.get("status"));
      if (!["open", "stopped"].includes(status))
        throw new BadRequestError("Hóa đơn không thể yêu cầu thanh toán");
      if (status === "stopped" && txBill.getString("wallet_requested_at")) {
        if (txBill.get("payment_method") !== "wallet")
          throw new BadRequestError("Hóa đơn đang chờ xác nhận chuyển khoản");
        response = {
          ok: true,
          alreadyRequested: true,
          bill: detail(txApp, txBill),
        };
        return;
      }
      if (!canViewBill(txApp, txBill, auth.id))
        throw new ForbiddenError(
          "Chỉ khách thuộc phiên mới gửi yêu cầu thanh toán",
        );
      const now = Date.now();
      let grossTotal = Number(txBill.get("gross_amount")) || 0;
      let total = Number(txBill.get("total_amount")) || 0;
      if (status === "open") {
        grossTotal = freezeBill(txApp, txBill, now);
        const applied = recalculatePromotion(txApp, txBill, now, grossTotal);
        total = applied.result ? applied.result.total : grossTotal;
      }
      total = roundPaymentAmount(total);
      txBill.set("requested_amount", total);
      txBill.set("wallet_requested_at", new Date(now).toISOString());
      txBill.set("payment_requester", auth.id);
      txBill.set("payment_method", "wallet");
      txBill.set("payment_error", "");
      if (status === "open") txBill.set("status", "wallet_pending");
      txApp.save(txBill);
      recordEvent(txApp, {
        store,
        billId: txBill.id,
        tableName: displayTableName(txApp, txBill.get("table")),
        category: "payment",
        eventType: "payment_requested",
        title: "Yêu cầu thanh toán bằng ví",
        actor: auth,
        paymentMethod: "wallet",
        amount: total,
        details: {},
      });
      notifyAdmins(
        txApp,
        store,
        "table_bill_wallet",
        "Yêu cầu trừ tiền vào ví",
        "Khách đã gửi yêu cầu trừ " +
          String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ".") +
          "đ cho " +
          displayTableName(txApp, txBill.get("table")),
        txBill.id,
      );
      response = {
        ok: true,
        alreadyRequested: false,
        bill: detail(txApp, txBill),
      };
    });
    return c.json(200, response);
  }

  if (action === "request_transfer" || action === "public_request_transfer") {
    const publicRequest = action === "public_request_transfer";
    let bill;
    let billStore;
    if (publicRequest) {
      const table = $app.findRecordById("tables", String(input.tableId || ""));
      billStore = String(table.get("store") || "");
      store = billStore;
      const bills = $app.findRecordsByFilter("table_bills", "store = {:store} && table = {:table}", "-created", 1, 0, { store: billStore, table: table.id });
      bill = bills[0];
      if (!bill || !["open", "wallet_pending", "stopped"].includes(String(bill.get("status")))) throw new BadRequestError("Bàn chưa có hóa đơn cần thanh toán");
      if (String(input.billId || "") !== bill.id) throw new BadRequestError("Bill đã thay đổi. Hãy tải lại trang để lấy đúng số tiền.");
    } else {
      bill = findStoreBill($app, String(input.billId || ""));
      billStore = String(bill.get("store") || "");
    }
    if (publicRequest) store = billStore;
    if (!billStore || (!publicRequest && (isAdmin || !canViewBill($app, bill, auth.id))))
      throw new ForbiddenError("Chỉ khách thuộc phiên mới gửi yêu cầu");
    let response;
    $app.runInTransaction((txApp) => {
      const txBill = txApp.findRecordById("table_bills", bill.id);
      if (txBill.get("store") !== billStore) throw new ForbiddenError("Hóa đơn không hợp lệ");
      ensureOrderRequestsResolved(txApp, txBill);
      if (txBill.get("status") === "wallet_pending") {
        if (txBill.get("payment_method") !== "transfer")
          throw new BadRequestError("Hóa đơn đang chờ duyệt thanh toán ví");
        response = {
          ok: true,
          alreadyRequested: true,
          bill: detail(txApp, txBill),
        };
        return;
      }
      const status = String(txBill.get("status"));
      if (!["open", "stopped"].includes(status))
        throw new BadRequestError(
          "Hóa đơn không thể yêu cầu xác nhận chuyển khoản",
        );
      if (status === "stopped" && txBill.getString("wallet_requested_at")) {
        if (txBill.get("payment_method") !== "transfer")
          throw new BadRequestError("Hóa đơn đang chờ duyệt thanh toán ví");
        response = {
          ok: true,
          alreadyRequested: true,
          bill: detail(txApp, txBill),
        };
        return;
      }
      if (!publicRequest && !canViewBill(txApp, txBill, auth.id))
        throw new ForbiddenError("Chỉ khách thuộc phiên mới gửi yêu cầu");
      const now = Date.now();
      let grossTotal = Number(txBill.get("gross_amount")) || 0;
      let total = Number(txBill.get("total_amount")) || 0;
      if (status === "open") {
        grossTotal = freezeBill(txApp, txBill, now);
        const applied = recalculatePromotion(txApp, txBill, now, grossTotal);
        total = applied.result ? applied.result.total : grossTotal;
      }
      txBill.set("requested_amount", total);
      txBill.set("wallet_requested_at", new Date(now).toISOString());
      txBill.set("payment_requester", publicRequest ? "" : auth.id);
      txBill.set("payment_method", "transfer");
      txBill.set("payment_error", "");
      if (status === "open") txBill.set("status", "wallet_pending");
      txApp.save(txBill);
      recordEvent(txApp, {
        store: billStore,
        billId: txBill.id,
        tableName: displayTableName(txApp, txBill.get("table")),
        category: "payment",
        eventType: "payment_requested",
        title: "Khách báo đã chuyển khoản",
        actor: publicRequest ? null : auth,
        paymentMethod: "transfer",
        amount: total,
        details: {},
      });
      notifyAdmins(
        txApp,
        billStore,
        "table_bill_transfer",
        "Yêu cầu xác nhận chuyển khoản",
        "Khách báo đã chuyển " +
          String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ".") +
          "đ cho " +
          displayTableName(txApp, txBill.get("table")),
        txBill.id,
      );
      publishStaffQueue(txApp, billStore, auth ? auth.id : "", "payment");
      response = {
        ok: true,
        alreadyRequested: false,
        bill: detail(txApp, txBill),
      };
    });
    return c.json(200, response);
  }

  if (action === "pay_manual") {
    requireBillOperator();
    const discountPercent = paymentDiscountPercent();
    const discountNote = paymentDiscountNote();
    const paymentMethod = String(input.paymentMethod || "");
    if (!["cash", "transfer"].includes(paymentMethod))
      throw new BadRequestError("Phương thức thanh toán không hợp lệ");
    const cashReceived = input.cashReceived;
    if (
      paymentMethod === "cash" &&
      (!Number.isSafeInteger(cashReceived) || cashReceived < 0)
    )
      throw new BadRequestError("Số tiền khách đưa phải là số nguyên không âm");
    let billId = "";
    let change = 0;
    let discountAmount = 0;
    let paymentDiscountAmount = 0;
    let grossAmount = 0;
    let amountBeforePaymentDiscount = 0;
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (
        !["open", "wallet_pending", "stopped"].includes(
          String(bill.get("status")),
        )
      )
        throw new BadRequestError("Hóa đơn đã được xử lý");
      ensureOrderRequestsResolved(txApp, bill);
      const table = findStoreTable(txApp, String(bill.get("table") || ""));
      const now = Date.now();
      const status = String(bill.get("status"));
      const grossTotal = ["wallet_pending", "stopped"].includes(status)
        ? Number(bill.get("gross_amount")) ||
          Number(bill.get("requested_amount")) ||
          0
        : freezeBill(txApp, bill, now);
      const applied = recalculatePromotion(txApp, bill, now, grossTotal);
      discountAmount = applied.result ? applied.result.discountAmount : 0;
      amountBeforePaymentDiscount = applied.result
        ? applied.result.total
        : grossTotal;
      paymentDiscountAmount = Math.round(
        (amountBeforePaymentDiscount * discountPercent) / 100,
      );
      const total = roundPaymentAmount(Math.max(
        0,
        amountBeforePaymentDiscount - paymentDiscountAmount,
      ));
      grossAmount = grossTotal;
      if (paymentMethod === "cash" && cashReceived < total)
        throw new BadRequestError("Tiền khách đưa chưa đủ thanh toán hóa đơn");
      if (paymentMethod === "cash") change = cashReceived - total;
      bill.set("total_amount", total);
      bill.set("requested_amount", amountBeforePaymentDiscount);
      bill.set("payment_method", paymentMethod);
      bill.set("cash_received", paymentMethod === "cash" ? cashReceived : 0);
      bill.set("paid_by", auth.id);
      bill.set("paid_at", new Date(now).toISOString());
      bill.set("payment_error", "");
      bill.set("status", "paid");
      txApp.save(bill);
      markBillNotificationsRead(txApp, store, auth.id, bill.id);
      if (shouldReleaseTable(txApp, table.id)) {
        table.set("status", "available");
        txApp.save(table);
      }
      recordInventorySales(txApp, bill);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: displayTableName(txApp, bill.get("table")),
        category: "payment",
        eventType: "payment_completed",
        title: "Đã thanh toán hóa đơn",
        actor: auth,
        paymentMethod,
        amount: total,
        details: {
          grossAmount: grossTotal,
          discountAmount,
          promotion: applied.result ? applied.result.snapshot : null,
          paymentDiscountPercent: discountPercent,
          paymentDiscountAmount,
          amountBeforePaymentDiscount,
          ...(discountNote ? { paymentDiscountNote: discountNote } : {}),
        },
      });
      billId = bill.id;
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, $app.findRecordById("table_bills", billId)),
      grossAmount,
      discountAmount,
      paymentDiscountPercent: discountPercent,
      paymentDiscountAmount,
      amountBeforePaymentDiscount,
      ...(paymentMethod === "cash" ? { change } : {}),
    });
  }

  if (action === "approve_wallet" || action === "public_wallet_payment") {
    const publicWalletPayment = action === "public_wallet_payment";
    if (publicWalletPayment && (!auth || auth.get("role") !== "user")) throw new ForbiddenError("Chỉ tài khoản khách mới được thanh toán bằng ví");
    if (!publicWalletPayment) requireBillOperator();
    const discountPercent = paymentDiscountPercent();
    const discountNote = paymentDiscountNote();
    let result;
    let discountAmount = 0;
    let paymentDiscountAmount = 0;
    $app.runInTransaction((txApp) => {
      const bill = findStoreBill(txApp, String(input.billId || ""));
      if (bill.get("status") === "paid") {
        result = { ok: true, alreadyPaid: true, bill: detail(txApp, bill) };
        return;
      }
      const stoppedPaymentPending =
        bill.get("status") === "stopped" &&
        Boolean(bill.getString("wallet_requested_at"));
      if (!publicWalletPayment && bill.get("status") !== "wallet_pending" && !stoppedPaymentPending)
        throw new BadRequestError("Hóa đơn chưa có yêu cầu thanh toán ví");
      if (!publicWalletPayment && bill.get("payment_method") !== "wallet")
        throw new BadRequestError("Hóa đơn đang chờ xác nhận chuyển khoản");
      if (publicWalletPayment && !["open", "stopped"].includes(String(bill.get("status")))) throw new BadRequestError("Hóa đơn không thể thanh toán bằng ví");
      if (publicWalletPayment && !canViewBill(txApp, bill, auth.id)) throw new ForbiddenError("Chỉ khách thuộc phiên mới được thanh toán hóa đơn này");
      if (publicWalletPayment) ensureOrderRequestsResolved(txApp, bill);
      const customerId = publicWalletPayment ? auth.id : String(bill.get("payment_requester") || bill.get("customer") || "");
      if (!customerId)
        throw new BadRequestError(
          "Không tìm thấy khách gửi yêu cầu thanh toán ví",
        );
      const customer = txApp.findRecordById("users", customerId);
      if (customer.get("store") !== store || customer.get("role") !== "user")
        throw new ForbiddenError("Tài khoản khách không còn thuộc cửa hàng");
      let wallet;
      try {
        wallet = txApp.findFirstRecordByFilter(
          "wallets",
          "user = {:user} && store = {:store}",
          { user: customerId, store },
        );
      } catch (e) {
        wallet = new Record(txApp.findCollectionByNameOrId("wallets"));
        wallet.set("user", customerId);
        wallet.set("store", store);
        wallet.set("main_balance", 0);
        txApp.save(wallet);
      }

      const lots = txApp.findRecordsByFilter(
        "wallet_promo_lots",
        "wallet = {:wallet} && status = 'active'",
        "expires_at,created",
        -1,
        0,
        { wallet: wallet.id },
      );
      const activeLots = [];
      let promoAvailable = 0;
      const now = Date.now();
      for (const lot of lots) {
        if (new Date(lot.get("expires_at")).getTime() <= now) {
          lot.set("remaining_amount", 0);
          lot.set("status", "expired");
          txApp.save(lot);
          continue;
        }
        const amount = Number(lot.get("remaining_amount")) || 0;
        if (amount > 0) {
          activeLots.push(lot);
          promoAvailable += amount;
        }
      }

      const grossTotal = publicWalletPayment && bill.get("status") === "open"
        ? freezeBill(txApp, bill, Date.now())
        : Number(bill.get("gross_amount")) || Number(bill.get("requested_amount")) || 0;
      const applied = recalculatePromotion(txApp, bill, Date.now(), grossTotal);
      discountAmount = applied.result ? applied.result.discountAmount : 0;
      const amountBeforePaymentDiscount = applied.result
        ? applied.result.total
        : grossTotal;
      paymentDiscountAmount = Math.round(
        (amountBeforePaymentDiscount * discountPercent) / 100,
      );
      const total = roundPaymentAmount(Math.max(
        0,
        amountBeforePaymentDiscount - paymentDiscountAmount,
      ));
      const promoUsed = Math.min(total, promoAvailable);
      const mainBefore = Number(wallet.get("main_balance")) || 0;
      const mainUsed = total - promoUsed;
      if (mainBefore < mainUsed) {
        bill.set("payment_error", "Tổng số dư ví không đủ thanh toán");
        txApp.save(bill);
        recordEvent(txApp, {
          store,
          billId: bill.id,
          tableName: displayTableName(txApp, bill.get("table")),
          category: "payment",
          eventType: "payment_failed",
          title: "Thanh toán ví không thành công",
          actor: auth,
          paymentMethod: "wallet",
          amount: total,
          details: {
            reason: "Tổng số dư ví không đủ thanh toán",
            paymentDiscountPercent: discountPercent,
            paymentDiscountAmount,
            ...(discountNote ? { paymentDiscountNote: discountNote } : {}),
          },
        });
        result = {
          ok: false,
          error: "Tổng số dư ví không đủ thanh toán",
          bill: detail(txApp, bill),
        };
        return;
      }

      let left = promoUsed;
      for (const lot of activeLots) {
        if (left <= 0) break;
        const available = Number(lot.get("remaining_amount")) || 0;
        const used = Math.min(available, left);
        const before = promoAvailable - (promoUsed - left);
        lot.set("remaining_amount", available - used);
        lot.set("status", available === used ? "consumed" : "active");
        txApp.save(lot);
        const tx = new Record(
          txApp.findCollectionByNameOrId("wallet_transactions"),
        );
        tx.set("wallet", wallet.id);
        tx.set("user", customerId);
        tx.set("store", store);
        tx.set("wallet_type", "promo");
        tx.set("direction", "debit");
        tx.set("amount", used);
        tx.set(
          "reason",
          "Thanh toán hóa đơn bàn " +
            displayTableName(txApp, bill.get("table")),
        );
        tx.set("actor", auth.id);
        tx.set("promo_lot", lot.id);
        tx.set("reference_type", "table_bill");
        tx.set("reference_id", bill.id);
        tx.set("idempotency_key", "table-bill-" + bill.id + "-promo-" + lot.id);
        tx.set("balance_before", before);
        tx.set("balance_after", before - used);
        txApp.save(tx);
        left -= used;
      }
      if (mainUsed > 0) {
        wallet.set("main_balance", mainBefore - mainUsed);
        txApp.save(wallet);
        const tx = new Record(
          txApp.findCollectionByNameOrId("wallet_transactions"),
        );
        tx.set("wallet", wallet.id);
        tx.set("user", customerId);
        tx.set("store", store);
        tx.set("wallet_type", "main");
        tx.set("direction", "debit");
        tx.set("amount", mainUsed);
        tx.set(
          "reason",
          "Thanh toán hóa đơn bàn " +
            displayTableName(txApp, bill.get("table")),
        );
        tx.set("actor", auth.id);
        tx.set("reference_type", "table_bill");
        tx.set("reference_id", bill.id);
        tx.set("idempotency_key", "table-bill-" + bill.id + "-main");
        tx.set("balance_before", mainBefore);
        tx.set("balance_after", mainBefore - mainUsed);
        txApp.save(tx);
      }

      const table = findStoreTable(txApp, String(bill.get("table") || ""));
      bill.set("total_amount", total);
      bill.set("payment_method", "wallet");
      bill.set("paid_by", auth.id);
      bill.set("paid_at", new Date().toISOString());
      bill.set("payment_error", "");
      bill.set("status", "paid");
      txApp.save(bill);
      markBillNotificationsRead(txApp, store, auth.id, bill.id);
      if (shouldReleaseTable(txApp, table.id)) {
        table.set("status", "available");
        txApp.save(table);
      }
      recordInventorySales(txApp, bill);
      recordEvent(txApp, {
        store,
        billId: bill.id,
        tableName: displayTableName(txApp, bill.get("table")),
        category: "payment",
        eventType: "payment_completed",
        title: "Đã thanh toán hóa đơn",
        actor: auth,
        paymentMethod: "wallet",
        amount: total,
        details: {
          grossAmount: grossTotal,
          discountAmount,
          promotion: applied.result ? applied.result.snapshot : null,
          promoUsed,
          mainUsed,
          paymentDiscountPercent: discountPercent,
          paymentDiscountAmount,
          amountBeforePaymentDiscount,
          ...(discountNote ? { paymentDiscountNote: discountNote } : {}),
        },
      });
      if (publicWalletPayment) {
        notifyAdmins(txApp, store, "table_bill_wallet", "Khách đã thanh toán bằng ví", "Khách đã thanh toán " + String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ cho " + displayTableName(txApp, bill.get("table")), bill.id);
        publishStaffQueue(txApp, store, auth.id, "payment");
      }
      result = {
        ok: true,
        alreadyPaid: false,
        promoUsed,
        mainUsed,
        discountAmount,
        paymentDiscountPercent: discountPercent,
        paymentDiscountAmount,
        amountBeforePaymentDiscount,
        bill: detail(txApp, bill),
      };
    });
    return c.json(result.ok ? 200 : 409, result);
  }

  if (action === "print") {
    requireBillOperator();
    const bill = findStoreBill($app, String(input.billId || ""));
    if (bill.get("status") !== "paid")
      throw new BadRequestError("Chỉ in hóa đơn đã thanh toán");
    const prior = $app.findRecordsByFilter(
      "table_bill_events",
      "store = {:store} && bill_id = {:bill} && event_type = 'bill_printed'",
      "created",
      1,
      0,
      { store, bill: bill.id },
    );
    recordEvent($app, {
      store,
      billId: bill.id,
      tableName: displayTableName($app, bill.get("table")),
      category: "action",
      eventType: prior.length ? "bill_reprinted" : "bill_printed",
      title: prior.length ? "In lại hóa đơn" : "In hóa đơn",
      actor: auth,
      paymentMethod: bill.get("payment_method") || "",
      amount: Number(bill.get("total_amount")) || 0,
      details: {},
    });
    return c.json(200, {
      ok: true,
      bill: detail($app, bill),
      reprinted: prior.length > 0,
    });
  }

  throw new BadRequestError("Thao tác hóa đơn không hợp lệ");
});
