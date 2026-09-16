// Data layer for orders + catering requests.
//
// This is a flat-file store, not a real database — but unlike the very
// first version of this prototype, writes are now atomic (write-to-temp
// + rename, so a crash mid-write can't leave a half-written file) and
// serialized through a per-file queue (so two requests that both await
// something mid-transaction — e.g. a Stripe call — can't interleave their
// reads/writes and stomp on each other).
//
// If you outgrow this (multiple server processes, heavier write volume),
// swap the JSONStore internals for real SQL — every call site here already
// talks in terms of getOrder/updateOrder/etc., so the rest of the app
// doesn't need to change.

const fs = require("fs");
const path = require("path");

class JSONStore {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return [];
    }
  }

  _writeAtomic(data) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Runs fn(currentArray) synchronously and persists whatever fn mutated it
  // to. Queued so overlapping requests can't race each other.
  mutate(fn) {
    this.queue = this.queue.then(() => {
      const data = this._read();
      const result = fn(data);
      this._writeAtomic(data);
      return result;
    });
    return this.queue;
  }

  read() {
    return this.queue.then(() => this._read());
  }
}

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const ordersStore = new JSONStore(path.join(DATA_DIR, "orders.json"));
const cateringStore = new JSONStore(path.join(DATA_DIR, "catering.json"));
const locationsStore = new JSONStore(path.join(DATA_DIR, "locations.json"));
const alertsStore = new JSONStore(path.join(DATA_DIR, "alerts.json"));

// ---- Orders ----

function createOrder(order) {
  return ordersStore.mutate((data) => {
    data.unshift(order);
    return order;
  });
}

function updateOrder(ref, patch) {
  return ordersStore.mutate((data) => {
    const order = data.find((o) => o.ref === ref);
    if (!order) return null;
    Object.assign(order, patch, { updatedAt: new Date().toISOString() });
    return order;
  });
}

function getOrder(ref) {
  return ordersStore.read().then((data) => data.find((o) => o.ref === ref) || null);
}

function getOrders() {
  return ordersStore.read();
}

// ---- Catering ----

function createCateringRequest(request) {
  return cateringStore.mutate((data) => {
    data.unshift(request);
    return request;
  });
}

function updateCateringRequest(ref, patch) {
  return cateringStore.mutate((data) => {
    const request = data.find((r) => r.ref === ref);
    if (!request) return null;
    Object.assign(request, patch, { updatedAt: new Date().toISOString() });
    return request;
  });
}

function getCateringRequest(ref) {
  return cateringStore.read().then((data) => data.find((r) => r.ref === ref) || null);
}

function getCateringRequests() {
  return cateringStore.read();
}

// ---- Pop-up locations / schedule ----

function createLocation(location) {
  return locationsStore.mutate((data) => {
    data.push(location);
    data.sort((a, b) => `${a.date}${a.startTime || ""}`.localeCompare(`${b.date}${b.startTime || ""}`));
    return location;
  });
}

function updateLocation(id, patch) {
  return locationsStore.mutate((data) => {
    const loc = data.find((l) => l.id === id);
    if (!loc) return null;
    Object.assign(loc, patch, { updatedAt: new Date().toISOString() });
    data.sort((a, b) => `${a.date}${a.startTime || ""}`.localeCompare(`${b.date}${b.startTime || ""}`));
    return loc;
  });
}

function deleteLocation(id) {
  return locationsStore.mutate((data) => {
    const idx = data.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    data.splice(idx, 1);
    return true;
  });
}

function getLocations() {
  return locationsStore.read();
}

// ---- Alert subscribers ----

function createAlertSignup(signup) {
  return alertsStore.mutate((data) => {
    data.unshift(signup);
    return signup;
  });
}

function removeAlertSignupsByContact({ email, phone }) {
  return alertsStore.mutate((data) => {
    const before = data.length;
    const remaining = data.filter((s) => {
      const emailMatch = email && s.email && s.email.toLowerCase() === email.toLowerCase();
      const phoneMatch = phone && s.phone && s.phone === phone;
      return !(emailMatch || phoneMatch);
    });
    data.length = 0;
    data.push(...remaining);
    return before - remaining.length;
  });
}

function getAlertSignups() {
  return alertsStore.read();
}

module.exports = {
  createOrder,
  updateOrder,
  getOrder,
  getOrders,
  createCateringRequest,
  updateCateringRequest,
  getCateringRequest,
  getCateringRequests,
  createLocation,
  updateLocation,
  deleteLocation,
  getLocations,
  createAlertSignup,
  removeAlertSignupsByContact,
  getAlertSignups,
};
