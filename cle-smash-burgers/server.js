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

const MENU = [
  { id: "single-smash", name: "Single Smash", price: 7.5, desc: "One smashed patty, American cheese, grilled onion, pickles, CSB sauce on a griddled bun." },
  { id: "double-smash", name: "Double Smash", price: 10.5, desc: "Two smashed patties, double American cheese, grilled onion, pickles, CSB sauce." },
  { id: "triple-smash", name: "Triple Smash", price: 13.5, desc: "Three patties for the truly committed. Same fixings, more char." },
  { id: "the-flats", name: "The Flats", price: 12, desc: "Double smash, bacon, cheddar, crispy onion straws, smoky BBQ sauce." },
  { id: "ohio-city", name: "Ohio City Veggie", price: 10, desc: "House-smashed black bean & mushroom patty, American cheese, pickles, CSB sauce." },
  { id: "smash-fries", name: "Smash Fries", price: 4.5, desc: "Griddle-crisped fries, house seasoning." },
  { id: "cheese-fries", name: "Loaded Cheese Fries", price: 6.5, desc: "Fries, warm cheese sauce, grilled onion, pickled jalapeño." },
  { id: "shake", name: "Hand-Spun Shake", price: 6, desc: "Vanilla, chocolate, or malt. Ask about the seasonal flavor." },
];

const ORDER_STATUSES = ["pending_payment", "received", "in_progress", "ready", "completed", "canceled"];
const CATERING_STATUSES = ["pending_payment", "booked", "in_progress", "completed", "canceled"];

// Fixed catering packages — flat per-person pricing, no menu customization.
// The only inputs a customer gives are headcount, event date/type, and
// contact info; the food itself is fixed per package.
const CATERING_PACKAGES = [
  {
    id: "office-lunch",
    name: "Office Lunch",
    pricePerPerson: 14,
    minHeadcount: 10,
    description: "Smash sliders, fries, and a house salad — dropped off ready to serve.",
    includes: ["Single-smash sliders", "Smash fries", "House salad", "Plates, napkins, utensils"],
  },
  {
    id: "backyard-griddle",
    name: "Backyard Griddle",
    pricePerPerson: 19,
    minHeadcount: 20,
    description: "A build-your-own smash bar, cooked fresh on-site off the truck.",
    includes: ["Made-to-order smash burgers on-site", "Two sides", "Hand-spun shakes", "1.5 hours of service"],
  },
  {
    id: "premium-event",
    name: "Premium Event",
    pricePerPerson: 26,
    minHeadcount: 30,
    description: "Full-service catering for weddings, corporate events, and larger parties.",
    includes: ["Full on-site griddle service", "Two sides + shakes", "Staff for up to 3 hours", "Custom signage with your event name"],
  },
];

function kitchenAuthorized(req) {
  const configured = process.env.KITCHEN_PASSWORD;
  if (!configured) return true; // dev mode — no passcode set
  return req.headers["x-kitchen-passcode"] === configured;
}

async function sendOrderConfirmations(order) {
  const itemsSummary = order.items
    .map((i) => {
      const m = MENU.find((x) => x.id === i.id);
      return `${i.qty}x ${m ? m.name : i.id}`;
    })
    .join(", ");

  await notify.sendSMS(
    order.customer.phone,
    `Cleveland Smash Burgers: order ${order.ref} received! ${itemsSummary}. Total $${order.total.toFixed(2)}. We'll text when it's ready.`
  );

  if (order.customer.email) {
    await notify.sendEmail(
      order.customer.email,
      `Order ${order.ref} confirmed — Cleveland Smash Burgers`,
      `<h2>Thanks, ${order.customer.name}!</h2><p>Your order <strong>${order.ref}</strong> is in.</p><p>${itemsSummary}</p><p>Total: $${order.total.toFixed(2)}</p><p>We'll text ${order.customer.phone} when it's ready.</p>`
    );
  }
}

async function sendCateringConfirmation(request) {
  const msg = `Your ${request.package.name} catering is booked for ${request.headcount} guests on ${request.eventDate} at ${request.eventAddress}. Total: $${request.total.toFixed(2)}.`;

  await notify.sendEmail(
    request.contact.email,
    `Booking confirmed — Cleveland Smash Burgers Catering`,
    `<h2>You're booked, ${request.contact.name}!</h2><p>${msg}</p><p>Reference: <strong>${request.ref}</strong></p><p>Questions? Reply to this email or call (216) 555-0142.</p>`
  );
  if (request.contact.phone) {
    await notify.sendSMS(request.contact.phone, `Cleveland Smash Burgers: booking ${request.ref} confirmed. ${msg}`);
  }
}

