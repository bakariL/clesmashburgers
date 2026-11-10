// Cleveland Smash Burgers — server
// Still zero npm dependencies: `node server.js` is all you need, even with
// SMS/email wired in — those talk to Twilio/Resend over
// plain REST calls (fetch), not their SDKs.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { loadEnv } = require("./env");
loadEnv();

const db = require("./db");
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
  minimum: 10, // total sandwiches per catering order
  sandwiches: [
    { id: "cleveland-classic", name: "The Cleveland Classic", price: 10 },
    { id: "jive-turkey", name: "The Jive Turkey", price: 10 },
    { id: "q-dawg", name: "The Q Dawg", price: 8 },
  ],
  comboUpgrade: { price: 5, description: "Adds fries and a drink" },
  dessertAddOn: { price: 5, description: "Add a dessert" },
};

const CATERING_STATUSES = ["booked", "in_progress", "completed", "canceled"];


// Our storefront.
const LOCATIONS = [
  {
    id: "cleveland",
    name: "Cleveland",
    address: "3915 Carnegie Ave, Cleveland, OH 44115",
    hours: "12:00 PM – 9:30 PM daily",
    phone: "(216) 555-0142",
  },
];

// Catering minimum: total sandwiches (one per guest).
const CATERING_MIN = 10;

// ---- Admin auth: ONE credential, set in env (ADMIN_USERNAME / ADMIN_PASSWORD) ----
// Login returns a signed, expiring token the dashboard sends as
// "Authorization: Bearer <token>". If the env vars aren't set the admin
// area is LOCKED (never open).
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const loginFailures = new Map(); // ip -> { count, until }

function adminConfigured() {
  return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

function adminKey() {
  return crypto
    .createHash("sha256")
    .update(`${process.env.ADMIN_SESSION_SECRET || ""}|${process.env.ADMIN_USERNAME}|${process.env.ADMIN_PASSWORD}`)
    .digest();
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function signAdminToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ADMIN_TOKEN_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", adminKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function kitchenAuthorized(req) {
  if (!adminConfigured()) return false;
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", adminKey()).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

// Validates the customer's catering selection against CATERING_MENU and
// prices it on the server (never trust prices from the browser). Returns
// { error } or { items, subtotal, sandwichCount }.
function buildCateringOrder(rawItems) {
  if (!Array.isArray(rawItems)) return { error: "Choose at least one sandwich." };
  const whole = (n) => (Number.isInteger(Number(n)) && Number(n) >= 0 ? Number(n) : NaN);
  const items = [];
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
    if (comboQty) {
      subtotal += CATERING_MENU.comboUpgrade.price * comboQty;
    }
    if (dessertQty) {
      subtotal += CATERING_MENU.dessertAddOn.price * dessertQty;
    }
  }

  if (items.length === 0) return { error: "Choose at least one sandwich." };
  if (sandwichCount < CATERING_MIN) {
    return { error: `Catering has a ${CATERING_MIN}-person minimum — please add ${CATERING_MIN - sandwichCount} more sandwich${CATERING_MIN - sandwichCount === 1 ? "" : "es"}.` };
  }
  return { items, subtotal: Math.round(subtotal * 100) / 100, sandwichCount };
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

  // ---- Admin login (single credential) ----
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    if (!adminConfigured()) {
      return sendJSON(res, 503, { error: "Admin login isn't set up yet. Set ADMIN_USERNAME and ADMIN_PASSWORD in the server environment." });
    }
    const ip = clientIp(req);
    const rec = loginFailures.get(ip);
    if (rec && rec.until > Date.now()) {
      return sendJSON(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    }
    const body = await readBody(req).catch(() => ({}));
    const ok = safeEqual(body.username || "", process.env.ADMIN_USERNAME) & safeEqual(body.password || "", process.env.ADMIN_PASSWORD);
    if (!ok) {
      const count = ((rec && rec.count) || 0) + 1;
      loginFailures.set(ip, { count, until: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      return sendJSON(res, 401, { error: "Incorrect username or password." });
    }
    loginFailures.delete(ip);
    return sendJSON(res, 200, { ok: true, token: signAdminToken(), expiresInMs: ADMIN_TOKEN_TTL_MS });
  }

  // ---- Admin: who am I / is my token still good ----
  if (url.pathname === "/api/admin/session" && req.method === "GET") {
    return sendJSON(res, kitchenAuthorized(req) ? 200 : 401, { ok: kitchenAuthorized(req) });
  }

  // ---- Admin: email a customer from the dashboard ----
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "catering" && parts[4] === "email" && parts.length === 5 && req.method === "POST") {
    if (!kitchenAuthorized(req)) return sendJSON(res, 401, { error: "Unauthorized." });
    const ref = decodeURIComponent(parts[3]);
    const booking = await db.getCateringRequest(ref);
    if (!booking) return sendJSON(res, 404, { error: "Booking not found." });
    const body = await readBody(req).catch(() => ({}));
    const subject = String(body.subject || "").trim().slice(0, 200);
    const message = String(body.message || "").trim().slice(0, 5000);
    if (!subject || !message) return sendJSON(res, 400, { error: "A subject and a message are required." });

    const result = await notifications.sendCustomerEmail(booking, subject, message);
    const entry = {
      at: new Date().toISOString(),
      to: booking.contact.email,
      subject,
      message,
      status: result.error ? "failed" : result.simulated ? "not sent (email not configured)" : "sent",
      error: result.error || undefined,
    };
    const updated = await db.updateCateringRequest(ref, { emails: [...(booking.emails || []), entry] });
    if (result.error) return sendJSON(res, 502, { error: `Email failed: ${result.error}`, request: updated });
    return sendJSON(res, 200, { request: updated, simulated: Boolean(result.simulated) });
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

  // ---- Catering: book an event ----
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
      if (!eventAddress) return sendJSON(res, 400, { error: "Event address is required." });
      if (!contact || !contact.name || !contact.email || !contact.phone) {
        return sendJSON(res, 400, { error: "Name, email, and phone are required." });
      }

      const subtotal = built.subtotal; // estimate before tax; no online payment

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
        status: "booked",
        createdAt: new Date().toISOString(),
      };

      await db.createCateringRequest(booking);
      await notifications.sendCateringConfirmation(booking);
      const synced = await pushCateringToClover(booking);
      const finalBooking = await db.updateCateringRequest(booking.ref, { cloverSynced: synced });
      return sendJSON(res, 201, { request: finalBooking || booking });
    } catch (e) {
      return sendJSON(res, 400, { error: "Couldn't read that booking. " + e.message });
    }
  }

  // ---- Catering: single (kitchen detail) ----
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
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      // private dashboard: serve the app shell, keep it out of search engines
      return fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e, data) => {
        if (e) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": MIME[".html"], "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" });
        res.end(data);
      });
    }
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
  console.log(`Catering notifications go to: ${notifications.cateringRecipients().join(", ")}`);
  console.log(`SMS: ${notify.smsConfigured() ? "Twilio live" : "console-logged (no Twilio env vars set)"}`);
  console.log(`Email: ${notify.emailConfigured() ? "Resend live" : "console-logged (no RESEND_API_KEY set)"}`);
  console.log(`Admin dashboard (/admin): ${adminConfigured() ? "login required" : "LOCKED — set ADMIN_USERNAME and ADMIN_PASSWORD to enable"}`);
});
