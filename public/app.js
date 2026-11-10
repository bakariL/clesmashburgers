// Cleveland Smash Burgers — frontend app
// Plain JS, no framework, no build step. Hash-based router with a handful of views.

const ORDER_URL = "https://cleveland.picnicfood.com/s/cleveland-smash-burgers/3915-carnegie-ave-cleveland/c1b123c0-f9e7-4f82-a022-59127502a6bb";

const FALLBACK_CATERING_MENU = {
  sandwiches: [
    { id: "cleveland-classic", name: "The Cleveland Classic", price: 10 },
    { id: "jive-turkey", name: "The Jive Turkey", price: 10 },
    { id: "q-dawg", name: "The Q Dawg", price: 8 },
  ],
  minimum: 10,
  comboUpgrade: { price: 5, description: "Adds fries and a drink" },
  dessertAddOn: { price: 5, description: "Add a dessert" },
};

const FALLBACK_LOCATIONS = [
  { id: "cleveland", name: "Cleveland", address: "3915 Carnegie Ave, Cleveland, OH 44115", hours: "12:00 PM – 9:30 PM daily", phone: "(216) 555-0142" },
];

const state = {
  cateringMenu: FALLBACK_CATERING_MENU,
  locations: FALLBACK_LOCATIONS,
  lastCatering: JSON.parse(sessionStorage.getItem("csb_last_catering") || "null"),
  deferredInstallPrompt: null,
  kitchenAuthed: false,
  openCompose: null,
  composeDraft: {},
  kitchenCalYear: new Date().getFullYear(),
  kitchenCalMonth: new Date().getMonth(),
};

const CATERING_STATUSES = ["booked", "in_progress", "completed", "canceled"];
let kitchenPollTimer = null;

function money(n) {
  return `$${n.toFixed(2)}`;
}

function escapeHtml(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let toastTimer = null;
function showToast(msg) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2200);
}

// ---------------- Router ----------------

function isAdminPath() {
  return location.pathname === "/admin" || location.pathname.startsWith("/admin/");
}

function currentRoute() {
  if (isAdminPath()) return "kitchen";
  const raw = (location.hash || "#/").replace("#", "").replace(/^\//, "");
  const r = raw.split("?")[0] || "home";
  return r === "kitchen" ? "home" : r; // the dashboard lives only at /admin
}

function currentQuery() {
  const raw = location.hash || "";
  const qIndex = raw.indexOf("?");
  if (qIndex === -1) return new URLSearchParams();
  return new URLSearchParams(raw.slice(qIndex + 1));
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const res = await fetch("/api/catering/menu");
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.sandwiches) && data.sandwiches.length) state.cateringMenu = data;
    }
  } catch {
    // offline or API not running yet — fallback menu already in state
  }
  try {
    const res = await fetch("/api/locations");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.locations) && data.locations.length) state.locations = data.locations;
    }
  } catch {
    // offline or API not running yet — fallback locations already in state
  }
  registerServiceWorker();
  setupInstallPrompt();
  render();
}

// ---------------- Layout chrome ----------------

function nav() {
  const route = currentRoute();
  const link = (href, label) =>
    `<a href="${href}" class="${route === href.replace('#/', '') || (route === 'home' && href === '#/') ? 'active' : ''}">${label}</a>`;
  return `
  <header class="nav">
    <div class="nav-inner">
      <a href="#/" class="brand" style="text-decoration:none;">
        <img src="/icons/badge.png" alt="Cleveland Smash Burgers" class="brand-mark">
        <span class="brand-word">CLEVELAND<span>&nbsp;SMASH&nbsp;BURGERS</span></span>
      </a>
      <nav class="nav-links">
        ${link('#/', 'Home')}
        <a href="${ORDER_URL}" target="_blank" rel="noopener">Order Now</a>
        ${link('#/locations', 'Find Us')}
        ${link('#/catering', 'Catering')}
      </nav>
      <button class="nav-cta" id="installNavBtn">Get the App</button>
    </div>
  </header>`;
}

function footer() {
  return `
  <footer>
    <div class="container">
      <div class="footer-grid">
        <div>
          <img src="/icons/badge.png" alt="Cleveland Smash Burgers" class="footer-mark">
          <p>Thin-smashed, crispy-edge burgers off the griddle. Order ahead for pickup, or book us for your next event.</p>
        </div>
        <div>
          <h4>Find Us</h4>
          <p>3915 Carnegie Ave<br>Cleveland, OH 44115<br>12:00 PM – 9:30 PM daily<br><a href="#/locations">Directions →</a></p>
        </div>
        <div>
          <h4>Connect</h4>
          <p><a href="tel:+12165550142">(216) 555-0142</a><br>
          <a href="${ORDER_URL}" target="_blank" rel="noopener">Order now →</a></p>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} Cleveland Smash Burgers. Prototype build.</span>
        <span>
          <a href="#" id="installFooterBtn" style="color:var(--mustard);">Install the app</a>
        </span>
      </div>
    </div>
  </footer>`;
}

// ---------------- Views ----------------

