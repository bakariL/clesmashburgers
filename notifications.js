// Notification service — every customer/team message the app sends lives
// here (order + catering confirmations, and the catering booking email to
// the team). server.js just calls these functions; delivery details
// (Twilio, Resend, retries, recipients) stay in this module and notify.js.
//
// Every function here NEVER throws: a failed email must not break a
// customer's checkout.

const notify = require("./notify");


const CATERING_NOTIFY_DEFAULT = ["operations@clesmashburgers.com", "bakarilewis@gmail.com"];

function cateringRecipients() {
  const raw = process.env.CATERING_NOTIFY_EMAILS;
  const list = raw ? raw.split(",").map((e) => e.trim()).filter(Boolean) : CATERING_NOTIFY_DEFAULT;
  return list.length ? list : CATERING_NOTIFY_DEFAULT;
}

function itemsHtml(items, sides) {
  const sideLis = (sides || []).map((s) => `<li><strong>${esc(s.qty)}× ${esc(s.name)}</strong></li>`).join("");
  return (items || [])
    .map((i) => {
      const extras = [i.comboQty ? `${i.comboQty} as combo (+fries & drink)` : "", i.friesQty ? `${i.friesQty} with fries only` : "", i.dessertQty ? `${i.dessertQty} with dessert` : ""].filter(Boolean).join(", ");
      return `<li><strong>${esc(i.qty)}× ${esc(i.name)}</strong>${extras ? ` — ${esc(extras)}` : ""}${i.notes ? `<br><em>Special request: ${esc(i.notes)}</em>` : ""}</li>`;
    })
    .join("") + sideLis;
}

function itemsText(items, sides) {
  return [...(items || []), ...(sides || [])].map((i) => `${i.qty}x ${i.name}`).join(", ");
}

function fmtPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || "");
}

function fmtTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t || "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Retries transient failures (network blips, 5xx) up to 3 attempts total.
async function withRetry(label, fn) {
  const delays = [0, 1000, 3000];
  let last;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const result = await fn();
      if (!result || !result.error) return result;
      last = result;
    } catch (e) {
      last = { error: e.message };
    }
    console.error(`[notify] ${label} attempt ${i + 1} failed: ${last.error}`);
  }
  console.error(`[notify] ${label} gave up after ${delays.length} attempts.`);
  return last;
}

// Full booking form -> operations + owner.
async function sendCateringTeamNotification(r) {
  const row = (k, v) => `<tr><td style="padding:6px 12px;font-weight:bold;vertical-align:top">${k}</td><td style="padding:6px 12px">${esc(v) || "—"}</td></tr>`;
  const html = `<h2>New catering booking — ${esc(r.ref)}</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:15px">
<tr><td style="padding:6px 12px;font-weight:bold;vertical-align:top">Order</td><td style="padding:6px 12px"><ul style="margin:0;padding-left:18px">${itemsHtml(r.items, r.sides)}</ul></td></tr>
${row("Event title", r.eventTitle)}
${row("Event date", r.eventDate)}
${row("Requested drop off time", fmtTime(r.eventTime))}
${row("Event type", r.eventType)}
${row("Event address", r.eventAddress)}
${row("Notes", r.notes)}
${row("Organizer", r.contact.name)}
${row("Contact email", r.contact.email)}
${row("Contact phone", fmtPhone(r.contact.phone))}
${row("Subtotal", "$" + Number(r.subtotal).toFixed(2))}
${row("Tax", "$" + Number(r.tax || 0).toFixed(2))}
${row("Estimated total (before tax)", "$" + Number(r.total).toFixed(2))}
${row("Reference", r.ref)}
</table>`;
  return withRetry(`catering ${r.ref} team email`, () =>
    notify.sendEmail(cateringRecipients(), `New catering booking ${r.ref} — ${r.eventDate} (${(r.items || []).reduce((n, i) => n + i.qty, 0)} sandwiches)`, html, { replyTo: r.contact && r.contact.email })
  );
}

