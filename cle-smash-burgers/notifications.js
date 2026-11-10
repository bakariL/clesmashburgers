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

function itemsHtml(items) {
  return (items || [])
    .map((i) => {
      const extras = [i.comboQty ? `${i.comboQty} as combo (+fries & drink)` : "", i.dessertQty ? `${i.dessertQty} with dessert` : ""].filter(Boolean).join(", ");
      return `<li><strong>${esc(i.qty)}× ${esc(i.name)}</strong>${extras ? ` — ${esc(extras)}` : ""}${i.notes ? `<br><em>Special request: ${esc(i.notes)}</em>` : ""}</li>`;
    })
    .join("");
}

function itemsText(items) {
  return (items || []).map((i) => `${i.qty}x ${i.name}`).join(", ");
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
<tr><td style="padding:6px 12px;font-weight:bold;vertical-align:top">Order</td><td style="padding:6px 12px"><ul style="margin:0;padding-left:18px">${itemsHtml(r.items)}</ul></td></tr>
${row("Event date", r.eventDate)}
${row("Event type", r.eventType)}
${row("Event address", r.eventAddress)}
${row("Budget", r.budgetNote)}
${row("Notes", r.notes)}
${row("Contact name", r.contact.name)}
${row("Contact email", r.contact.email)}
${row("Contact phone", r.contact.phone)}
${row("Subtotal", "$" + Number(r.subtotal).toFixed(2))}
${row("Tax", "$" + Number(r.tax || 0).toFixed(2))}
${row("Total paid", "$" + Number(r.total).toFixed(2))}
${row("Reference", r.ref)}
</table>`;
  return withRetry(`catering ${r.ref} team email`, () =>
    notify.sendEmail(cateringRecipients(), `New catering booking ${r.ref} — ${r.eventDate} (${(r.items || []).reduce((n, i) => n + i.qty, 0)} sandwiches)`, html)
  );
}

// Sent the moment the customer hits "Book & Pay", before payment completes.
// Goes to whatever address they typed in the email field.
async function sendCateringStarted(r) {
  return withRetry(`catering ${r.ref} started email`, () =>
    notify.sendEmail(
      r.contact.email,
      `We got your catering request — Cleveland Smash Burgers`,
      `<h2>Thanks, ${esc(r.contact.name)}!</h2><p>We received your catering request for <strong>${esc(r.eventDate)}</strong>:</p><ul>${itemsHtml(r.items)}</ul><p>Your date is held once payment is complete — you'll get a booking confirmation right after you pay.</p><p>Reference: <strong>${esc(r.ref)}</strong></p>`
    )
  );
}

// Customer confirmation + team notification.
async function sendCateringConfirmation(request) {
  await sendCateringTeamNotification(request);

  const msg = `Your catering order (${itemsText(request.items)}) is booked for ${request.eventDate} at ${request.eventAddress}. Total: $${request.total.toFixed(2)}.`;
  await withRetry(`catering ${request.ref} customer email`, () =>
    notify.sendEmail(
      request.contact.email,
      `Booking confirmed — Cleveland Smash Burgers Catering`,
      `<h2>You're booked, ${esc(request.contact.name)}!</h2><p>Your catering order is booked for <strong>${esc(request.eventDate)}</strong> at ${esc(request.eventAddress)}:</p><ul>${itemsHtml(request.items)}</ul><p>Total: $${request.total.toFixed(2)}</p><p>Reference: <strong>${esc(request.ref)}</strong></p><p>Questions? Reply to this email or call (216) 555-0142.</p>`
    )
  );
  if (request.contact.phone) {
    await withRetry(`catering ${request.ref} SMS`, () =>
      notify.sendSMS(request.contact.phone, `Cleveland Smash Burgers: booking ${request.ref} confirmed. ${msg}`)
    );
  }
}

module.exports = { sendCateringConfirmation, sendCateringStarted, sendCateringTeamNotification, cateringRecipients };