function viewHome() {
  return `
  <section class="hero">
    <div class="hero-inner">
      <div>
        <h1 class="h-display">The Best Burger in Cleveland.<br><em>Wagyu Wagyu!</em></h1>
        <p class="lede">Wagyu smash burgers, fresh-cut fries, and coke floats — order ahead for pickup or cater for an event.</p>
        <div class="hero-actions">
          <a href="${ORDER_URL}" target="_blank" rel="noopener" class="btn btn-primary">Order Now</a>
          <a href="#/catering" class="btn btn-secondary">Catering</a>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Visit Us</h2>
          <p>3915 Carnegie Ave, Cleveland — 12:00 PM to 9:30 PM daily.</p>
        </div>
        <a href="#/locations" class="btn btn-dark">Get Directions</a>
      </div>
    </div>
  </section>

  <section class="band-dark">
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Feeding a crowd?</h2>
          <p>Office lunches, weddings, tailgates — we bring the griddle to you or send trays your way.</p>
        </div>
        <a href="#/catering" class="btn btn-primary">Start a Catering Request</a>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Take us with you</h2>
          <p>Install Cleveland Smash Burgers as an app on your phone — order faster next time, no app store needed.</p>
        </div>
      </div>
      <div class="install-card">
        <img class="app-icon" src="/icons/icon-192.png" alt="Cleveland Smash Burgers app icon" width="96" height="96">
        <div>
          <p style="margin:0 0 10px; font-size:0.95rem; color:#5c5c5c;">This site installs like a native app right from your browser: tap <strong>Get the App</strong> above, or use your browser's "Add to Home Screen" option. It'll launch full-screen with an icon on your home screen — no App Store or Play Store listing yet.</p>
          <button class="btn btn-dark" id="installInlineBtn">Install the App</button>
        </div>
      </div>
    </div>
  </section>`;
}

function sandwichRow(m) {
  const combo = state.cateringMenu.comboUpgrade;
  const dessert = state.cateringMenu.dessertAddOn;
  const ctl = (kind, id, label, hint = "") => `
    <div class="qty-line">
      <span>${label}${hint ? ` <span class="hint">· ${hint}</span>` : ""}</span>
      <div class="qty-ctl">
        <button type="button" class="btn btn-dark btn-sm" data-cqty-down="${kind}:${id}" aria-label="Fewer ${label}">−</button>
        <span class="qty-val" id="cq-${kind}-${id}">0</span>
        <button type="button" class="btn btn-dark btn-sm" data-cqty-up="${kind}:${id}" aria-label="More ${label}">+</button>
      </div>
    </div>`;
  return `
  <div class="pkg-card" data-sandwich="${m.id}">
    <div class="pkg-name">${m.name}</div>
    <div class="pkg-price">${money(m.price)} each</div>
    ${ctl("qty", m.id, "Quantity")}
    ${ctl("combo", m.id, `Make it a combo (+${money(combo.price)} each)`, combo.description)}
    ${ctl("dessert", m.id, `Add a dessert (+${money(dessert.price)} each)`)}
    <div class="field" style="margin:10px 0 0;">
      <label for="cnote-${m.id}">Special requests / notes <span class="hint">(optional)</span></label>
      <textarea id="cnote-${m.id}" maxlength="300" placeholder="e.g. no onions, extra pickles, sauce on the side"></textarea>
    </div>
  </div>`;
}

function viewCatering() {
  const menu = state.cateringMenu;
  return `
  <section class="catering-hero">
    <div class="container">
      <div class="eyebrow" style="color:#f7d9da;">CATERING</div>
      <h1 class="h-display">FEEDING THE CROWD.</h1>
      <p>Pick your sandwiches and quantities, choose your date, and book your event in a few minutes. We'll follow up to confirm your details.</p>
    </div>
  </section>

  <section>
    <div class="container">
      <div id="cateringError"></div>

      <form id="cateringForm" novalidate>
        <div class="section-head">
          <div>
            <h2 class="h-display">1. Build Your Order</h2>
            <p><strong>${menu.minimum || 10}-person minimum</strong> — at least ${menu.minimum || 10} sandwiches per order. Combo upgrade is ${money(menu.comboUpgrade.price)} per sandwich (${menu.comboUpgrade.description.toLowerCase()}). Dessert is ${money(menu.dessertAddOn.price)} more.</p>
          </div>
        </div>
        <div class="pkg-grid">
          ${menu.sandwiches.map(sandwichRow).join("")}
        </div>

        <div class="form-card" style="max-width:640px; margin-top:28px;">
          <div class="confirm-detail-card" style="margin:0 0 20px;">
            <div class="row"><span>Sandwiches</span><span id="cCountPreview">0 / ${menu.minimum || 10} minimum</span></div>
            <div class="row"><span>Estimated total</span><span id="cTotalPreview">$0.00</span></div>
            <div class="row" style="font-size:0.78rem; color:var(--steel);"><span>Estimate before tax. We'll confirm final pricing with you.</span></div>
          </div>

          <h2 class="h-display" style="font-size:1.3rem; margin:0 0 12px;">2. Event Details</h2>

          <div class="field">
            <label>Event date <span class="hint">(we only do one event per day — grayed-out days are already taken)</span></label>
            <div id="cDateCalendar"><p style="color:var(--steel);">Loading calendar…</p></div>
            <input type="hidden" id="cDate" required>
            <p id="cDateSelected" style="margin:8px 0 0; font-size:0.9rem; font-weight:600;"></p>
          </div>

          <div class="field">
            <label for="cType">Event type</label>
            <select id="cType">
              <option>Office / corporate</option>
              <option>Wedding</option>
              <option>Birthday / private party</option>
              <option>Tailgate / sports</option>
              <option>Other</option>
            </select>
          </div>

          <div class="field">
            <label for="cAddress">Event address</label>
            <input type="text" id="cAddress" required placeholder="Where should we deliver?">
          </div>

          <div class="field-row">
            <div class="field">
              <label for="cName">Full name</label>
              <input type="text" id="cName" required placeholder="Jordan Smith">
            </div>
            <div class="field">
              <label for="cPhone">Phone</label>
              <input type="tel" id="cPhone" required placeholder="(216) 555-0100">
            </div>
          </div>
          <div class="field">
            <label for="cEmail">Email</label>
            <input type="email" id="cEmail" required placeholder="you@example.com">
          </div>

          <div class="field">
            <label for="cBudget">Budget notes <span class="hint">(optional)</span></label>
            <input type="text" id="cBudget" placeholder="e.g. flexible, or tied to a specific budget">
          </div>
          <div class="field">
            <label for="cNotes">Anything else we should know? <span class="hint">(optional)</span></label>
            <textarea id="cNotes" placeholder="Parking, timing, dietary notes, etc."></textarea>
          </div>

          <button type="submit" class="btn btn-primary btn-block">Book This Event — est. <span id="cSubmitTotal">$0.00</span></button>
        </div>
      </form>

      <p style="text-align:center; font-size:0.88rem; color:var(--steel); max-width:60ch; margin:18px auto 0;">
        Trouble booking, or need something outside this menu?
        <a href="tel:+12165550142" style="color:var(--crust);">Call (216) 555-0142</a> — we're happy to help.
      </p>
    </div>
  </section>`;
}

