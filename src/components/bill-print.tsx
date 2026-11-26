import type { TableBill, TableBillSessionSummary } from "@/api/pocketbase";
import { billPaymentService } from "@/api/services";
import { formatVietnamDateTime } from "@/utils/format";

const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString("vi-VN")}đ`;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character] || character));
const method = (value: TableBill["paymentMethod"]) => ({ cash: "Tiền mặt", transfer: "Chuyển khoản", wallet: "Ví" }[value] || "Chưa xác định");

export async function openBillPrint(bill: TableBill, storeName: string | null) {
  let qrCodeImage = "";
  if (bill.paymentMethod === "transfer") {
    try {
      const settings = await billPaymentService.getSettings();
      const amount = Math.round(Number(bill.totalAmount));
      if (amount > 0 && Number.isSafeInteger(amount) && (settings.tingeeVirtualAccount || (settings.bankId && settings.accountNumber && settings.accountName))) {
        qrCodeImage = (await billPaymentService.getQrFast({ billId: bill.id, amount, content: `Bill ${bill.tableName} ${bill.id}` }, settings)).qrCodeImage;
      }
    } catch {
      // Printing the bill should still work when QR generation is unavailable.
    }
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("title", "Bản in bill");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0";
  document.body.appendChild(frame);
  const printWindow = frame.contentWindow;
  const printDocument = frame.contentDocument;
  if (!printWindow || !printDocument) {
    frame.remove();
    return false;
  }
  const cashReceived = Number(bill.cashReceived || 0);
  const change = bill.paymentMethod === "cash" ? Math.max(0, cashReceived - bill.totalAmount) : 0;
  const rows = bill.items.map((item) => `<tr><td class="item"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.quantity)} ${escapeHtml(item.unitLabel || (item.billingUnit === "hour" ? "giờ" : "lần"))} × ${money(item.unitPrice)}</small>${item.billingUnit === "quantity" && item.startedAt ? `<small>Đặt lúc ${escapeHtml(formatVietnamDateTime(item.startedAt))}</small>` : ""}</td><td class="amount">${money(item.lineTotal)}</td></tr>`).join("");
  // XP-58 and compatible printers use 58mm paper with about 48mm of reliable print width.
  // shortcut: browsers may still show their print dialog; silent printing needs kiosk/native support.
  frame.onload = () => { printWindow.focus(); printWindow.print(); };
  printDocument.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bill ${escapeHtml(bill.id)}</title><style>@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,"DejaVu Sans",sans-serif;font-size:10px;line-height:1.35}.receipt{width:48mm;max-width:100%;margin:0 auto;padding:3mm 0;overflow-wrap:anywhere}.center{text-align:center}.center h1{font-size:15px;line-height:1.2;margin:0 0 3px}.muted{color:#444;font-size:.9em}.line{border-top:1px dashed #333;margin:7px 0}.meta{display:grid;grid-template-columns:auto 1fr;gap:2px 6px}.meta strong{min-width:0;text-align:right}.section-title{font-weight:700;margin:8px 0 4px}.items{width:100%;border-collapse:collapse;table-layout:fixed}.items th,.items td{padding:3px 0;vertical-align:top}.items th{text-align:left;border-bottom:1px dashed #333;font-size:.9em}.items th:last-child,.items td:last-child{text-align:right;width:25mm;white-space:nowrap}.item{padding-right:3px;word-break:break-word}.item strong,.item small{display:block}.item small{color:#444;font-size:.88em}.summary{display:grid;gap:3px}.summary-row{display:flex;justify-content:space-between;gap:8px}.summary-row span:first-child{min-width:0}.summary-row strong{white-space:nowrap;text-align:right}.total{font-size:12px;font-weight:700}.qr{text-align:center;margin-top:8px}.qr img{width:34mm;height:34mm;object-fit:contain}.footer{margin:10px 0 0;text-align:center;font-size:.9em}@media print{html,body{width:58mm}button{display:none}.receipt{break-inside:avoid}}</style></head><body><main class="receipt"><section class="center"><h1>${escapeHtml(storeName || "H2 Billiards")}</h1><div class="muted">HÓA ĐƠN THANH TOÁN</div></section><div class="line"></div><div class="meta"><span>Mã bill</span><strong>${escapeHtml(bill.id)}</strong><span>Bàn</span><strong>${escapeHtml(bill.tableName)}</strong><span>Thu ngân</span><strong>${escapeHtml(bill.paidByName || "Nhân viên cửa hàng")}</strong><span>Thời gian</span><strong>${escapeHtml(formatVietnamDateTime(bill.paidAt || bill.startedAt))}</strong></div><div class="section-title">Chi tiết</div><table class="items"><thead><tr><th>Mặt hàng</th><th>Thành tiền</th></tr></thead><tbody>${rows}</tbody></table><div class="line"></div><div class="summary"><div class="summary-row"><span>Tổng trước giảm</span><strong>${money(bill.grossAmount)}</strong></div><div class="summary-row"><span>Khuyến mại</span><strong>-${money(bill.discountAmount)}</strong></div>${bill.promotion ? `<div class="summary-row"><span>Ưu đãi</span><strong>${escapeHtml(bill.promotion.name)}</strong></div>` : ""}<div class="summary-row total"><span>TỔNG THANH TOÁN</span><strong>${money(bill.totalAmount)}</strong></div><div class="summary-row"><span>Phương thức</span><strong>${method(bill.paymentMethod)}</strong></div>${bill.paymentMethod === "cash" ? `<div class="summary-row"><span>Khách đưa</span><strong>${money(cashReceived)}</strong></div><div class="summary-row"><span>Tiền thối</span><strong>${money(change)}</strong></div>` : ""}</div>${qrCodeImage ? `<div class="qr"><img src="${escapeHtml(qrCodeImage)}" alt="Mã QR thanh toán"><div>Quét mã để thanh toán</div></div>` : ""}<p class="footer">Cảm ơn quý khách. Hẹn gặp lại!</p></main></body></html>`);
  printDocument.close();
  printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
  window.setTimeout(() => frame.remove(), 60_000);
  return true;
}