// Customer confirmation + team notification.
// Returns { customerEmail: "sent" | "not sent (email not configured)" | "failed: <why>" } so the
// dashboard can show whether the customer's confirmation went out.
async function sendCateringConfirmation(request) {
  // Team notification runs alongside the customer's messages, never blocking them.
  const teamDone = sendCateringTeamNotification(request);

  const msg = `Your catering order (${itemsText(request.items, request.sides)}) is booked for ${request.eventDate} at ${request.eventAddress}${request.eventTime ? ` (requested drop off: ${fmtTime(request.eventTime)})` : ""}. Estimated total: $${request.total.toFixed(2)} + tax. Someone will contact you in 24hrs.`;
  const emailResult = await withRetry(`catering ${request.ref} customer email`, () =>
    notify.sendEmail(
      request.contact.email,
      `Booking confirmed — Cleveland Smash Burgers Catering`,
      `<h2>You're booked, ${esc(request.contact.firstName || request.contact.name)}!</h2><p>Your catering order is booked for <strong>${esc(request.eventDate)}</strong> — ${esc(request.eventTitle)} — at ${esc(request.eventAddress)}.</p>${request.eventTime ? `<p>Requested drop off time: <strong>${esc(fmtTime(request.eventTime))}</strong></p>` : ""}<p>Your order:</p><ul>${itemsHtml(request.items, request.sides)}</ul><p>Estimated total: $${request.total.toFixed(2)} (plus tax). Someone will contact you in 24hrs.</p><p>You paid $0 today — there's no cost to book.</p><p>Reference: <strong>${esc(request.ref)}</strong></p><p>Questions? Reply to this email or call (216) 971-1884.</p>`,
      { replyTo: cateringRecipients()[0] }
    )
  );
  const customerEmail = !emailResult ? "failed" : emailResult.error ? `failed: ${emailResult.error}` : emailResult.simulated ? "not sent (email not configured)" : "sent";
  if (request.contact.phone) {
    await withRetry(`catering ${request.ref} SMS`, () =>
      notify.sendSMS("+1" + String(request.contact.phone).replace(/\D/g, "").slice(-10), `Cleveland Smash Burgers: booking ${request.ref} confirmed. ${msg}`)
    );
  }
  await teamDone;
  return { customerEmail };
}

// Free-form email from the admin dashboard to the booking's contact.
// Plain text in, simple HTML out; replies go to the ops inbox.
async function sendCustomerEmail(booking, subject, message) {
  const html = `<div style="font-family:sans-serif;font-size:15px;line-height:1.5">${esc(message).replace(/\n/g, "<br>")}<hr style="margin-top:24px;border:none;border-top:1px solid #ddd"><p style="color:#666;font-size:13px">Cleveland Smash Burgers · Catering reference ${esc(booking.ref)}</p></div>`;
  const replyTo = process.env.ADMIN_REPLY_TO || cateringRecipients()[0];
  try {
    return await notify.sendEmail(booking.contact.email, subject, html, { replyTo });
  } catch (e) {
    return { error: e.message };
  }
}

const money2 = (n) => `$${Number(n || 0).toFixed(2)}`;

function longDateStr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

// Emails an invoice to the customer. Never throws — returns the notify result.
async function sendInvoiceEmail(inv) {
  const payInfo = process.env.INVOICE_PAYMENT_INSTRUCTIONS || "To pay, reply to this email or call (216) 971-1884.";
  const rows = (inv.items || []).map((i) => `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(i.description)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${esc(i.qty)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${money2(i.unitPrice)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${money2(i.amount)}</td></tr>`).join("");
  const totalRow = (label, val, bold) => `<tr><td colspan="3" style="padding:6px 10px;text-align:right;${bold ? "font-weight:bold;font-size:16px" : ""}">${label}</td><td style="padding:6px 10px;text-align:right;${bold ? "font-weight:bold;font-size:16px" : ""}">${val}</td></tr>`;
  const html = `<div style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:640px">
  <h2 style="margin:0 0 2px">Cleveland Smash Burgers</h2>
  <div style="color:#666;font-size:13px">3915 Carnegie Ave, Cleveland, OH 44115 · (216) 971-1884</div>
  <h3 style="margin:24px 0 4px">Invoice ${esc(inv.number)}</h3>
  <div style="color:#444;font-size:14px">Billed to: <strong>${esc(inv.customerName)}</strong> (${esc(inv.customerEmail)})<br>
  Issued: ${esc(longDateStr(inv.issueDate))}${inv.dueDate ? `<br>Due: <strong>${esc(longDateStr(inv.dueDate))}</strong>` : ""}${inv.bookingRef ? `<br>Catering reference: ${esc(inv.bookingRef)}` : ""}</div>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
    <thead><tr style="background:#f4f4f4"><th style="padding:8px 10px;text-align:left">Description</th><th style="padding:8px 10px;text-align:right">Qty</th><th style="padding:8px 10px;text-align:right">Price</th><th style="padding:8px 10px;text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>${totalRow("Subtotal", money2(inv.subtotal))}${inv.taxRate ? totalRow(`Tax (${esc(inv.taxRate)}%)`, money2(inv.tax)) : ""}${totalRow("Total due", money2(inv.total), true)}</tfoot>
  </table>
  ${inv.notes ? `<p style="margin-top:16px"><strong>Notes</strong><br>${esc(inv.notes).replace(/\n/g, "<br>")}</p>` : ""}
  <p style="margin-top:20px">${esc(payInfo)}</p>
  <p style="color:#666;font-size:13px">Thank you for choosing Cleveland Smash Burgers!</p></div>`;
  const replyTo = process.env.ADMIN_REPLY_TO || cateringRecipients()[0];
  try {
    return await notify.sendEmail(inv.customerEmail, `Invoice ${inv.number} from Cleveland Smash Burgers — ${money2(inv.total)}`, html, { replyTo });
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { sendInvoiceEmail, sendCustomerEmail, sendCateringConfirmation, sendCateringTeamNotification, cateringRecipients };