function renderCateringConfirmedDetail(req) {
  return `
  <section style="padding-top:56px;">
    <div class="container confirm-wrap">
      <div class="stamp">Booked</div>
      <h2 class="h-display">You're on the calendar.</h2>
      <div class="ref-code">${req.ref}</div>
      <p style="color:#5c5c5c;">A confirmation is on its way to ${req.contact.email}.</p>

      <div class="confirm-detail-card">
        ${(req.items || []).map(i => `
          <div class="row"><span>${i.qty}× ${escapeHtml(i.name)}${i.comboQty ? ` · ${i.comboQty} combo` : ""}${i.dessertQty ? ` · ${i.dessertQty} dessert` : ""}</span><span></span></div>
          ${i.notes ? `<div class="row" style="font-size:0.8rem; color:var(--steel);"><span>Request: ${escapeHtml(i.notes)}</span><span></span></div>` : ""}
        `).join("")}
        <div class="row"><span>Event date</span><span>${req.eventDate}</span></div>
        <div class="row"><span>Address</span><span>${req.eventAddress}</span></div>
        <div class="row"><span>Estimated total (before tax)</span><span>${money(req.total)}</span></div>
      </div>

      <p style="font-size:0.9rem;">Want food for yourself too? <a href="${ORDER_URL}" target="_blank" rel="noopener" style="color:var(--crust); font-weight:700;">Order now →</a></p>
      <p style="font-size:0.85rem; color:var(--steel);">Need to change anything? <a href="tel:+12165550142" style="color:var(--crust);">Call (216) 555-0142</a>.</p>

      <div class="hero-actions" style="justify-content:center;">
        <a href="#/" class="btn btn-dark">Back Home</a>
        <a href="${ORDER_URL}" target="_blank" rel="noopener" class="btn btn-secondary" style="color:var(--ink); border-color:var(--steel);">Order for Yourself</a>
      </div>
    </div>
  </section>`;
}

function viewCateringConfirmed() {
  if (!state.lastCatering) {
    location.hash = "#/catering";
    return "";
  }
  return renderCateringConfirmedDetail(state.lastCatering);
}

// ---------------- Kitchen board ----------------

function statusBadge(status) {
  return `<span class="status-badge status-${status}">${status.replace(/_/g, " ")}</span>`;
}

function adminToken() {
  try { return localStorage.getItem("csb_admin_token") || ""; } catch { return ""; }
}

function adminFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${adminToken()}` },
  });
}

function adminLogout() {
  try { localStorage.removeItem("csb_admin_token"); } catch {}
  state.kitchenAuthed = false;
  clearInterval(kitchenPollTimer);
  kitchenPollTimer = null;
}

function viewKitchen() {
  if (!state.kitchenAuthed) {
    return `
    <section style="padding-top:80px;">
      <div class="container" style="max-width:420px;">
        <h2 class="h-display">Admin Login</h2>
        <p style="color:#5c5c5c;">Authorized staff only.</p>
        <div id="kitchenLoginError"></div>
        <form id="kitchenLoginForm" class="form-card" novalidate>
          <div class="field">
            <label for="adminUser">Username</label>
            <input type="text" id="adminUser" autocomplete="username" autocapitalize="none" spellcheck="false">
          </div>
          <div class="field">
            <label for="adminPass">Password</label>
            <input type="password" id="adminPass" autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary btn-block">Log In</button>
        </form>
      </div>
    </section>`;
  }

  return `
  <section style="padding-top:40px;">
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Catering Dashboard</h2>
          <p>Every booking with full details and contact info. Updates automatically.</p>
        </div>
        <button class="btn btn-secondary" id="kitchenLogoutBtn" style="color:var(--ink); border-color:var(--steel);">Log Out</button>
      </div>
      <div id="kitchenBoard">
        <p style="color:var(--steel);">Loading…</p>
      </div>

      <div class="section-head" style="margin-top:56px;">
        <div>
          <h2 class="h-display">Catering Calendar</h2>
          <p>One event per day. Click an open day to block it manually; click a manually-blocked day to open it back up. Booked days (from real bookings) are canceled via the status dropdown above, not here.</p>
        </div>
      </div>
      <div id="kitchenCalendar">
        <p style="color:var(--steel);">Loading…</p>
      </div>
    </div>
  </section>`;
}

function fmtDateTime(iso) {
  try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return iso || ""; }
}

function renderKitchenBoard(cateringRequests, cloverEnabled) {
  const cloverLine = (record) => {
    if (!cloverEnabled) return '';
    return record.cloverSynced
      ? `<div style="color:var(--pickle); font-size:0.78rem; margin-top:8px;">✓ Synced to Clover</div>`
      : `<div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
           <span style="color:var(--crust); font-size:0.78rem;">⚠ Not synced to Clover</span>
           <button type="button" class="btn btn-dark btn-sm" data-resync-catering="${record.ref}">Retry</button>
         </div>`;
  };

  const sorted = [...cateringRequests].sort((a, b) => {
    const ca = a.status === "canceled" ? 1 : 0, cb = b.status === "canceled" ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return String(a.eventDate).localeCompare(String(b.eventDate));
  });

  const composePanel = (r) => {
    const d = state.composeDraft[r.ref] || {};
    const subject = d.subject != null ? d.subject : `Your Cleveland Smash Burgers catering — ${r.eventDate}`;
    const message = d.message != null ? d.message : `Hi ${r.contact.name.split(" ")[0]},\n\n`;
    return `
      <div class="compose-panel">
        <div class="field"><label>To</label><input type="text" value="${escapeHtml(r.contact.email)}" disabled></div>
        <div class="field"><label for="cs-${r.ref}">Subject</label><input type="text" id="cs-${r.ref}" data-compose-subject="${r.ref}" value="${escapeHtml(subject)}"></div>
        <div class="field"><label for="cm-${r.ref}">Message</label><textarea id="cm-${r.ref}" rows="6" data-compose-message="${r.ref}">${escapeHtml(message)}</textarea></div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn-primary btn-sm" data-compose-send="${r.ref}">Send Email</button>
          <button type="button" class="btn btn-secondary btn-sm" style="color:var(--ink); border-color:var(--steel);" data-compose-cancel="${r.ref}">Cancel</button>
        </div>
        <p style="font-size:0.78rem; color:var(--steel); margin:8px 0 0;">Replies go to your operations inbox.</p>
      </div>`;
  };

  const detail = (label, value) => value ? `<div class="kv"><span>${label}</span><span>${value}</span></div>` : "";

  return `
  <div>
    <h3 class="h-display" style="font-size:1.1rem; margin-bottom:14px;">Bookings (${cateringRequests.length})</h3>
    ${sorted.length === 0 ? '<p style="color:var(--steel);">No bookings yet.</p>' : sorted.map(r => `
      <div class="kitchen-card admin-card">
        <div class="kitchen-card-head">
          <strong>${escapeHtml(r.ref)}</strong> ${statusBadge(r.status)}
        </div>
        <div class="kitchen-card-body">
          <div class="admin-grid">
            <div>
              <h4>Contact</h4>
              ${detail("Name", escapeHtml(r.contact.name))}
              ${detail("Phone", `<a href="tel:${escapeHtml(r.contact.phone)}">${escapeHtml(r.contact.phone)}</a>`)}
              ${detail("Email", `<a href="mailto:${escapeHtml(r.contact.email)}">${escapeHtml(r.contact.email)}</a>`)}
            </div>
            <div>
              <h4>Event</h4>
              ${detail("Date", escapeHtml(r.eventDate))}
              ${detail("Type", escapeHtml(r.eventType))}
              ${detail("Address", escapeHtml(r.eventAddress))}
              ${detail("Budget", escapeHtml(r.budgetNote))}
              ${detail("Booked", fmtDateTime(r.createdAt))}
            </div>
          </div>

          <h4>Order — ${r.guestCount || (r.items || []).reduce((n, i) => n + i.qty, 0)} sandwiches</h4>
          <ul style="margin:0; padding-left:18px; font-size:0.9rem;">
            ${(r.items || []).map(i => `<li><strong>${i.qty}× ${escapeHtml(i.name)}</strong>${i.comboQty ? ` · ${i.comboQty} combo` : ''}${i.dessertQty ? ` · ${i.dessertQty} dessert` : ''}${i.notes ? `<br><em>Request: ${escapeHtml(i.notes)}</em>` : ''}</li>`).join('')}
          </ul>
          <div class="kv" style="margin-top:8px;"><span>Estimated total (before tax)</span><span><strong>${money(r.total || 0)}</strong></span></div>
          ${r.notes ? `<h4>Customer notes</h4><div style="font-size:0.9rem;">${escapeHtml(r.notes)}</div>` : ''}
          ${cloverLine(r)}

          ${(r.emails && r.emails.length) ? `
            <h4>Emails sent from here</h4>
            ${r.emails.map(e => `<div class="email-log"><strong>${escapeHtml(e.subject)}</strong> <span>· ${fmtDateTime(e.at)} · ${escapeHtml(e.status)}</span>
              <div style="white-space:pre-wrap; color:#444; font-size:0.85rem; margin-top:4px;">${escapeHtml(e.message)}</div></div>`).join('')}` : ''}
        </div>

        <div class="admin-actions">
          <select class="kitchen-status-select" data-catering-ref="${r.ref}">
            ${CATERING_STATUSES.map(st => `<option value="${st}" ${st === r.status ? 'selected' : ''}>${st.replace(/_/g, ' ')}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-dark btn-sm" data-compose-open="${r.ref}">✉ Email customer</button>
        </div>
        ${state.openCompose === r.ref ? composePanel(r) : ''}
      </div>
    `).join('')}
  </div>`;
}

async function attemptKitchenLogin(username, password) {
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      try { localStorage.setItem("csb_admin_token", data.token); } catch {}
      state.kitchenAuthed = true;
      render();
    } else {
      const box = document.getElementById("kitchenLoginError");
      if (box) box.innerHTML = `<div class="form-error-banner">${escapeHtml(data.error || "Incorrect username or password.")}</div>`;
    }
  } catch {
    showToast("Could not reach the server.");
  }
}

