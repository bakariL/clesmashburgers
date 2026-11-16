// Finance + sales analytics for the admin dashboard. Pure function: give it
// the bookings, invoices and menu, get back one JSON object. Nothing here
// writes anything.
//
// What counts as "money collected":
//   • every invoice marked PAID (its total), and
//   • every catering booking marked PAID that has no paid invoice of its own
//     (its booking total) — so an event with a paid invoice is never counted twice.
// Months/days are bucketed in Cleveland time (America/New_York).

const TZ = "America/New_York";
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const ymd = (d) => dayFmt.format(new Date(d));
const ym = (d) => ymd(d).slice(0, 7);
const dayNum = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

function bookingLines(b, menu) {
  const lines = [];
  const combo = (menu.comboUpgrade || {}).price ?? 5;
  const fries = (menu.friesUpgrade || {}).price ?? 3.5;
  const dessert = (menu.dessertAddOn || {}).price ?? 5;
  for (const i of b.items || []) {
    lines.push({ description: i.name, qty: i.qty, amount: r2(i.price * i.qty) });
    if (i.comboQty) lines.push({ description: `${i.name} — combo upgrade`, qty: i.comboQty, amount: r2(combo * i.comboQty) });
    if (i.friesQty) lines.push({ description: `${i.name} — fries only`, qty: i.friesQty, amount: r2(fries * i.friesQty) });
    if (i.dessertQty) lines.push({ description: `${i.name} — dessert`, qty: i.dessertQty, amount: r2(dessert * i.dessertQty) });
  }
  for (const s of b.sides || []) lines.push({ description: s.name, qty: s.qty, amount: r2(s.price * s.qty) });
  return lines;
}