export function openSessionBillPrint(summary: TableBillSessionSummary, storeName: string | null) {
  const frame = document.createElement("iframe");
  frame.setAttribute("title", "Bản in tổng phiên bill");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0";
  document.body.appendChild(frame);
  const printWindow = frame.contentWindow;
  const printDocument = frame.contentDocument;
  if (!printWindow || !printDocument) { frame.remove(); return false; }
  const rows = summary.bills.map((item) => `<tr><td>${escapeHtml(item.tableName)}<small>Bill ${escapeHtml(item.id)} · ${escapeHtml(method(item.paymentMethod))}</small></td><td>${money(item.totalAmount)}</td></tr>`).join("");
  frame.onload = () => { printWindow.focus(); printWindow.print(); };
  printDocument.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tổng phiên bill</title><style>@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font:10px/1.35 Arial,"DejaVu Sans",sans-serif}.receipt{width:48mm;margin:auto;padding:3mm 0;overflow-wrap:anywhere}.center{text-align:center}.center h1{font-size:15px;margin:0 0 3px}.muted,small{color:#444;font-size:.9em}.line{border-top:1px dashed #333;margin:7px 0}.meta{display:flex;justify-content:space-between;gap:8px}.items{width:100%;border-collapse:collapse}.items td{padding:4px 0;vertical-align:top}.items td:last-child{text-align:right;white-space:nowrap}.items small{display:block}.total{display:flex;justify-content:space-between;font-size:12px;font-weight:700}</style></head><body><main class="receipt"><section class="center"><h1>${escapeHtml(storeName || "H2 Billiards")}</h1><div class="muted">TỔNG PHIÊN BILL</div></section><div class="line"></div><div class="meta"><span>Mã phiên</span><strong>${escapeHtml(summary.sessionId)}</strong></div><div class="line"></div><table class="items"><tbody>${rows}</tbody></table><div class="line"></div><div class="total"><span>TỔNG CỘNG</span><strong>${money(summary.totalAmount)}</strong></div><div class="meta" style="margin-top:5px"><span>Còn phải trả</span><strong>${money(summary.outstandingAmount)}</strong></div><p class="muted" style="text-align:center;margin-top:10px">Cảm ơn quý khách. Hẹn gặp lại!</p></main></body></html>`);
  printDocument.close();
  printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
  window.setTimeout(() => frame.remove(), 60_000);
  return true;
}