async function checkAdminSession() {
  if (!adminToken()) return false;
  try {
    const res = await adminFetch("/api/admin/session");
    return res.ok;
  } catch {
    return false;
  }
}

function startKitchenPolling() {
  clearInterval(kitchenPollTimer);
  const load = async () => {
    try {
      const [cateringRes, cloverRes, calRes] = await Promise.all([
        adminFetch("/api/catering"),
        adminFetch("/api/clover/status"),
        adminFetch("/api/catering/calendar/staff"),
      ]);
      if (cateringRes.status === 401 || calRes.status === 401) {
        adminLogout();
        render();
        return;
      }
      const cateringData = await cateringRes.json();
      const cloverData = await cloverRes.json().catch(() => ({ enabled: false }));
      const calData = await calRes.json().catch(() => ({ booked: [], blocked: [] }));

      // Don't re-render the list while someone is writing an email, or the draft would be wiped.
      const board = document.getElementById("kitchenBoard");
      const typing = state.openCompose || (board && board.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
      if (board && !typing) {
        state.cateringCache = cateringData.requests || [];
        state.cloverEnabled = Boolean(cloverData.enabled);
        board.innerHTML = renderKitchenBoard(state.cateringCache, state.cloverEnabled);
        attachKitchenStatusHandlers();
      }

      renderKitchenCalendar(calData.booked || [], calData.blocked || []);
    } catch {
      // transient network hiccup — next poll will retry
    }
  };
  state.reloadBoard = load;
  load();
  kitchenPollTimer = setInterval(load, 10000);
}

function renderKitchenCalendar(booked, blocked) {
  const el = document.getElementById("kitchenCalendar");
  if (!el) return;
  const bookedDates = booked.map(b => b.date);
  const blockedDates = blocked.map(b => b.date);

  el.innerHTML = renderCalendarMonth(state.kitchenCalYear, state.kitchenCalMonth, {
    bookedDates,
    blockedDates,
    dayAttr: "kcal-day",
  });

  el.querySelectorAll("[data-cal-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.kitchenCalMonth += Number(btn.dataset.calNav);
      if (state.kitchenCalMonth < 0) { state.kitchenCalMonth = 11; state.kitchenCalYear--; }
      if (state.kitchenCalMonth > 11) { state.kitchenCalMonth = 0; state.kitchenCalYear++; }
      renderKitchenCalendar(booked, blocked);
    });
  });

  el.querySelectorAll("[data-kcal-day]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const dateStr = btn.dataset.kcalDay;
      const bookedEntry = booked.find(b => b.date === dateStr);
      const blockedEntry = blocked.find(b => b.date === dateStr);

      if (bookedEntry) {
        showToast(`${dateStr}: booked by ${bookedEntry.name} (${bookedEntry.ref}) — cancel it via the status dropdown above to free this date.`);
        return;
      }

      if (blockedEntry) {
        await adminFetch("/api/catering/calendar/unblock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dateStr }),
        });
        showToast(`${dateStr} is open again`);
      } else {
        const reason = window.prompt(`Block ${dateStr}? Optional reason (e.g. "closed", "prepping for an event"):`, "");
        if (reason === null) return; // canceled the prompt
        await adminFetch("/api/catering/calendar/block", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dateStr, reason }),
        });
        showToast(`${dateStr} blocked`);
      }
    });
  });
}

function rerenderBoard() {
  const board = document.getElementById("kitchenBoard");
  if (!board) return;
  board.innerHTML = renderKitchenBoard(state.cateringCache || [], Boolean(state.cloverEnabled));
  attachKitchenStatusHandlers();
}