function compute(bookings, invoices, menu, now = new Date()) {
  menu = menu || {};
  const today = ymd(now);
  const thisMonth = today.slice(0, 7);
  const bookingByRef = new Map(bookings.map((b) => [b.ref, b]));
  const live = bookings.filter((b) => b.status !== "canceled");

  // ---- collected-money records ----
  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const invoicedRefs = new Set(paidInvoices.filter((i) => i.bookingRef).map((i) => i.bookingRef));
  const records = [];
  for (const inv of paidInvoices) {
    const b = inv.bookingRef ? bookingByRef.get(inv.bookingRef) : null;
    records.push({
      type: "invoice", id: inv.number, date: inv.paidAt || inv.updatedAt || inv.createdAt,
      customer: inv.customerName, email: inv.customerEmail, amount: r2(inv.total), tax: r2(inv.tax),
      bookingRef: inv.bookingRef || "", eventType: b ? b.eventType : "",
      lines: (inv.items || []).map((i) => ({ description: i.description, qty: i.qty, amount: r2(i.amount) })),
    });
  }
  for (const b of bookings) {
    if (b.status !== "paid" || invoicedRefs.has(b.ref)) continue;
    records.push({
      type: "booking", id: b.ref, date: b.paidAt || b.updatedAt || b.createdAt,
      customer: b.contact.name, email: b.contact.email, amount: r2(b.total), tax: r2(b.tax),
      bookingRef: b.ref, eventType: b.eventType, lines: bookingLines(b, menu),
    });
  }
  records.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const sum = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));
  const lastMonthKey = (() => { const [y, m] = thisMonth.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();

  // ---- monthly revenue (last 12 months, zero-filled) ----
  const months = [];
  { let [y, m] = thisMonth.split("-").map(Number);
    for (let k = 0; k < 12; k++) { months.unshift(`${y}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; y--; } } }
  const monthly = months.map((key) => {
    const rs = records.filter((r) => ym(r.date) === key);
    return { month: key, collected: sum(rs, (r) => r.amount), count: rs.length, avgOrder: rs.length ? r2(sum(rs, (r) => r.amount) / rs.length) : 0 };
  });
  const byMonth = Object.fromEntries(records.reduce((m, r) => { const k = ym(r.date); m.set(k, r2((m.get(k) || 0) + r.amount)); return m; }, new Map()));
  const bestKey = Object.keys(byMonth).sort((a, b) => byMonth[b] - byMonth[a])[0];

  const collectedAll = sum(records, (r) => r.amount);
  const thisM = r2(byMonth[thisMonth] || 0), lastM = r2(byMonth[lastMonthKey] || 0);

  // ---- who owes us ----
  const sentInvoices = invoices.filter((i) => i.status === "sent");
  const overdue = sentInvoices.filter((i) => i.dueDate && i.dueDate < today);
  const draftInvoices = invoices.filter((i) => i.status === "draft");
  const collectedFor = (b) => {
    if (b.status === "paid") return b.total;
    const paid = paidInvoices.filter((i) => i.bookingRef === b.ref);
    return paid.length ? sum(paid, (i) => i.total) : 0;
  };
  const unpaidBookings = live.filter((b) => b.status !== "paid").map((b) => ({ b, owed: r2(Math.max(0, b.total - collectedFor(b))) })).filter((x) => x.owed > 0);
  const completedUnpaid = unpaidBookings.filter((x) => x.b.status === "completed");
  const in30 = dayNum(today) + 30;
  const upcoming = live.filter((b) => b.eventDate >= today && dayNum(b.eventDate) <= in30);

  // ---- what sells ----
  const itemMap = new Map();
  for (const r of records) for (const l of r.lines) {
    const cur = itemMap.get(l.description) || { description: l.description, qty: 0, revenue: 0 };
    cur.qty += Number(l.qty) || 0; cur.revenue = r2(cur.revenue + l.amount);
    itemMap.set(l.description, cur);
  }
  const topItems = [...itemMap.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 12);
  const sandwichMap = new Map();
  for (const b of live) for (const i of b.items || []) sandwichMap.set(i.name, (sandwichMap.get(i.name) || 0) + i.qty);
  const sandwichDemand = [...sandwichMap.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
  const totalSandwiches = live.reduce((n, b) => n + (b.items || []).reduce((s, i) => s + i.qty, 0), 0);
  const rate = (key) => totalSandwiches ? r2(live.reduce((n, b) => n + (b.items || []).reduce((s, i) => s + (i[key] || 0), 0), 0) / totalSandwiches * 100) : 0;

  // ---- customers & events ----
  const custMap = new Map();
  for (const b of live) {
    const k = String(b.contact.email).toLowerCase();
    const c = custMap.get(k) || { name: b.contact.name, email: b.contact.email, bookings: 0, collected: 0 };
    c.bookings++; custMap.set(k, c);
  }
  for (const r of records) {
    const k = String(r.email).toLowerCase();
    const c = custMap.get(k) || { name: r.customer, email: r.email, bookings: 0, collected: 0 };
    c.collected = r2(c.collected + r.amount); custMap.set(k, c);
  }
  const customers = [...custMap.values()];
  const typeMap = new Map();
  for (const b of live) { const t = b.eventType || "not specified"; const c = typeMap.get(t) || { type: t, bookings: 0, collected: 0 }; c.bookings++; typeMap.set(t, c); }
  for (const r of records) { const t = r.eventType || "not specified"; const c = typeMap.get(t) || { type: t, bookings: 0, collected: 0 }; c.collected = r2(c.collected + r.amount); typeMap.set(t, c); }
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const wd = new Array(7).fill(0);
  for (const b of live) wd[new Date(b.eventDate + "T12:00:00Z").getUTCDay()]++;
  const leads = live.filter((b) => b.createdAt && b.eventDate).map((b) => dayNum(b.eventDate) - dayNum(ymd(b.createdAt)));

  return {
    generatedAt: now.toISOString(),
    totals: {
      collectedAll, thisMonth: thisM, lastMonth: lastM,
      monthOverMonthPct: lastM > 0 ? r2((thisM - lastM) / lastM * 100) : null,
      ytd: sum(records.filter((r) => ymd(r.date).slice(0, 4) === today.slice(0, 4)), (r) => r.amount),
      paidCount: records.length, avgOrder: records.length ? r2(collectedAll / records.length) : 0,
      taxCollected: sum(records, (r) => r.tax),
      bestMonth: bestKey ? { month: bestKey, collected: byMonth[bestKey] } : null,
    },
    monthly,
    receivables: {
      invoicesAwaiting: { count: sentInvoices.length, amount: sum(sentInvoices, (i) => i.total) },
      invoicesOverdue: { count: overdue.length, amount: sum(overdue, (i) => i.total) },
      invoiceDrafts: { count: draftInvoices.length, amount: sum(draftInvoices, (i) => i.total) },
      bookingsUnpaid: { count: unpaidBookings.length, amount: sum(unpaidBookings, (x) => x.owed) },
      completedUnpaid: { count: completedUnpaid.length, amount: sum(completedUnpaid, (x) => x.owed) },
      next30Days: { count: upcoming.length, amount: sum(upcoming, (b) => b.total) },
    },
    items: { top: topItems, sandwichDemand, attachRates: { combo: rate("comboQty"), friesOnly: rate("friesQty"), dessert: rate("dessertQty") } },
    health: {
      bookingsTotal: bookings.length, canceled: bookings.length - live.length,
      cancelRatePct: bookings.length ? r2((bookings.length - live.length) / bookings.length * 100) : 0,
      avgSandwichesPerBooking: live.length ? r2(totalSandwiches / live.length) : 0,
      avgBookingValue: live.length ? r2(sum(live, (b) => b.total) / live.length) : 0,
      avgLeadDays: leads.length ? r2(leads.reduce((a, b) => a + b, 0) / leads.length) : null,
      repeatCustomerPct: customers.filter((c) => c.bookings > 0).length ? r2(customers.filter((c) => c.bookings > 1).length / customers.filter((c) => c.bookings > 0).length * 100) : 0,
      busiestWeekday: Math.max(...wd) > 0 ? weekdays[wd.indexOf(Math.max(...wd))] : null,
      lostToCancellations: sum(bookings.filter((b) => b.status === "canceled"), (b) => b.total),
    },
    topCustomers: customers.filter((c) => c.collected > 0).sort((a, b) => b.collected - a.collected).slice(0, 5),
    eventTypes: [...typeMap.values()].sort((a, b) => b.collected - a.collected || b.bookings - a.bookings),
    records: records.map(({ lines, ...r }) => ({ ...r, items: lines.map((l) => `${l.qty}× ${l.description}`).join("; ") })),
  };
}

module.exports = { compute, bookingLines, ymd };
