// Cleveland Smash Burgers — server
// Still zero npm dependencies: `node server.js` is all you need, even with
// payments/SMS/email wired in — those talk to Stripe/Twilio/Resend over
// plain REST calls (fetch), not their SDKs.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { loadEnv } = require("./env");
loadEnv();

const db = require("./db");
const payments = require("./payments");
const notify = require("./notify");
const notifications = require("./notifications");
const clover = require("./clover");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Short, friendly reference codes like "CSB-4Q7K"
function makeRefCode(prefix) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return `${prefix}-${code}`;
}

// Catering menu — customers pick a quantity of each sandwich, and can
// upgrade any of them to a combo (+$5, adds fries and a drink) or add a
// dessert (+$5). Sandwiches take a special-request note.
const CATERING_MENU = {
  sandwiches: [
    { id: "cleveland-classic", name: "The Cleveland Classic", price: 10 },
    { id: "jive-turkey", name: "The Jive Turkey", price: 10 },
    { id: "q-dawg", name: "The Q Dawg", price: 8 },
  ],
  comboUpgrade: { price: 5, description: "Adds fries and a drink" },
  dessertAddOn: { price: 5, description: "Add a dessert" },
};

const CATERING_STATUSES = ["pending_payment", "booked", "in_progress", "completed", "canceled"];


// Our 3 storefronts — fixed locations, not a rotating pop-up schedule.
const LOCATIONS = [
  {
    id: "parma",
    name: "Parma",
    address: "6164 Broadview Rd, Parma, OH 44134",
    hours: "12:00 PM – 9:30 PM daily",
    phone: "(216) 555-0142",
  },
  {
    id: "cleveland",
    name: "Cleveland",
    address: "3915 Carnegie Ave, Cleveland, OH 44115",
    hours: "12:00 PM – 9:30 PM daily",
    phone: "(216) 555-0142",
  },
  {
    id: "garfield-heights",
    name: "Garfield Heights",
    address: "4545 E. 131st St, Garfield Heights, OH 44105",
    hours: "12:00 PM – 9:30 PM daily",
    phone: "(216) 555-0142",
  },
];

function kitchenAuthorized(req) {
  const configured = process.env.KITCHEN_PASSWORD;
  if (!configured) return true; // dev mode — no passcode set
  return req.headers["x-kitchen-passcode"] === configured;
}

const STRIPE_KEY_MISSING = { error: "Online payment isn't available right now. Please call the shop to order." };

// Validates the customer's catering selection against CATERING_MENU and
// prices it on the server (never trust prices from the browser). Returns
// { error } or { items, subtotal, sandwichCount, stripeLines }.
function buildCateringOrder(rawItems) {
  if (!Array.isArray(rawItems)) return { error: "Choose at least one sandwich." };
  const whole = (n) => (Number.isInteger(Number(n)) && Number(n) >= 0 ? Number(n) : NaN);
  const items = [];
  const stripeLines = [];
  let subtotal = 0;
  let sandwichCount = 0;

  for (const raw of rawItems) {
    const m = CATERING_MENU.sandwiches.find((x) => x.id === raw.id);
    if (!m) return { error: "One of the items you picked isn't on our menu." };
    const qty = whole(raw.qty);
    const comboQty = whole(raw.comboQty || 0);
    const dessertQty = whole(raw.dessertQty || 0);
    if ([qty, comboQty, dessertQty].some(Number.isNaN)) return { error: "Quantities must be whole numbers." };
    if (qty === 0) continue;
    if (qty > 500) return { error: "For orders that large, please call us." };
    if (comboQty > qty) return { error: `You can't have more combos than ${m.name} sandwiches.` };
    if (dessertQty > qty) return { error: `You can't have more desserts than ${m.name} sandwiches.` };

    items.push({ id: m.id, name: m.name, price: m.price, qty, comboQty, dessertQty, notes: String(raw.notes || "").trim().slice(0, 300) });
    sandwichCount += qty;
    subtotal += m.price * qty;
    stripeLines.push({ name: m.name, unitAmountCents: Math.round(m.price * 100), quantity: qty });
    if (comboQty) {
      subtotal += CATERING_MENU.comboUpgrade.price * comboQty;
      stripeLines.push({ name: `Combo upgrade (fries + drink) — ${m.name}`, unitAmountCents: Math.round(CATERING_MENU.comboUpgrade.price * 100), quantity: comboQty });
    }
    if (dessertQty) {
      subtotal += CATERING_MENU.dessertAddOn.price * dessertQty;
      stripeLines.push({ name: `Dessert add-on — ${m.name}`, unitAmountCents: Math.round(CATERING_MENU.dessertAddOn.price * 100), quantity: dessertQty });
    }
  }

  if (items.length === 0) return { error: "Choose at least one sandwich." };
  return { items, subtotal: Math.round(subtotal * 100) / 100, sandwichCount, stripeLines };
}