function attachKitchenStatusHandlers() {
  document.querySelectorAll("[data-catering-ref]").forEach(sel => {
    sel.addEventListener("change", async () => {
      await adminFetch(`/api/catering/${sel.dataset.cateringRef}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: sel.value }),
      });
      showToast(`${sel.dataset.cateringRef} marked ${sel.value.replace(/_/g, " ")}`);
      if (state.reloadBoard) state.reloadBoard();
    });
  });

  document.querySelectorAll("[data-compose-open]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.openCompose = btn.dataset.composeOpen;
      rerenderBoard();
      const ta = document.querySelector(`[data-compose-message="${state.openCompose}"]`);
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    });
  });
  document.querySelectorAll("[data-compose-cancel]").forEach(btn => {
    btn.addEventListener("click", () => {
      delete state.composeDraft[btn.dataset.composeCancel];
      state.openCompose = null;
      rerenderBoard();
    });
  });
  document.querySelectorAll("[data-compose-subject], [data-compose-message]").forEach(el => {
    el.addEventListener("input", () => {
      const ref = el.dataset.composeSubject || el.dataset.composeMessage;
      state.composeDraft[ref] = {
        subject: document.querySelector(`[data-compose-subject="${ref}"]`).value,
        message: document.querySelector(`[data-compose-message="${ref}"]`).value,
      };
    });
  });
  document.querySelectorAll("[data-compose-send]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ref = btn.dataset.composeSend;
      const subject = document.querySelector(`[data-compose-subject="${ref}"]`).value.trim();
      const message = document.querySelector(`[data-compose-message="${ref}"]`).value.trim();
      if (!subject || !message) { showToast("Add a subject and a message first."); return; }
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const res = await adminFetch(`/api/admin/catering/${encodeURIComponent(ref)}/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, message }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          showToast(data.simulated ? "Email logged but NOT sent — email isn't configured on the server yet." : "Email sent ✓");
          delete state.composeDraft[ref];
          state.openCompose = null;
          if (state.reloadBoard) await state.reloadBoard();
        } else {
          showToast(data.error || "Couldn't send that email.");
          btn.disabled = false;
          btn.textContent = "Send Email";
        }
      } catch {
        showToast("Couldn't reach the server.");
        btn.disabled = false;
        btn.textContent = "Send Email";
      }
    });
  });

  document.querySelectorAll("[data-resync-catering]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Syncing…";
      try {
        const res = await adminFetch(`/api/catering/${btn.dataset.resyncCatering}/resync-clover`, { method: "POST" });
        const data = await res.json();
        showToast(data.synced ? `${btn.dataset.resyncCatering} synced to Clover` : "Still couldn't reach Clover — try again shortly");
      } catch {
        showToast("Still couldn't reach Clover — try again shortly");
      }
      btn.disabled = false;
      btn.textContent = "Retry";
    });
  });
}

// ---------------- Locations ----------------

function viewLocations() {
  return `
  <section style="padding-top:40px;">
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Find Us</h2>
          <p>Come see us in Cleveland.</p>
        </div>
      </div>
      <div id="locationsList">
        <p style="color:var(--steel);">Loading…</p>
      </div>
    </div>
  </section>`;
}

function renderLocationCard(loc) {
  return `
  <div class="menu-row" style="grid-template-columns:1fr auto;">
    <div>
      <h3 style="margin:0 0 4px;">${loc.name}</h3>
      <p style="margin:0 0 4px;">${loc.address}</p>
      <p style="margin:0; color:var(--steel); font-size:0.85rem;">${loc.hours}${loc.phone ? ` · ${loc.phone}` : ''}</p>
    </div>
    <a class="btn btn-dark btn-sm" style="align-self:center;" target="_blank" rel="noopener"
       href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}">Directions</a>
  </div>`;
}

function renderLocationsList(locations) {
  const el = document.getElementById("locationsList");
  if (!el) return;
  if (locations.length === 0) {
    el.innerHTML = `<p style="color:var(--steel);">Location info isn't available right now — please call us.</p>`;
    return;
  }
  el.innerHTML = `<div class="menu-board">${locations.map(renderLocationCard).join('')}</div>`;
}

// ---------------- Calendar (shared by catering booking + kitchen board) ----------------

function dateToISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayISODate() {
  return dateToISO(new Date());
}

// Renders a single month as a click-to-select grid. opts:
//   bookedDates, blockedDates: arrays of "YYYY-MM-DD" strings, shown as taken
//   selectedDate: "YYYY-MM-DD" to highlight
//   dayAttr: the data-* attribute name used on clickable days (lets the
//     catering page and kitchen board wire up different click behavior)
//   disablePast: grays out days before today and makes them unclickable
function renderCalendarMonth(year, month, opts = {}) {
  const { bookedDates = [], blockedDates = [], selectedDate = null, dayAttr = "cal-day", disablePast = true } = opts;
  const today = todayISODate();
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  let cells = "";
  for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell cal-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isPast = disablePast && dateStr < today;
    const isBooked = bookedDates.includes(dateStr);
    const isBlocked = blockedDates.includes(dateStr);
    const isTaken = isBooked || isBlocked;
    const classes = ["cal-cell"];
    if (dateStr === today) classes.push("cal-today");
    if (dateStr === selectedDate) classes.push("cal-selected");
    if (isPast) classes.push("cal-past");
    if (isBooked) classes.push("cal-booked");
    if (isBlocked) classes.push("cal-blocked");
    const clickable = !isPast;
    cells += clickable
      ? `<button type="button" class="${classes.join(' ')}" data-${dayAttr}="${dateStr}">${d}</button>`
      : `<div class="${classes.join(' ')}">${d}</div>`;
  }

  return `
  <div class="calendar">
    <div class="calendar-head">
      <button type="button" class="btn btn-dark btn-sm" data-cal-nav="-1">‹</button>
      <span>${monthLabel}</span>
      <button type="button" class="btn btn-dark btn-sm" data-cal-nav="1">›</button>
    </div>
    <div class="calendar-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
    <div class="calendar-grid">${cells}</div>
    <div class="calendar-legend">
      <span><i class="cal-dot cal-dot-booked"></i> Booked</span>
      <span><i class="cal-dot cal-dot-blocked"></i> Unavailable</span>
    </div>
  </div>`;
}