// Pushes a paid order into Clover so kitchen staff see it on the
// register/KDS. Never throws — a Clover hiccup should never block a
// customer's confirmation. Returns true/false so the caller can record
// sync status on the order for the kitchen board to show.
async function pushOrderToClover(order) {
  if (!clover.isCloverConfigured()) return false;
  try {
    const cartLineItems = order.items
      .map((i) => {
        const m = MENU.find((x) => x.id === i.id);
        return m ? { name: m.name, qty: i.qty, priceCents: Math.round(m.price * 100) } : null;
      })
      .filter(Boolean);
    const lineItems = clover.expandLineItems(cartLineItems);
    // Tax as its own line so Clover's total matches what was actually charged.
    if (order.tax > 0) lineItems.push({ name: "Tax", priceCents: Math.round(order.tax * 100) });

    const note = [
      `Order ${order.ref}`,
      order.customer.name,
      order.customer.phone,
      order.fulfillment === "pickup" ? "Pickup ASAP" : "Scheduled pickup",
      order.notes || "",
    ].filter(Boolean).join(" · ");

    await clover.pushOrder({ lineItems, note });
    return true;
  } catch (e) {
    console.error(`Clover push failed for order ${order.ref}:`, e.message);
    return false;
  }
}

// Same idea for a catering booking — one summary line item for the whole
// booking (not one per guest) since a caterer needs "prep 40 Office
// Lunch," not 40 duplicate ticket lines.
async function pushCateringToClover(booking) {
  if (!clover.isCloverConfigured()) return false;
  try {
    const lineItems = [{
      name: `${booking.package.name} catering — ${booking.headcount} guests`,
      priceCents: Math.round(booking.subtotal * 100),
    }];
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

async function sendLocationAlert(subscriber, location) {
  const when = `${location.date}${location.startTime ? ` ${location.startTime}` : ""}${location.endTime ? `–${location.endTime}` : ""}`;
  const text = `Cleveland Smash Burgers pop-up alert: we'll be at ${location.name}, ${location.address} on ${when}.${location.notes ? ` ${location.notes}` : ""}`;

  if (subscriber.phone) await notify.sendSMS(subscriber.phone, text);
  if (subscriber.email) {
    await notify.sendEmail(
      subscriber.email,
      "New pop-up near you — Cleveland Smash Burgers",
      `<p>${text}</p>`
    );
  }
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

  // ---- Menu ----
  if (url.pathname === "/api/menu" && req.method === "GET") {
    return sendJSON(res, 200, { items: MENU });
  }

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

  // ---- Orders: create ----
  if (url.pathname === "/api/orders" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { items, customer, fulfillment, notes } = body;

      if (!Array.isArray(items) || items.length === 0) {
        return sendJSON(res, 400, { error: "Your order has no items yet." });
      }
      if (!customer || !customer.name || !customer.phone) {
        return sendJSON(res, 400, { error: "Name and phone are required." });
      }

      const subtotal = items.reduce((sum, i) => {
        const menuItem = MENU.find((m) => m.id === i.id);
        return sum + (menuItem ? menuItem.price * i.qty : 0);
      }, 0);
      const tax = Math.round(subtotal * 0.08 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const stripeOn = payments.isStripeConfigured();

      const order = {
        ref: makeRefCode("CSB"),
        items,
        customer,
        fulfillment: fulfillment || "pickup",
        notes: notes || "",
        subtotal: Math.round(subtotal * 100) / 100,
        tax,
        total,
        status: stripeOn ? "pending_payment" : "received",
        paid: !stripeOn,
        createdAt: new Date().toISOString(),
      };

      await db.createOrder(order);

      if (!stripeOn) {
        await sendOrderConfirmations(order);
        const synced = await pushOrderToClover(order);
        const finalOrder = await db.updateOrder(order.ref, { cloverSynced: synced });
        return sendJSON(res, 201, { order: finalOrder || order });
      }

      try {
        const lineItems = items
          .map((i) => {
            const menuItem = MENU.find((m) => m.id === i.id);
            if (!menuItem) return null;
            return {
              name: menuItem.name,
              unitAmountCents: Math.round(menuItem.price * 100),
              quantity: i.qty,
              taxCode: payments.FOOD_TAX_CODE,
            };
          })
          .filter(Boolean);
        // No manual "Tax" line here — automatic_tax on the Checkout
        // Session (see payments.js) calculates and adds real tax itself.
        // The order.tax/order.total set above are just a pre-checkout
        // estimate; verify-payment overwrites them with Stripe's actual
        // figures once the customer pays.

        const origin = requestOrigin(req);
        const session = await payments.createCheckoutSession({
          lineItems,
          returnUrl: `${origin}/#/order-confirmed?ref=${order.ref}&session_id={CHECKOUT_SESSION_ID}`,
          customerEmail: order.customer.email || undefined,
          metadata: { order_ref: order.ref },
        });
        await db.updateOrder(order.ref, { stripeSessionId: session.id });
        return sendJSON(res, 201, { order, clientSecret: session.client_secret });
      } catch (e) {
        // Stripe misconfigured/unreachable — don't block the customer, fall back to test mode.
        console.error("Stripe checkout session failed, falling back to test mode:", e.message);
        const finalOrder = await db.updateOrder(order.ref, {
          status: "received",
          paid: true,
          paymentNote: "Stripe unavailable — order accepted without online payment.",
        });
        await sendOrderConfirmations(finalOrder);
        const synced = await pushOrderToClover(finalOrder);
        const withSync = await db.updateOrder(order.ref, { cloverSynced: synced });
        return sendJSON(res, 201, { order: withSync || finalOrder });
      }
    } catch (e) {
      return sendJSON(res, 400, { error: "Couldn't read that order. " + e.message });
    }
  }

  // ---- Orders: verify payment after Stripe redirect ----
  if (parts[0] === "api" && parts[1] === "orders" && parts[3] === "verify-payment" && req.method === "GET") {
    const ref = decodeURIComponent(parts[2]);
    const sessionId = url.searchParams.get("session_id");
    const order = await db.getOrder(ref);
    if (!order) return sendJSON(res, 404, { error: "Order not found." });
    if (order.paid) return sendJSON(res, 200, { order }); // already confirmed — avoid re-sending texts on refresh
    if (!sessionId) return sendJSON(res, 400, { error: "Missing session id." });

    try {
      const session = await payments.retrieveCheckoutSession(sessionId);
      if (session.payment_status === "paid") {
        // Overwrite our pre-checkout estimate with what Stripe actually
        // calculated and charged (real tax, once you have a jurisdiction
        // registered — see payments.js).
        const updated = await db.updateOrder(ref, {
          status: "received",
          paid: true,
          stripePaymentStatus: session.payment_status,
          subtotal: Math.round((session.amount_subtotal || 0)) / 100,
          tax: Math.round((session.total_details?.amount_tax || 0)) / 100,
          total: Math.round((session.amount_total || 0)) / 100,
        });
        await sendOrderConfirmations(updated);
        const synced = await pushOrderToClover(updated);
        const withSync = await db.updateOrder(ref, { cloverSynced: synced });
        return sendJSON(res, 200, { order: withSync || updated });
      }
      return sendJSON(res, 200, { order, paymentPending: true });
    } catch (e) {
      return sendJSON(res, 502, { error: "Could not verify payment: " + e.message });
    }
  }

  // ---- Orders: single / update status ----
  if (parts[0] === "api" && parts[1] === "orders" && parts.length === 3) {
    const ref = decodeURIComponent(parts[2]);

    if (req.method === "GET") {
      const order = await db.getOrder(ref);
      if (!order) return sendJSON(res, 404, { error: "Order not found." });
      return sendJSON(res, 200, { order });
    }

    if (req.method === "PATCH") {
      if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
      const body = await readBody(req).catch(() => ({}));
      if (!ORDER_STATUSES.includes(body.status)) {
        return sendJSON(res, 400, { error: `Status must be one of: ${ORDER_STATUSES.join(", ")}` });
      }
      const updated = await db.updateOrder(ref, { status: body.status });
      if (!updated) return sendJSON(res, 404, { error: "Order not found." });
      return sendJSON(res, 200, { order: updated });
    }
  }

  // ---- Orders: retry Clover sync (kitchen) ----
  if (parts[0] === "api" && parts[1] === "orders" && parts.length === 4 && parts[3] === "resync-clover" && req.method === "POST") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const ref = decodeURIComponent(parts[2]);
    const order = await db.getOrder(ref);
    if (!order) return sendJSON(res, 404, { error: "Order not found." });
    const synced = await pushOrderToClover(order);
    const updated = await db.updateOrder(ref, { cloverSynced: synced });
    return sendJSON(res, synced ? 200 : 502, { order: updated, synced });
  }

  // ---- Orders: list (kitchen) ----
  if (url.pathname === "/api/orders" && req.method === "GET") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    return sendJSON(res, 200, { orders: await db.getOrders() });
  }

  // ---- Catering: list fixed packages (public) ----
  if (url.pathname === "/api/catering/packages" && req.method === "GET") {
    return sendJSON(res, 200, { packages: CATERING_PACKAGES });
  }

  // ---- Catering: book + pay ----
  if (url.pathname === "/api/catering" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { packageId, headcount, eventDate, eventType, eventAddress, budgetNote, notes, contact } = body;

      const pkg = CATERING_PACKAGES.find((p) => p.id === packageId);
      if (!pkg) return sendJSON(res, 400, { error: "Choose a valid catering package." });

      const count = Number(headcount);
      if (!Number.isFinite(count) || count < pkg.minHeadcount) {
        return sendJSON(res, 400, { error: `${pkg.name} requires at least ${pkg.minHeadcount} guests.` });
      }
      if (!eventDate) return sendJSON(res, 400, { error: "Event date is required." });
      if (!eventAddress) return sendJSON(res, 400, { error: "Event address is required." });
      if (!contact || !contact.name || !contact.email || !contact.phone) {
        return sendJSON(res, 400, { error: "Name, email, and phone are required." });
      }

      const subtotal = Math.round(pkg.pricePerPerson * count * 100) / 100;
      const total = subtotal; // pre-checkout estimate; verify-payment overwrites with Stripe's real total+tax
      const stripeOn = payments.isStripeConfigured();

      const booking = {
        ref: makeRefCode("CATER"),
        package: { id: pkg.id, name: pkg.name, pricePerPerson: pkg.pricePerPerson },
        headcount: count,
        subtotal,
        tax: 0,
        total,
        eventDate,
        eventType: eventType || "not specified",
        eventAddress,
        budgetNote: budgetNote || "",
        notes: notes || "",
        contact,
        status: stripeOn ? "pending_payment" : "booked",
        paid: !stripeOn,
        createdAt: new Date().toISOString(),
      };

      await db.createCateringRequest(booking);

      if (!stripeOn) {
        await sendCateringConfirmation(booking);
        const synced = await pushCateringToClover(booking);
        const finalBooking = await db.updateCateringRequest(booking.ref, { cloverSynced: synced });
        return sendJSON(res, 201, { request: finalBooking || booking });
      }

      try {
        const origin = requestOrigin(req);
        const session = await payments.createCheckoutSession({
          lineItems: [{
            name: `${pkg.name} catering — ${count} guests`,
            unitAmountCents: Math.round(pkg.pricePerPerson * 100),
            quantity: count,
            taxCode: payments.FOOD_TAX_CODE,
          }],
          returnUrl: `${origin}/#/catering-confirmed?ref=${booking.ref}&session_id={CHECKOUT_SESSION_ID}`,
          customerEmail: contact.email,
          metadata: { catering_ref: booking.ref },
        });
        await db.updateCateringRequest(booking.ref, { stripeSessionId: session.id });
        return sendJSON(res, 201, { request: booking, clientSecret: session.client_secret });
      } catch (e) {
        console.error("Stripe checkout session failed, falling back to test mode:", e.message);
        const finalBooking = await db.updateCateringRequest(booking.ref, {
          status: "booked",
          paid: true,
          paymentNote: "Stripe unavailable — booking accepted without online payment.",
        });
        await sendCateringConfirmation(finalBooking);
        const synced = await pushCateringToClover(finalBooking);
        const withSync = await db.updateCateringRequest(booking.ref, { cloverSynced: synced });
        return sendJSON(res, 201, { request: withSync || finalBooking });
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
        await sendCateringConfirmation(updated);
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

  // ---- Locations / pop-up schedule: list (public) ----
  if (url.pathname === "/api/locations" && req.method === "GET") {
    return sendJSON(res, 200, { locations: await db.getLocations() });
  }

  // ---- Locations: create (kitchen) ----
  if (url.pathname === "/api/locations" && req.method === "POST") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const body = await readBody(req).catch(() => ({}));
    const { date, startTime, endTime, name, address, zip, notes, type } = body;
    if (!date || !name || !address) {
      return sendJSON(res, 400, { error: "Date, stop name, and address are required." });
    }
    const location = {
      id: crypto.randomUUID(),
      date,
      startTime: startTime || "",
      endTime: endTime || "",
      name,
      address,
      zip: (zip || "").trim(),
      notes: notes || "",
      type: type === "event" ? "event" : "weekly",
      notifiedAt: null,
      createdAt: new Date().toISOString(),
    };
    await db.createLocation(location);
    return sendJSON(res, 201, { location });
  }

  // ---- Locations: update / delete (kitchen) ----
  if (parts[0] === "api" && parts[1] === "locations" && parts.length === 3 && parts[2] !== "notify") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const id = decodeURIComponent(parts[2]);

    if (req.method === "PATCH") {
      const body = await readBody(req).catch(() => ({}));
      const updated = await db.updateLocation(id, body);
      if (!updated) return sendJSON(res, 404, { error: "Stop not found." });
      return sendJSON(res, 200, { location: updated });
    }

    if (req.method === "DELETE") {
      const removed = await db.deleteLocation(id);
      if (!removed) return sendJSON(res, 404, { error: "Stop not found." });
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ---- Locations: notify subscribers about a stop (kitchen) ----
  if (parts[0] === "api" && parts[1] === "locations" && parts.length === 4 && parts[3] === "notify" && req.method === "POST") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const id = decodeURIComponent(parts[2]);
    const body = await readBody(req).catch(() => ({}));

    const locations = await db.getLocations();
    const location = locations.find((l) => l.id === id);
    if (!location) return sendJSON(res, 404, { error: "Stop not found." });

    const allSignups = await db.getAlertSignups();
    const nearOnly = Boolean(body.nearOnly) && Boolean(location.zip);
    const targets = nearOnly
      ? allSignups.filter((s) => s.zip && s.zip.slice(0, 3) === location.zip.slice(0, 3))
      : allSignups;

    let sent = 0;
    for (const sub of targets) {
      await sendLocationAlert(sub, location);
      sent++;
    }

    await db.updateLocation(id, { notifiedAt: new Date().toISOString() });
    return sendJSON(res, 200, { notified: sent, of: allSignups.length, nearOnly });
  }

  // ---- Alerts: subscribe (public) ----
  if (url.pathname === "/api/alerts/subscribe" && req.method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { name, email, phone, zip } = body;

    if (!zip) return sendJSON(res, 400, { error: "A zip code is required so we know where 'near you' means." });
    if (!email && !phone) return sendJSON(res, 400, { error: "Add an email or phone number so we can actually alert you." });

    const signup = {
      id: crypto.randomUUID(),
      name: name || "",
      email: email || "",
      phone: phone || "",
      zip: String(zip).trim(),
      createdAt: new Date().toISOString(),
    };
    await db.createAlertSignup(signup);

    const confirmMsg = `You're on the list for Cleveland Smash Burgers pop-up alerts near ${signup.zip}. We'll let you know when we're near you.`;
    if (signup.phone) await notify.sendSMS(signup.phone, confirmMsg);
    if (signup.email) await notify.sendEmail(signup.email, "You're subscribed — Cleveland Smash Burgers alerts", `<p>${confirmMsg}</p>`);

    return sendJSON(res, 201, { signup });
  }

  // ---- Alerts: unsubscribe (public) ----
  if (url.pathname === "/api/alerts/unsubscribe" && req.method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { email, phone } = body;
    if (!email && !phone) return sendJSON(res, 400, { error: "Give us the email or phone number you signed up with." });
    const removed = await db.removeAlertSignupsByContact({ email, phone });
    return sendJSON(res, 200, { removed });
  }

  // ---- Alerts: list subscribers (kitchen) ----
  if (url.pathname === "/api/alerts" && req.method === "GET") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    return sendJSON(res, 200, { signups: await db.getAlertSignups() });
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
  console.log(`SMS: ${notify.smsConfigured() ? "Twilio live" : "console-logged (no Twilio env vars set)"}`);
  console.log(`Email: ${notify.emailConfigured() ? "Resend live" : "console-logged (no RESEND_API_KEY set)"}`);
  console.log(`Kitchen board: ${process.env.KITCHEN_PASSWORD ? "passcode required" : "open, no passcode set"}`);
});