// Same idea for a catering booking — one summary line item for the whole
// booking (not one per guest) since a caterer needs "prep 40 Office
// Lunch," not 40 duplicate ticket lines.
async function pushCateringToClover(booking) {
  if (!clover.isCloverConfigured()) return false;
  try {
    const lineItems = booking.items.map((i) => ({
      name: `${i.name}${i.comboQty ? ` (${i.comboQty} combo)` : ""}${i.dessertQty ? ` (${i.dessertQty} dessert)` : ""}${i.notes ? ` — NOTE: ${i.notes}` : ""}`,
      priceCents: Math.round((i.price * i.qty + 5 * i.comboQty + 5 * i.dessertQty) * 100),
    }));
    if (booking.tax > 0) lineItems.push({ name: "Tax", priceCents: Math.round(booking.tax * 100) });

    const note = [
      `Catering ${booking.ref}`,
      booking.contact.name,
      booking.contact.phone,
      `${booking.eventDate} at ${booking.eventAddress}`,
      booking.notes || "",
    ].filter(Boolean).join(" · ");

    await clover.pushOrder({ lineItems, note });
    return true;
  } catch (e) {
    console.error(`Clover push failed for catering ${booking.ref}:`, e.message);
    return false;
  }
}

// We only do one catering event per day. A date is unavailable if either
// a non-canceled booking already has it, or staff manually blocked it
// (closed, already promised verbally, prepping for something else, etc.).
async function isDateAvailable(date, { ignoreRef } = {}) {
  const [bookings, blocked] = await Promise.all([db.getCateringRequests(), db.getBlockedDates()]);
  const bookingConflict = bookings.some(
    (b) => b.eventDate === date && b.status !== "canceled" && b.ref !== ignoreRef
  );
  const manuallyBlocked = blocked.some((b) => b.date === date);
  return !bookingConflict && !manuallyBlocked;
}

// Public version: just which dates are taken, no customer details — this
// is called by anyone visiting the booking page, unauthenticated.
async function getPublicCateringCalendar() {
  const [bookings, blocked] = await Promise.all([db.getCateringRequests(), db.getBlockedDates()]);
  const bookedDates = bookings.filter((b) => b.status !== "canceled").map((b) => b.eventDate);
  const blockedDates = blocked.map((b) => b.date);
  return { bookedDates, blockedDates };
}

// Kitchen-board version: full detail (who/ref/reason), kitchen-auth only.
async function getStaffCateringCalendar() {
  const [bookings, blocked] = await Promise.all([db.getCateringRequests(), db.getBlockedDates()]);
  const booked = bookings
    .filter((b) => b.status !== "canceled")
    .map((b) => ({ date: b.eventDate, ref: b.ref, name: b.contact.name, status: b.status }));
  return { booked, blocked };
}

function get(req) {
  return new URL(req.url, `http://${req.headers.host}`);
}

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