// ---------------- Render ----------------

function render() {
  const route = currentRoute();

  if (route !== "kitchen" && kitchenPollTimer) {
    clearInterval(kitchenPollTimer);
    kitchenPollTimer = null;
  }

  let body = "";
  switch (route) {
    case "home": body = viewHome(); break;
    case "catering": body = viewCatering(); break;
    case "locations": body = viewLocations(); break;
    case "catering-confirmed": body = viewCateringConfirmed(); break;
    case "kitchen": body = viewKitchen(); break;
    default: body = viewHome();
  }
  // The private admin page gets no public nav/footer.
  document.getElementById("app").innerHTML = isAdminPath()
    ? `<header class="nav"><div class="nav-inner"><span class="brand-word" style="color:#fff;">CLEVELAND<span>&nbsp;SMASH&nbsp;BURGERS</span> <span style="font-size:0.7rem; opacity:0.7;">· ADMIN</span></span></div></header>` + body
    : nav() + body + footer();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  attachHandlers(route);
}

function attachHandlers(route) {
  ["installNavBtn", "installFooterBtn", "installInlineBtn"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", (e) => { e.preventDefault(); triggerInstall(); });
  });

  if (route === "locations") {
    fetch("/api/locations")
      .then(r => r.json())
      .then(data => renderLocationsList(data.locations && data.locations.length ? data.locations : state.locations))
      .catch(() => renderLocationsList(state.locations));
  }

  if (route === "kitchen") {
    const logoutBtn = document.getElementById("kitchenLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        adminLogout();
        render();
      });
    }

    const loginForm = document.getElementById("kitchenLoginForm");
    if (loginForm) {
      // Already have a valid session from earlier? Go straight in.
      checkAdminSession().then((ok) => {
        if (ok && currentRoute() === "kitchen" && !state.kitchenAuthed) {
          state.kitchenAuthed = true;
          render();
        }
      });
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        attemptKitchenLogin(document.getElementById("adminUser").value.trim(), document.getElementById("adminPass").value);
      });
    } else {
      startKitchenPolling();
    }
  }

  if (route === "catering") {
    const menu = state.cateringMenu;
    const qtys = {};
    menu.sandwiches.forEach(m => { qtys[m.id] = { qty: 0, combo: 0, dessert: 0 }; });

    const orderTotal = () => menu.sandwiches.reduce((sum, m) => {
      const q = qtys[m.id];
      return sum + m.price * q.qty + menu.comboUpgrade.price * q.combo + menu.dessertAddOn.price * q.dessert;
    }, 0);

    const updateTotal = () => {
      menu.sandwiches.forEach(m => {
        ["qty", "combo", "dessert"].forEach(k => {
          const el = document.getElementById(`cq-${k}-${m.id}`);
          if (el) el.textContent = qtys[m.id][k];
        });
      });
      const count = menu.sandwiches.reduce((n, m) => n + qtys[m.id].qty, 0);
      const min = menu.minimum || 10;
      const countEl = document.getElementById("cCountPreview");
      countEl.textContent = count >= min ? `${count} ✓` : `${count} / ${min} minimum`;
      countEl.style.color = count >= min ? "var(--pickle)" : "var(--crust)";
      document.getElementById("cTotalPreview").textContent = money(orderTotal());
      document.getElementById("cSubmitTotal").textContent = money(orderTotal());
    };

    const bump = (attr, delta) => {
      const [kind, id] = attr.split(":");
      const q = qtys[id];
      if (!q) return;
      q[kind] = Math.max(0, Math.min(500, q[kind] + delta));
      // combos and desserts can't exceed the number of sandwiches
      if (kind === "qty") { q.combo = Math.min(q.combo, q.qty); q.dessert = Math.min(q.dessert, q.qty); }
      else q[kind] = Math.min(q[kind], q.qty);
      updateTotal();
    };
    document.querySelectorAll("[data-cqty-up]").forEach(b => b.addEventListener("click", () => bump(b.dataset.cqtyUp, 1)));
    document.querySelectorAll("[data-cqty-down]").forEach(b => b.addEventListener("click", () => bump(b.dataset.cqtyDown, -1)));
    updateTotal();

    let calYear = new Date().getFullYear();
    let calMonth = new Date().getMonth();
    let calBooked = [];
    let calBlocked = [];

    const selectDate = (dateStr) => {
      document.getElementById("cDate").value = dateStr;
      const label = new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      document.getElementById("cDateSelected").textContent = `Selected: ${label}`;
    };

    const renderCal = () => {
      const el = document.getElementById("cDateCalendar");
      if (!el) return;
      el.innerHTML = renderCalendarMonth(calYear, calMonth, {
        bookedDates: calBooked,
        blockedDates: calBlocked,
        selectedDate: document.getElementById("cDate").value,
      });
      el.querySelectorAll("[data-cal-nav]").forEach(btn => {
        btn.addEventListener("click", () => {
          calMonth += Number(btn.dataset.calNav);
          if (calMonth < 0) { calMonth = 11; calYear--; }
          if (calMonth > 11) { calMonth = 0; calYear++; }
          renderCal();
        });
      });
      el.querySelectorAll("[data-cal-day]").forEach(btn => {
        btn.addEventListener("click", () => {
          selectDate(btn.dataset.calDay);
          renderCal();
        });
      });
    };

    fetch("/api/catering/calendar")
      .then(r => r.json())
      .then(data => {
        calBooked = data.bookedDates || [];
        calBlocked = data.blockedDates || [];
        renderCal();
      })
      .catch(() => {
        // Calendar unavailable — fall back to a plain date picker so
        // booking still works, just without the visual availability.
        const el = document.getElementById("cDateCalendar");
        if (el) {
          el.innerHTML = `
            <p style="color:var(--steel); margin-bottom:8px;">Couldn't load the calendar — pick a date and we'll confirm availability when you submit.</p>
            <input type="date" id="cDateFallback">`;
          document.getElementById("cDateFallback").addEventListener("change", (e) => selectDate(e.target.value));
        }
      });

    document.getElementById("cateringForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorBox = document.getElementById("cateringError");
      errorBox.innerHTML = "";

      const payload = {
        items: menu.sandwiches
          .filter(m => qtys[m.id].qty > 0)
          .map(m => ({
            id: m.id,
            qty: qtys[m.id].qty,
            comboQty: qtys[m.id].combo,
            dessertQty: qtys[m.id].dessert,
            notes: document.getElementById(`cnote-${m.id}`).value.trim(),
          })),
        eventDate: document.getElementById("cDate").value,
        eventType: document.getElementById("cType").value,
        eventAddress: document.getElementById("cAddress").value.trim(),
        budgetNote: document.getElementById("cBudget").value.trim(),
        notes: document.getElementById("cNotes").value.trim(),
        contact: {
          name: document.getElementById("cName").value.trim(),
          phone: document.getElementById("cPhone").value.trim(),
          email: document.getElementById("cEmail").value.trim(),
        },
      };

      const totalSandwiches = payload.items.reduce((n, i) => n + i.qty, 0);
      const minSandwiches = menu.minimum || 10;
      if (totalSandwiches < minSandwiches) {
        errorBox.innerHTML = `<div class="form-error-banner">Catering has a ${minSandwiches}-person minimum — please add ${minSandwiches - totalSandwiches} more sandwich${minSandwiches - totalSandwiches === 1 ? "" : "es"}.</div>`;
        errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (!payload.eventDate || !payload.eventAddress) {
        errorBox.innerHTML = `<div class="form-error-banner">Event date and address are required.</div>`;
        return;
      }
      if (!payload.contact.name || !payload.contact.phone || !payload.contact.email) {
        errorBox.innerHTML = `<div class="form-error-banner">Please fill in your name, phone, and email.</div>`;
        return;
      }

      const submitBtn = e.target.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "Booking…";

      try {
        const res = await fetch("/api/catering", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong.");

        state.lastCatering = data.request;
        sessionStorage.setItem("csb_last_catering", JSON.stringify(data.request));
        location.hash = `#/catering-confirmed?ref=${data.request.ref}`;
      } catch (err) {
        errorBox.innerHTML = `<div class="form-error-banner">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Book This Event — est. ${document.getElementById("cSubmitTotal").textContent}`;
        // If someone else just took this date, refresh the calendar so
        // it shows as taken instead of leaving it looking available.
        if (err.message.toLowerCase().includes("already booked")) {
          fetch("/api/catering/calendar")
            .then(r => r.json())
            .then(data => {
              calBooked = data.bookedDates || [];
              calBlocked = data.blockedDates || [];
              renderCal();
            })
            .catch(() => {});
        }
      }
    });
  }

}

// ---------------- PWA install ----------------

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
  });
  window.addEventListener("appinstalled", () => {
    showToast("Installed! Find it on your home screen.");
    state.deferredInstallPrompt = null;
  });
}

async function triggerInstall() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    return;
  }
  // Browser didn't fire beforeinstallprompt (iOS Safari, or already installed)
  openInstallModal();
}

function openInstallModal() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" aria-label="Close">&times;</button>
      <h3 class="h-display" style="margin-top:0;">Install the App</h3>
      ${isIOS ? `
        <p>On iPhone: tap the <strong>Share</strong> icon in Safari, then <strong>Add to Home Screen</strong>. It'll open full-screen from your home screen, just like an app.</p>
      ` : `
        <p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>. It'll launch full-screen with its own icon — no app store needed.</p>
      `}
    </div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.classList.contains("modal-close")) overlay.remove();
  });
  document.body.appendChild(overlay);
}
