// Cleveland Smash Burgers — server
// Zero npm dependencies on purpose: `node server.js` is all you need.
// Serves the static frontend from /public and a small JSON API under /api,
// persisting orders + catering requests to flat JSON files in /data.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const CATERING_FILE = path.join(DATA_DIR, "catering.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");
if (!fs.existsSync(CATERING_FILE)) fs.writeFileSync(CATERING_FILE, "[]");

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

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

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
  for (let i = 0; i < 4; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${prefix}-${code}`;
}

const MENU = [
  { id: "single-smash", name: "Single Smash", price: 7.5, desc: "One smashed patty, American cheese, grilled onion, pickles, CSB sauce on a griddled bun." },
  { id: "double-smash", name: "Double Smash", price: 10.5, desc: "Two smashed patties, double American cheese, grilled onion, pickles, CSB sauce." },
  { id: "triple-smash", name: "Triple Smash", price: 13.5, desc: "Three patties for the truly committed. Same fixings, more char." },
  { id: "the-flats", name: "The Flats", price: 12, desc: "Double smash, bacon, cheddar, crispy onstraws, smoky BBQ sauce." },
  { id: "ohio-city", name: "Ohio City Veggie", price: 10, desc: "House-smashed black bean & mushroom patty, American cheese, pickles, CSB sauce." },
  { id: "smash-fries", name: "Smash Fries", price: 4.5, desc: "Griddle-crisped fries, house seasoning." },
  { id: "cheese-fries", name: "Loaded Cheese Fries", price: 6.5, desc: "Fries, warm cheese sauce, grilled onion, pickled jalapeño." },
  { id: "shake", name: "Hand-Spun Shake", price: 6, desc: "Vanilla, chocolate, or malt. Ask about the seasonal flavor." },
];

function get(req) {
  return new URL(req.url, `http://${req.headers.host}`);
}

const server = http.createServer(async (req, res) => {
  const url = get(req);

  // ---- API ----
  if (url.pathname === "/api/menu" && req.method === "GET") {
    return sendJSON(res, 200, { items: MENU });
  }

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

      const order = {
        ref: makeRefCode("CSB"),
        items,
        customer,
        fulfillment: fulfillment || "pickup",
        notes: notes || "",
        subtotal: Math.round(subtotal * 100) / 100,
        tax,
        total,
        status: "received",
        createdAt: new Date().toISOString(),
      };

      const all = readJSON(ORDERS_FILE);
      all.unshift(order);
      writeJSON(ORDERS_FILE, all);

      return sendJSON(res, 201, { order });
    } catch (e) {
      return sendJSON(res, 400, { error: "Couldn't read that order. " + e.message });
    }
  }

  if (url.pathname === "/api/orders" && req.method === "GET") {
    // simple "kitchen view" for the prototype — no auth, don't ship this as-is
    return sendJSON(res, 200, { orders: readJSON(ORDERS_FILE) });
  }

  if (url.pathname === "/api/catering" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { contact, eventDate, headcount, eventType, budget, menuNotes } = body;

      if (!contact || !contact.name || !contact.email || !contact.phone) {
        return sendJSON(res, 400, { error: "Name, email, and phone are required." });
      }
      if (!eventDate || !headcount) {
        return sendJSON(res, 400, { error: "Event date and headcount are required." });
      }

      const request = {
        ref: makeRefCode("CATER"),
        contact,
        eventDate,
        headcount,
        eventType: eventType || "not specified",
        budget: budget || "not specified",
        menuNotes: menuNotes || "",
        status: "new",
        createdAt: new Date().toISOString(),
      };

      const all = readJSON(CATERING_FILE);
      all.unshift(request);
      writeJSON(CATERING_FILE, all);

      return sendJSON(res, 201, { request });
    } catch (e) {
      return sendJSON(res, 400, { error: "Couldn't read that request. " + e.message });
    }
  }

  if (url.pathname === "/api/catering" && req.method === "GET") {
    return sendJSON(res, 200, { requests: readJSON(CATERING_FILE) });
  }

  // ---- static files ----
  if (req.method === "GET") {
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    filePath = path.join(PUBLIC_DIR, decodeURIComponent(filePath));

    // prevent path traversal outside /public
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
});