const server = http.createServer(async (req, res) => {
  const url = get(req);
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ['api','orders','CSB-4Q7K']

  // ---- Clover: status (kitchen — lets the board know whether to show sync info) ----
  if (url.pathname === "/api/clover/status" && req.method === "GET") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    return sendJSON(res, 200, { enabled: clover.isCloverConfigured() });
  }

  // ---- Stripe: public config (publishable key is safe to expose) ----
  if (url.pathname === "/api/stripe-config" && req.method === "GET") {
    return sendJSON(res, 200, {
      enabled: payments.isStripeConfigured(),
      publishableKey: payments.getPublishableKey(),
    });
  }

  // ---- Kitchen auth ----
  if (url.pathname === "/api/kitchen/login" && req.method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const configured = process.env.KITCHEN_PASSWORD;
    if (!configured) return sendJSON(res, 200, { ok: true, open: true });
    if (body.passcode === configured) return sendJSON(res, 200, { ok: true, open: false });
    return sendJSON(res, 401, { ok: false, open: false, error: "Incorrect passcode." });
  }

  // ---- Catering: menu (public) ----
  if (url.pathname === "/api/catering/menu" && req.method === "GET") {
    return sendJSON(res, 200, CATERING_MENU);
  }

  // ---- Catering: calendar — which dates are taken (public, read-only, no customer details) ----
  if (url.pathname === "/api/catering/calendar" && req.method === "GET") {
    return sendJSON(res, 200, await getPublicCateringCalendar());
  }

  // ---- Catering: calendar — full detail for staff (kitchen-auth) ----
  if (url.pathname === "/api/catering/calendar/staff" && req.method === "GET") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    return sendJSON(res, 200, await getStaffCateringCalendar());
  }

  // ---- Catering: manually block a date (kitchen-auth) ----
  if (url.pathname === "/api/catering/calendar/block" && req.method === "POST") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const body = await readBody(req).catch(() => ({}));
    if (!body.date) return sendJSON(res, 400, { error: "A date is required." });
    const entry = await db.blockDate(body.date, body.reason || "");
    return sendJSON(res, 200, { blocked: entry });
  }

  // ---- Catering: unblock a manually-blocked date (kitchen-auth) ----
  if (url.pathname === "/api/catering/calendar/unblock" && req.method === "POST") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const body = await readBody(req).catch(() => ({}));
    if (!body.date) return sendJSON(res, 400, { error: "A date is required." });
    const removed = await db.unblockDate(body.date);
    return sendJSON(res, 200, { removed });
  }

  // ---- Catering: book + pay ----
  if (url.pathname === "/api/catering" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { eventDate, eventType, eventAddress, budgetNote, notes, contact } = body;

      const built = buildCateringOrder(body.items);
      if (built.error) return sendJSON(res, 400, { error: built.error });

      if (!eventDate) return sendJSON(res, 400, { error: "Event date is required." });
      if (!(await isDateAvailable(eventDate))) {
        return sendJSON(res, 409, { error: "That date is already booked — please choose another." });
      }
      if (payments.isStripeConfigured() && !payments.getPublishableKey()) {
        console.error("Booking blocked: STRIPE_SECRET_KEY is set but STRIPE_PUBLISHABLE_KEY is missing.");
        return sendJSON(res, 503, STRIPE_KEY_MISSING);
      }
      if (!eventAddress) return sendJSON(res, 400, { error: "Event address is required." });
      if (!contact || !contact.name || !contact.email || !contact.phone) {
        return sendJSON(res, 400, { error: "Name, email, and phone are required." });
      }

      const stripeOn = payments.isStripeConfigured();
      const subtotal = built.subtotal; // pre-checkout estimate; verify-payment overwrites with Stripe's real total+tax

      const booking = {
        ref: makeRefCode("CATER"),
        items: built.items,
        guestCount: built.sandwichCount,
        subtotal,
        tax: 0,
        total: subtotal,
        eventDate,
        eventType: eventType || "not specified",
        eventAddress,
        budgetNote: String(budgetNote || "").slice(0, 300),
        notes: String(notes || "").slice(0, 1000),
        contact,
        status: stripeOn ? "pending_payment" : "booked",
        paid: !stripeOn,
        createdAt: new Date().toISOString(),
      };

      await db.createCateringRequest(booking);

      // Email the address they typed right away ("Book & Pay" was hit) —
      // not awaited so it never slows the checkout; never throws.
      if (stripeOn) notifications.sendCateringStarted(booking);

      if (!stripeOn) {
        await notifications.sendCateringConfirmation(booking);
        const synced = await pushCateringToClover(booking);
        const finalBooking = await db.updateCateringRequest(booking.ref, { cloverSynced: synced });
        return sendJSON(res, 201, { request: finalBooking || booking });
      }

      try {
        const origin = requestOrigin(req);
        const session = await payments.createCheckoutSession({
          lineItems: built.stripeLines.map((l) => ({ ...l, taxCode: payments.FOOD_TAX_CODE })),
          returnUrl: `${origin}/#/catering-confirmed?ref=${booking.ref}&session_id={CHECKOUT_SESSION_ID}`,
          customerEmail: contact.email,
          metadata: { catering_ref: booking.ref },
        });
        await db.updateCateringRequest(booking.ref, { stripeSessionId: session.id });
        return sendJSON(res, 201, { request: booking, clientSecret: session.client_secret });
      } catch (e) {
        console.error("Stripe checkout session failed:", e.message);
        await db.updateCateringRequest(booking.ref, { status: "canceled", paid: false, paymentNote: "Stripe error: " + e.message });
        return sendJSON(res, 502, { error: "We couldn't start payment right now. Please try again in a minute or call the shop. You were not charged." });
      }
    } catch (e) {
      return sendJSON(res, 400, { error: "Couldn't read that booking. " + e.message });
    }
  }

  // ---- Catering: verify payment after Stripe redirect ----
  if (parts[0] === "api" && parts[1] === "catering" && parts[3] === "verify-payment" && req.method === "GET") {
    const ref = decodeURIComponent(parts[2]);
    const sessionId = url.searchParams.get("session_id");
    const booking = await db.getCateringRequest(ref);
    if (!booking) return sendJSON(res, 404, { error: "Booking not found." });
    if (booking.paid) return sendJSON(res, 200, { request: booking });
    if (!sessionId) return sendJSON(res, 400, { error: "Missing session id." });

    try {
      const session = await payments.retrieveCheckoutSession(sessionId);
      if (session.payment_status === "paid") {
        const updated = await db.updateCateringRequest(ref, {
          status: "booked",
          paid: true,
          stripePaymentStatus: session.payment_status,
          subtotal: Math.round((session.amount_subtotal || 0)) / 100,
          tax: Math.round((session.total_details?.amount_tax || 0)) / 100,
          total: Math.round((session.amount_total || 0)) / 100,
        });
        await notifications.sendCateringConfirmation(updated);
        const synced = await pushCateringToClover(updated);
        const withSync = await db.updateCateringRequest(ref, { cloverSynced: synced });
        return sendJSON(res, 200, { request: withSync || updated });
      }
      return sendJSON(res, 200, { request: booking, paymentPending: true });
    } catch (e) {
      return sendJSON(res, 502, { error: "Could not verify payment: " + e.message });
    }
  }

  // ---- Catering: single (used after Stripe redirect / kitchen detail) ----
  if (parts[0] === "api" && parts[1] === "catering" && parts.length === 3 && req.method === "GET") {
    const ref = decodeURIComponent(parts[2]);
    const booking = await db.getCateringRequest(ref);
    if (!booking) return sendJSON(res, 404, { error: "Booking not found." });
    return sendJSON(res, 200, { request: booking });
  }

  // ---- Catering: update status (kitchen) ----
  if (parts[0] === "api" && parts[1] === "catering" && parts.length === 3 && req.method === "PATCH") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const ref = decodeURIComponent(parts[2]);
    const body = await readBody(req).catch(() => ({}));
    if (!CATERING_STATUSES.includes(body.status)) {
      return sendJSON(res, 400, { error: `Status must be one of: ${CATERING_STATUSES.join(", ")}` });
    }
    const updated = await db.updateCateringRequest(ref, { status: body.status });
    if (!updated) return sendJSON(res, 404, { error: "Request not found." });
    return sendJSON(res, 200, { request: updated });
  }

  // ---- Catering: retry Clover sync (kitchen) ----
  if (parts[0] === "api" && parts[1] === "catering" && parts.length === 4 && parts[3] === "resync-clover" && req.method === "POST") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const ref = decodeURIComponent(parts[2]);
    const booking = await db.getCateringRequest(ref);
    if (!booking) return sendJSON(res, 404, { error: "Booking not found." });
    const synced = await pushCateringToClover(booking);
    const updated2 = await db.updateCateringRequest(ref, { cloverSynced: synced });
    return sendJSON(res, synced ? 200 : 502, { request: updated2, synced });
  }

  // ---- Catering: list (kitchen) ----
  if (url.pathname === "/api/catering" && req.method === "GET") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    return sendJSON(res, 200, { requests: await db.getCateringRequests() });
  }

  // ---- Locations: our 3 storefronts (public) ----
  if (url.pathname === "/api/locations" && req.method === "GET") {
    return sendJSON(res, 200, { locations: LOCATIONS });
  }

  // ---- static files ----
  if (req.method === "GET") {
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    filePath = path.join(PUBLIC_DIR, decodeURIComponent(filePath));

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback: unknown GET routes go to index.html (hash-based router)
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (err2, indexData) => {
          if (err2) {
            res.writeHead(404);
            return res.end("Not found");
          }
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(indexData);
        });
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Cleveland Smash Burgers running at http://localhost:${PORT}`);
  console.log(`Payments: ${payments.isStripeConfigured() ? "Stripe live (test/live key set)" : "test mode (no STRIPE_SECRET_KEY set)"}`);
  if (payments.isStripeConfigured() !== Boolean(payments.getPublishableKey())) {
    console.warn("\n!!! STRIPE MISCONFIGURED: need BOTH STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY (same Stripe account). Checkout is disabled until fixed. !!!\n");
  }
  console.log(`Catering notifications go to: ${notifications.cateringRecipients().join(", ")}`);
  console.log(`SMS: ${notify.smsConfigured() ? "Twilio live" : "console-logged (no Twilio env vars set)"}`);
  console.log(`Email: ${notify.emailConfigured() ? "Resend live" : "console-logged (no RESEND_API_KEY set)"}`);
  console.log(`Kitchen board: ${process.env.KITCHEN_PASSWORD ? "passcode required" : "open, no passcode set"}`);
});
