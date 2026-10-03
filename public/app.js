// Cleveland Smash Burgers — frontend app
// Plain JS, no framework, no build step. Hash-based router with a handful of views.

const FALLBACK_MENU = [
  { id: "single-smash", name: "Single Smash", price: 7.5, desc: "One smashed patty, American cheese, grilled onion, pickles, CSB sauce on a griddled bun." },
  { id: "double-smash", name: "Double Smash", price: 10.5, desc: "Two smashed patties, double American cheese, grilled onion, pickles, CSB sauce." },
  { id: "triple-smash", name: "Triple Smash", price: 13.5, desc: "Three patties for the truly committed. Same fixings, more char." },
  { id: "the-flats", name: "The Flats", price: 12, desc: "Double smash, bacon, cheddar, crispy onion straws, smoky BBQ sauce." },
  { id: "ohio-city", name: "Ohio City Veggie", price: 10, desc: "House-smashed black bean & mushroom patty, American cheese, pickles, CSB sauce." },
  { id: "smash-fries", name: "Smash Fries", price: 4.5, desc: "Griddle-crisped fries, house seasoning." },
  { id: "cheese-fries", name: "Loaded Cheese Fries", price: 6.5, desc: "Fries, warm cheese sauce, grilled onion, pickled jalapeño." },
  { id: "shake", name: "Hand-Spun Shake", price: 6, desc: "Vanilla, chocolate, or malt. Ask about the seasonal flavor." },
];

const FALLBACK_CATERING_PACKAGES = [
  { id: "office-lunch", name: "Office Lunch", pricePerPerson: 14, minHeadcount: 10, description: "Smash sliders, fries, and a house salad — dropped off ready to serve.", includes: ["Single-smash sliders", "Smash fries", "House salad", "Plates, napkins, utensils"] },
  { id: "backyard-griddle", name: "Backyard Griddle", pricePerPerson: 19, minHeadcount: 20, description: "A build-your-own smash bar, cooked fresh on-site off the truck.", includes: ["Made-to-order smash burgers on-site", "Two sides", "Hand-spun shakes", "1.5 hours of service"] },
  { id: "premium-event", name: "Premium Event", pricePerPerson: 26, minHeadcount: 30, description: "Full-service catering for weddings, corporate events, and larger parties.", includes: ["Full on-site griddle service", "Two sides + shakes", "Staff for up to 3 hours", "Custom signage with your event name"] },
];

const FALLBACK_LOCATIONS = [
  { id: "parma", name: "Parma", address: "6164 Broadview Rd, Parma, OH 44134", hours: "12:00 PM – 9:30 PM daily", phone: "(216) 555-0142" },
  { id: "cleveland", name: "Cleveland", address: "3915 Carnegie Ave, Cleveland, OH 44115", hours: "12:00 PM – 9:30 PM daily", phone: "(216) 555-0142" },
  { id: "garfield-heights", name: "Garfield Heights", address: "4545 E. 131st St, Garfield Heights, OH 44105", hours: "12:00 PM – 9:30 PM daily", phone: "(216) 555-0142" },
];

const state = {
  menu: FALLBACK_MENU,
  cateringPackages: FALLBACK_CATERING_PACKAGES,
  locations: FALLBACK_LOCATIONS,
  cart: JSON.parse(localStorage.getItem("csb_cart") || "[]"),
  lastOrder: JSON.parse(sessionStorage.getItem("csb_last_order") || "null"),
  lastCatering: JSON.parse(sessionStorage.getItem("csb_last_catering") || "null"),
  fulfillment: "pickup",
  deferredInstallPrompt: null,
  kitchenAuthed: false,
  kitchenCalYear: new Date().getFullYear(),
  kitchenCalMonth: new Date().getMonth(),
  stripeEnabled: false,
  stripePublishableKey: "",
};

const ORDER_STATUSES = ["pending_payment", "received", "in_progress", "ready", "completed", "canceled"];
const CATERING_STATUSES = ["pending_payment", "booked", "in_progress", "completed", "canceled"];
let kitchenPollTimer = null;

function saveCart() {
  localStorage.setItem("csb_cart", JSON.stringify(state.cart));
}

function money(n) {
  return `$${n.toFixed(2)}`;
}

function cartCount() {
  return state.cart.reduce((n, i) => n + i.qty, 0);
}

function cartSubtotal() {
  return state.cart.reduce((sum, i) => {
    const item = state.menu.find((m) => m.id === i.id);
    return sum + (item ? item.price * i.qty : 0);
  }, 0);
}

function addToCart(id) {
  const existing = state.cart.find((i) => i.id === id);
  if (existing) existing.qty += 1;
  else state.cart.push({ id, qty: 1 });
  saveCart();
  showToast("Added to your order");
  render();
}

function changeQty(id, delta) {
  const line = state.cart.find((i) => i.id === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) state.cart = state.cart.filter((i) => i.id !== id);
  saveCart();
  render();
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

// Mounts Stripe's Embedded Checkout (card entry, Apple Pay, Google Pay)
// directly into a container on the current page — the customer never
// leaves the site. formEl is hidden while the payment form is shown; if
// something goes wrong before Stripe's iframe takes over, we bring the
// form back so the customer isn't stuck looking at a blank page.
async function mountEmbeddedCheckout(clientSecret, containerId, formEl) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!window.Stripe) {
    showToast("Payment form couldn't load — please try again.");
    return;
  }
  if (!state.stripePublishableKey) {
    showToast("Payment isn't fully configured yet — please try again shortly.");
    return;
  }

  try {
    if (formEl) formEl.style.display = "none";
    container.style.display = "block";
    container.innerHTML = `<p style="color:var(--steel); padding:20px 0;">Loading payment form…</p>`;

    const stripe = window.Stripe(state.stripePublishableKey);
    const checkout = await stripe.initEmbeddedCheckout({
      fetchClientSecret: () => Promise.resolve(clientSecret),
    });
    container.innerHTML = "";
    checkout.mount(`#${containerId}`);
  } catch (err) {
    container.style.display = "none";
    if (formEl) formEl.style.display = "";
    showToast("Couldn't load the payment form — please try again.");
  }
}

// ---------------- Router ----------------

function currentRoute() {
  const raw = (location.hash || "#/").replace("#", "").replace(/^\//, "");
  return raw.split("?")[0] || "home";
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
    const res = await fetch("/api/menu");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length) state.menu = data.items;
    }
  } catch {
    // offline or API not running yet — fallback menu already in state
  }
  try {
    const res = await fetch("/api/catering/packages");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.packages) && data.packages.length) state.cateringPackages = data.packages;
    }
  } catch {
    // offline or API not running yet — fallback packages already in state
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
  try {
    const res = await fetch("/api/stripe-config");
    if (res.ok) {
      const data = await res.json();
      state.stripeEnabled = Boolean(data.enabled);
      state.stripePublishableKey = data.publishableKey || "";
    }
  } catch {
    // offline or API not running yet — stays disabled, test-mode flow still works
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
        ${link('#/order', 'Order')}
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
          <p>2140 Lorain Ave<br>Cleveland, OH 44113<br>Tue–Sun, 11am–9pm</p>
        </div>
        <div>
          <h4>Connect</h4>
          <p><a href="tel:+12165550142">(216) 555-0142</a><br>
          <a href="#/order">Start an order →</a></p>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} Cleveland Smash Burgers. Prototype build.</span>
        <span>
          <a href="#" id="installFooterBtn" style="color:var(--mustard);">Install the app</a>
          &nbsp;·&nbsp;
          <a href="#/kitchen" style="color:var(--steel);">Kitchen (staff)</a>
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
          <a href="#/order" class="btn btn-primary">Order Now</a>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Visit Us</h2>
          <p>Three locations around Cleveland.</p>
        </div>
        <a href="#/locations" class="btn btn-dark">All Locations</a>
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
        <div class="qr">SCAN OR TAP INSTALL</div>
        <div>
          <p style="margin:0 0 10px; font-size:0.95rem; color:#5c5c5c;">This site installs like a native app right from your browser: tap <strong>Get the App</strong> above, or use your browser's "Add to Home Screen" option. It'll launch full-screen with an icon on your home screen — no App Store or Play Store listing yet.</p>
          <button class="btn btn-dark" id="installInlineBtn">Install the App</button>
        </div>
      </div>
    </div>
  </section>`;
}

function stepper(activeIndex) {
  const steps = ["Menu", "Details", "Confirmed"];
  return `<div class="stepper">
    ${steps.map((label, i) => `
      <div class="step ${i < activeIndex ? 'done' : ''} ${i === activeIndex ? 'active' : ''}">
        <span class="dot">${i < activeIndex ? '✓' : i + 1}</span>
        <span>${label}</span>
      </div>
      ${i < steps.length - 1 ? '<span class="sep">—</span>' : ''}
    `).join('')}
  </div>`;
}

function viewOrder() {
  return `
  <section style="padding-top:40px;">
    <div class="container">
      ${stepper(0)}
      <div class="order-layout">
        <div>
          <div class="section-head">
            <div>
              <h2 class="h-display">Build your order</h2>
              <p>Tap the + to add something to your ticket. Everything's made fresh once you place the order.</p>
            </div>
          </div>

          <div class="menu-board">
            ${state.menu.map(item => `
              <div class="menu-row">
                <div>
                  <h3>${item.name}</h3>
                  <p>${item.desc}</p>
                </div>
                <div class="menu-price">${money(item.price)}</div>
                <button class="menu-add" data-add="${item.id}" aria-label="Add ${item.name} to order">+</button>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="ticket-col">
          ${ticket()}
        </div>
      </div>
    </div>
  </section>`;
}

function ticket(opts = {}) {
  const showCheckoutBtn = opts.showCheckoutBtn !== false;
  const subtotal = cartSubtotal();
  const tax = subtotal * 0.08;
  const total = subtotal + tax;
  return `
  <div class="ticket">
    <div class="ticket-head">
      <div class="kicker">Order Ticket</div>
      <h3>${cartCount()} item${cartCount() === 1 ? '' : 's'}</h3>
    </div>
    <div class="ticket-body">
      ${state.cart.length === 0 ? `<div class="ticket-empty">Nothing on the ticket yet.<br>Add something from the menu.</div>` : state.cart.map(line => {
        const item = state.menu.find(m => m.id === line.id);
        if (!item) return '';
        return `
        <div class="ticket-line">
          <div>
            <div class="name">${item.name}</div>
            <div class="qty-controls">
              <button class="qty-btn" data-qty-down="${item.id}" aria-label="Remove one ${item.name}">–</button>
              <span>${line.qty}</span>
              <button class="qty-btn" data-qty-up="${item.id}" aria-label="Add one ${item.name}">+</button>
            </div>
          </div>
          <div>${money(item.price * line.qty)}</div>
        </div>`;
      }).join('')}
    </div>
    ${state.cart.length > 0 ? `
    <div class="ticket-totals">
      <div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="row"><span>Est. tax</span><span>${money(tax)}</span></div>
      <div class="row total"><span>Est. total</span><span>${money(total)}</span></div>
      <div class="row" style="font-size:0.78rem; color:var(--steel);"><span>Final tax calculated at checkout</span></div>
    </div>
    ${showCheckoutBtn ? `
    <div class="ticket-actions">
      <a href="#/checkout" class="btn btn-primary btn-block">Continue to Details</a>
    </div>` : ''}
    ` : ''}
  </div>`;
}

function viewCheckout() {
  if (state.cart.length === 0) {
    location.hash = "#/order";
    return "";
  }
  return `
  <section style="padding-top:40px;">
    <div class="container">
      ${stepper(1)}
      <div class="order-layout">
        <div>
          <div class="section-head">
            <div>
              <h2 class="h-display">Pickup details</h2>
              <p>We'll have your order ready at the counter — no delivery yet, just fast pickup.</p>
            </div>
          </div>

          <div id="checkoutError"></div>

          <form id="checkoutForm" class="form-card" novalidate>
            <div class="field">
              <label for="pickupLocation">Pickup location</label>
              <select id="pickupLocation" required>
                <option value="" disabled selected>Choose a location…</option>
                ${state.locations.map(loc => `<option value="${loc.id}">${loc.name} — ${loc.address}</option>`).join('')}
              </select>
            </div>

            <div class="fulfil-toggle">
              <button type="button" class="active" data-fulfil="pickup">Pickup — ~15 min</button>
              <button type="button" data-fulfil="later">Schedule for later today</button>
            </div>

            <div id="scheduleField" style="display:none;" class="field">
              <label for="pickupTime">Pickup time</label>
              <input type="time" id="pickupTime" name="pickupTime">
            </div>

            <div class="field-row">
              <div class="field">
                <label for="name">Full name</label>
                <input type="text" id="name" name="name" required placeholder="Jordan Smith">
              </div>
              <div class="field">
                <label for="phone">Phone</label>
                <input type="tel" id="phone" name="phone" required placeholder="(216) 555-0100">
              </div>
            </div>

            <div class="field">
              <label for="email">Email <span class="hint">(optional — for a receipt)</span></label>
              <input type="email" id="email" name="email" placeholder="you@example.com">
            </div>

            <div class="field">
              <label for="notes">Order notes <span class="hint">(allergies, no onions, etc.)</span></label>
              <textarea id="notes" name="notes" placeholder="Anything the kitchen should know"></textarea>
            </div>

            <button type="submit" class="btn btn-primary btn-block">Place Order — ~${money(cartSubtotal() * 1.08)}</button>
          </form>

          <div id="stripeCheckoutContainer" style="display:none; margin-top:20px;"></div>
        </div>
        <div class="ticket-col">
          ${ticket({ showCheckoutBtn: false })}
        </div>
      </div>
    </div>
  </section>`;
}

function viewOrderConfirmed() {
  const query = currentQuery();
  const sessionId = query.get("session_id");
  const ref = query.get("ref");

  // Came back from Stripe's hosted checkout — we need to verify the
  // payment server-side before we can show a confirmation.
  if (sessionId && ref) {
    if (state.lastOrder && state.lastOrder.ref === ref && state.lastOrder.paid) {
      return renderOrderConfirmedDetail(state.lastOrder);
    }
    return `
    <section style="padding-top:80px;">
      <div class="container confirm-wrap">
        <p style="color:#5c5c5c;">Confirming your payment…</p>
      </div>
    </section>`;
  }

  if (!state.lastOrder) {
    location.hash = "#/order";
    return "";
  }
  return renderOrderConfirmedDetail(state.lastOrder);
}

function renderOrderConfirmedDetail(order) {
  return `
  <section style="padding-top:56px;">
    <div class="container confirm-wrap">
      ${stepper(2)}
      <div class="stamp">Order Received</div>
      <h2 class="h-display">We're firing up the griddle.</h2>
      <div class="ref-code">${order.ref}</div>
      <p style="color:#5c5c5c;">Show this code at the counter. We'll text ${order.customer.phone} if anything changes.</p>

      <div class="confirm-detail-card">
        <div class="row"><span>Name</span><span>${order.customer.name}</span></div>
        ${order.location ? `<div class="row"><span>Pickup at</span><span>${order.location.name} — ${order.location.address}</span></div>` : ''}
        <div class="row"><span>Items</span><span>${order.items.reduce((n,i)=>n+i.qty,0)}</span></div>
        <div class="row"><span>Fulfillment</span><span>${order.fulfillment === 'pickup' ? 'Pickup ASAP (~15 min)' : 'Scheduled pickup'}</span></div>
        <div class="row"><span>Total</span><span>${money(order.total)}</span></div>
      </div>

      <div class="hero-actions" style="justify-content:center;">
        <a href="#/order" class="btn btn-dark">Order Again</a>
        <a href="#/" class="btn btn-secondary" style="color:var(--ink); border-color:var(--steel);">Back Home</a>
      </div>
    </div>
  </section>`;
}

function viewCatering() {
  const packages = state.cateringPackages;
  return `
  <section class="catering-hero">
    <div class="container">
      <div class="eyebrow" style="color:#f7d9da;">CATERING</div>
      <h1 class="h-display">FEEDING THE CROWD.</h1>
      <p>Fixed-price packages, booked and paid online in a few minutes. Pick a package, tell us the headcount and date, and you're on the calendar.</p>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Pick a Package</h2>
          <p>Each package is a flat price per person — the only things that change are headcount, date, and event type.</p>
        </div>
      </div>
      <div class="pkg-grid">
        ${packages.map(p => `
          <div class="pkg-card">
            <div class="pkg-name">${p.name}</div>
            <div class="pkg-price">$${p.pricePerPerson} / person</div>
            <p style="margin:0; font-size:0.88rem; color:#5c5c5c;">${p.description}</p>
            <ul>${p.includes.map(f => `<li>${f}</li>`).join('')}</ul>
            <p style="margin:0; font-size:0.8rem; color:var(--steel);">Minimum ${p.minHeadcount} guests</p>
            <a href="#/catering-book?package=${p.id}" class="btn btn-primary btn-block">Book This Package</a>
          </div>
        `).join('')}
      </div>

      <p style="text-align:center; font-size:0.88rem; color:var(--steel); max-width:60ch; margin:8px auto 0;">
        Having trouble booking, or need something outside these packages?
        <a href="tel:+12165550142" style="color:var(--crust);">Call (216) 555-0142</a> — we're happy to help.
      </p>
    </div>
  </section>`;
}

function viewCateringBook() {
  const query = currentQuery();
  const pkg = state.cateringPackages.find(p => p.id === query.get("package"));
  if (!pkg) {
    location.hash = "#/catering";
    return "";
  }
  return `
  <section style="padding-top:40px;">
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Book: ${pkg.name}</h2>
          <p>$${pkg.pricePerPerson} per person · minimum ${pkg.minHeadcount} guests. Food is fixed for this package — just tell us the details below.</p>
        </div>
      </div>

      <div id="cateringError"></div>

      <form id="cateringForm" class="form-card" style="max-width:640px;" novalidate>
        <input type="hidden" id="cPackageId" value="${pkg.id}">

        <div class="field">
          <label for="cHeadcount">Headcount <span class="hint">(minimum ${pkg.minHeadcount})</span></label>
          <input type="number" id="cHeadcount" min="${pkg.minHeadcount}" required value="${pkg.minHeadcount}">
        </div>

        <div class="confirm-detail-card" style="margin:0 0 20px;">
          <div class="row"><span>${pkg.name} × <span id="cHeadcountEcho">${pkg.minHeadcount}</span> guests</span><span id="cTotalPreview">$${(pkg.pricePerPerson * pkg.minHeadcount).toFixed(2)}</span></div>
          <div class="row" style="font-size:0.78rem; color:var(--steel);"><span>Tax calculated at checkout, added on top</span></div>
        </div>

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
          <input type="text" id="cAddress" required placeholder="Where should we set up?">
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
          <label for="cBudget">Budget notes <span class="hint">(optional — doesn't change the price above, just context for us)</span></label>
          <input type="text" id="cBudget" placeholder="e.g. flexible, or tied to a specific budget">
        </div>
        <div class="field">
          <label for="cNotes">Anything else we should know? <span class="hint">(optional)</span></label>
          <textarea id="cNotes" placeholder="Parking, timing, dietary notes, etc."></textarea>
        </div>

        <button type="submit" class="btn btn-primary btn-block">Book &amp; Pay — ~<span id="cSubmitTotal">$${(pkg.pricePerPerson * pkg.minHeadcount).toFixed(2)}</span></button>
      </form>

      <div id="stripeCheckoutContainer" style="display:none; margin-top:20px;"></div>

      <p style="margin-top:14px; font-size:0.85rem; color:var(--steel);">
        Trouble with this booking? <a href="tel:+12165550142" style="color:var(--crust);">Call (216) 555-0142</a> and we'll sort it out.
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
        <div class="row"><span>Package</span><span>${req.package.name}</span></div>
        <div class="row"><span>Headcount</span><span>${req.headcount}</span></div>
        <div class="row"><span>Event date</span><span>${req.eventDate}</span></div>
        <div class="row"><span>Address</span><span>${req.eventAddress}</span></div>
        <div class="row"><span>Total</span><span>${money(req.total)}</span></div>
      </div>

      <p style="font-size:0.85rem; color:var(--steel);">Need to change anything? <a href="tel:+12165550142" style="color:var(--crust);">Call (216) 555-0142</a>.</p>

      <div class="hero-actions" style="justify-content:center;">
        <a href="#/" class="btn btn-dark">Back Home</a>
        <a href="#/order" class="btn btn-secondary" style="color:var(--ink); border-color:var(--steel);">Order for Yourself</a>
      </div>
    </div>
  </section>`;
}

function viewCateringConfirmed() {
  const query = currentQuery();
  const sessionId = query.get("session_id");
  const ref = query.get("ref");

  if (sessionId && ref) {
    if (state.lastCatering && state.lastCatering.ref === ref && state.lastCatering.paid) {
      return renderCateringConfirmedDetail(state.lastCatering);
    }
    return `
    <section style="padding-top:80px;">
      <div class="container confirm-wrap">
        <p style="color:#5c5c5c;">Confirming your payment…</p>
      </div>
    </section>`;
  }

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

function viewKitchen() {
  if (!state.kitchenAuthed) {
    return `
    <section style="padding-top:80px;">
      <div class="container" style="max-width:420px;">
        <h2 class="h-display">Kitchen Login</h2>
        <p style="color:#5c5c5c;">Staff only — enter the kitchen passcode to view live orders and catering requests.</p>
        <div id="kitchenLoginError"></div>
        <form id="kitchenLoginForm" class="form-card" novalidate>
          <div class="field">
            <label for="kitchenPasscode">Passcode</label>
            <input type="password" id="kitchenPasscode" autocomplete="off">
          </div>
          <button type="submit" class="btn btn-primary btn-block">Enter</button>
        </form>
      </div>
    </section>`;
  }

  return `
  <section style="padding-top:40px;">
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Kitchen Board</h2>
          <p>Live orders and catering requests — refreshes every few seconds.</p>
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

function renderKitchenBoard(orders, cateringRequests, cloverEnabled) {
  const cloverLine = (record, kind) => {
    if (!cloverEnabled) return '';
    return record.cloverSynced
      ? `<div style="color:var(--pickle); font-size:0.78rem; margin-top:4px;">✓ Synced to Clover</div>`
      : `<div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
           <span style="color:var(--crust); font-size:0.78rem;">⚠ Not synced to Clover</span>
           <button type="button" class="btn btn-dark btn-sm" data-resync-${kind}="${record.ref}">Retry</button>
         </div>`;
  };

  return `
  <div class="kitchen-grid">
    <div>
      <h3 class="h-display" style="font-size:1.1rem; margin-bottom:14px;">Orders (${orders.length})</h3>
      ${orders.length === 0 ? '<p style="color:var(--steel);">No orders yet.</p>' : orders.map(o => `
        <div class="kitchen-card">
          <div class="kitchen-card-head">
            <strong>${o.ref}</strong> ${statusBadge(o.status)}
          </div>
          <div class="kitchen-card-body">
            ${o.location ? `<div style="font-weight:700; color:var(--crust);">${o.location.name}</div>` : ''}
            <div>${o.customer.name} · ${o.customer.phone}</div>
            <div>${o.items.reduce((n,i)=>n+i.qty,0)} items · ${money(o.total)}</div>
            <div style="color:var(--steel); font-size:0.8rem;">${new Date(o.createdAt).toLocaleString()}</div>
            ${cloverLine(o, 'order')}
          </div>
          <select class="kitchen-status-select" data-order-ref="${o.ref}">
            ${ORDER_STATUSES.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
      `).join('')}
    </div>
    <div>
      <h3 class="h-display" style="font-size:1.1rem; margin-bottom:14px;">Catering (${cateringRequests.length})</h3>
      ${cateringRequests.length === 0 ? '<p style="color:var(--steel);">No requests yet.</p>' : cateringRequests.map(r => `
        <div class="kitchen-card">
          <div class="kitchen-card-head">
            <strong>${r.ref}</strong> ${statusBadge(r.status)}
          </div>
          <div class="kitchen-card-body">
            <div>${r.package ? r.package.name : ''} · ${r.contact.name} · ${r.contact.phone}</div>
            <div>${r.headcount} guests · ${r.eventDate} · ${money(r.total || 0)}</div>
            <div style="color:var(--steel); font-size:0.8rem;">${r.eventType}${r.eventAddress ? ` · ${r.eventAddress}` : ''}</div>
            ${cloverLine(r, 'catering')}
          </div>
          <select class="kitchen-status-select" data-catering-ref="${r.ref}">
            ${CATERING_STATUSES.map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
      `).join('')}
    </div>
  </div>`;
}

async function attemptKitchenLogin(passcode, silent) {
  try {
    const res = await fetch("/api/kitchen/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const data = await res.json();
    if (data.ok) {
      state.kitchenAuthed = true;
      if (passcode) localStorage.setItem("csb_kitchen_passcode", passcode);
      render();
    } else if (!silent) {
      const box = document.getElementById("kitchenLoginError");
      if (box) box.innerHTML = `<div class="form-error-banner">${data.error || "Incorrect passcode."}</div>`;
    }
  } catch {
    if (!silent) showToast("Could not reach the server.");
  }
}

function startKitchenPolling() {
  clearInterval(kitchenPollTimer);
  const load = async () => {
    const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
    try {
      const [ordersRes, cateringRes, cloverRes, calRes] = await Promise.all([
        fetch("/api/orders", { headers: { "x-kitchen-passcode": passcode } }),
        fetch("/api/catering", { headers: { "x-kitchen-passcode": passcode } }),
        fetch("/api/clover/status", { headers: { "x-kitchen-passcode": passcode } }),
        fetch("/api/catering/calendar/staff", { headers: { "x-kitchen-passcode": passcode } }),
      ]);
      if (ordersRes.status === 401 || cateringRes.status === 401 || calRes.status === 401) {
        state.kitchenAuthed = false;
        clearInterval(kitchenPollTimer);
        render();
        return;
      }
      const ordersData = await ordersRes.json();
      const cateringData = await cateringRes.json();
      const cloverData = await cloverRes.json().catch(() => ({ enabled: false }));
      const calData = await calRes.json().catch(() => ({ booked: [], blocked: [] }));

      const board = document.getElementById("kitchenBoard");
      if (board) board.innerHTML = renderKitchenBoard(ordersData.orders || [], cateringData.requests || [], Boolean(cloverData.enabled));
      attachKitchenStatusHandlers();

      renderKitchenCalendar(calData.booked || [], calData.blocked || []);
    } catch {
      // transient network hiccup — next poll will retry
    }
  };
  load();
  kitchenPollTimer = setInterval(load, 5000);
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
      const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
      const bookedEntry = booked.find(b => b.date === dateStr);
      const blockedEntry = blocked.find(b => b.date === dateStr);

      if (bookedEntry) {
        showToast(`${dateStr}: booked by ${bookedEntry.name} (${bookedEntry.ref}) — cancel it via the status dropdown above to free this date.`);
        return;
      }

      if (blockedEntry) {
        await fetch("/api/catering/calendar/unblock", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kitchen-passcode": passcode },
          body: JSON.stringify({ date: dateStr }),
        });
        showToast(`${dateStr} is open again`);
      } else {
        const reason = window.prompt(`Block ${dateStr}? Optional reason (e.g. "closed", "prepping for an event"):`, "");
        if (reason === null) return; // canceled the prompt
        await fetch("/api/catering/calendar/block", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kitchen-passcode": passcode },
          body: JSON.stringify({ date: dateStr, reason }),
        });
        showToast(`${dateStr} blocked`);
      }
    });
  });
}

function attachKitchenStatusHandlers() {
  document.querySelectorAll("[data-order-ref]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
      await fetch(`/api/orders/${sel.dataset.orderRef}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-kitchen-passcode": passcode },
        body: JSON.stringify({ status: sel.value }),
      });
      showToast(`${sel.dataset.orderRef} marked ${sel.value.replace(/_/g, " ")}`);
    });
  });
  document.querySelectorAll("[data-catering-ref]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
      await fetch(`/api/catering/${sel.dataset.cateringRef}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-kitchen-passcode": passcode },
        body: JSON.stringify({ status: sel.value }),
      });
      showToast(`${sel.dataset.cateringRef} marked ${sel.value}`);
    });
  });
  document.querySelectorAll("[data-resync-order]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
      btn.disabled = true;
      btn.textContent = "Syncing…";
      try {
        const res = await fetch(`/api/orders/${btn.dataset.resyncOrder}/resync-clover`, {
          method: "POST",
          headers: { "x-kitchen-passcode": passcode },
        });
        const data = await res.json();
        showToast(data.synced ? `${btn.dataset.resyncOrder} synced to Clover` : "Still couldn't reach Clover — try again shortly");
      } catch {
        showToast("Still couldn't reach Clover — try again shortly");
      }
      btn.disabled = false;
      btn.textContent = "Retry";
    });
  });
  document.querySelectorAll("[data-resync-catering]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
      btn.disabled = true;
      btn.textContent = "Syncing…";
      try {
        const res = await fetch(`/api/catering/${btn.dataset.resyncCatering}/resync-clover`, {
          method: "POST",
          headers: { "x-kitchen-passcode": passcode },
        });
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
          <h2 class="h-display">Our Locations</h2>
          <p>Three spots around Cleveland — stop by any of them.</p>
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
    case "order": body = viewOrder(); break;
    case "checkout": body = viewCheckout(); break;
    case "order-confirmed": body = viewOrderConfirmed(); break;
    case "catering": body = viewCatering(); break;
    case "catering-book": body = viewCateringBook(); break;
    case "locations": body = viewLocations(); break;
    case "catering-confirmed": body = viewCateringConfirmed(); break;
    case "kitchen": body = viewKitchen(); break;
    default: body = viewHome();
  }
  document.getElementById("app").innerHTML = nav() + body + footer();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  attachHandlers(route);
}

function attachHandlers(route) {
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => addToCart(btn.dataset.add));
  });
  document.querySelectorAll("[data-qty-up]").forEach(btn => {
    btn.addEventListener("click", () => changeQty(btn.dataset.qtyUp, 1));
  });
  document.querySelectorAll("[data-qty-down]").forEach(btn => {
    btn.addEventListener("click", () => changeQty(btn.dataset.qtyDown, -1));
  });

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

  if (route === "checkout") {
    const toggleBtns = document.querySelectorAll("[data-fulfil]");
    const scheduleField = document.getElementById("scheduleField");
    toggleBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        toggleBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.fulfillment = btn.dataset.fulfil;
        scheduleField.style.display = state.fulfillment === "later" ? "block" : "none";
      });
    });

    document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const locationId = document.getElementById("pickupLocation").value;
      const name = document.getElementById("name").value.trim();
      const phone = document.getElementById("phone").value.trim();
      const email = document.getElementById("email").value.trim();
      const notes = document.getElementById("notes").value.trim();
      const errorBox = document.getElementById("checkoutError");
      errorBox.innerHTML = "";

      if (!locationId) {
        errorBox.innerHTML = `<div class="form-error-banner">Please choose a pickup location.</div>`;
        return;
      }
      if (!name || !phone) {
        errorBox.innerHTML = `<div class="form-error-banner">Please add your name and phone number so we can text you when it's ready.</div>`;
        return;
      }

      const payload = {
        items: state.cart,
        customer: { name, phone, email },
        locationId,
        fulfillment: state.fulfillment,
        notes,
      };

      const submitBtn = e.target.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "Placing order…";

      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong.");

        if (data.clientSecret) {
          // Real Stripe payment — mount the payment form right here on
          // the page instead of redirecting away. Stripe still redirects
          // the browser to our return_url after a successful payment,
          // landing back on #/order-confirmed with a session_id.
          await mountEmbeddedCheckout(data.clientSecret, "stripeCheckoutContainer", e.target);
          return;
        }

        state.lastOrder = data.order;
        sessionStorage.setItem("csb_last_order", JSON.stringify(data.order));
        state.cart = [];
        saveCart();
        location.hash = `#/order-confirmed?ref=${data.order.ref}`;
      } catch (err) {
        errorBox.innerHTML = `<div class="form-error-banner">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = `Place Order — ~${money(cartSubtotal() * 1.08)}`;
      }
    });
  }

  if (route === "order-confirmed") {
    const query = currentQuery();
    const sessionId = query.get("session_id");
    const ref = query.get("ref");
    const alreadyHave = state.lastOrder && state.lastOrder.ref === ref && state.lastOrder.paid;

    if (sessionId && ref && !alreadyHave) {
      fetch(`/api/orders/${encodeURIComponent(ref)}/verify-payment?session_id=${encodeURIComponent(sessionId)}`)
        .then(r => r.json())
        .then(data => {
          if (data.order) {
            state.lastOrder = data.order;
            sessionStorage.setItem("csb_last_order", JSON.stringify(data.order));
            if (data.order.paid) {
              state.cart = [];
              saveCart();
            }
          }
          if (currentRoute() === "order-confirmed") render();
        })
        .catch(() => showToast("Could not confirm payment — contact us with your reference code."));
    }
  }

  if (route === "kitchen") {
    const logoutBtn = document.getElementById("kitchenLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        state.kitchenAuthed = false;
        localStorage.removeItem("csb_kitchen_passcode");
        clearInterval(kitchenPollTimer);
        render();
      });
    }

    const loginForm = document.getElementById("kitchenLoginForm");
    if (loginForm) {
      attemptKitchenLogin(localStorage.getItem("csb_kitchen_passcode") || "", true);
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        attemptKitchenLogin(document.getElementById("kitchenPasscode").value, false);
      });
    } else {
      startKitchenPolling();
    }
  }

  if (route === "catering-book") {
    const headcountInput = document.getElementById("cHeadcount");
    const pkg = state.cateringPackages.find(p => p.id === document.getElementById("cPackageId").value);

    const updateTotal = () => {
      const count = Math.max(pkg.minHeadcount, Number(headcountInput.value) || pkg.minHeadcount);
      const total = pkg.pricePerPerson * count;
      document.getElementById("cHeadcountEcho").textContent = count;
      document.getElementById("cTotalPreview").textContent = money(total);
      document.getElementById("cSubmitTotal").textContent = money(total);
    };
    headcountInput.addEventListener("input", updateTotal);

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
        packageId: pkg.id,
        headcount: Number(document.getElementById("cHeadcount").value),
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

      if (payload.headcount < pkg.minHeadcount) {
        errorBox.innerHTML = `<div class="form-error-banner">${pkg.name} requires at least ${pkg.minHeadcount} guests.</div>`;
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
      submitBtn.textContent = "Processing…";

      try {
        const res = await fetch("/api/catering", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong.");

        if (data.clientSecret) {
          await mountEmbeddedCheckout(data.clientSecret, "stripeCheckoutContainer", e.target);
          return;
        }

        state.lastCatering = data.request;
        sessionStorage.setItem("csb_last_catering", JSON.stringify(data.request));
        location.hash = `#/catering-confirmed?ref=${data.request.ref}`;
      } catch (err) {
        errorBox.innerHTML = `<div class="form-error-banner">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = `Book & Pay — ~${document.getElementById("cSubmitTotal").textContent}`;
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

  if (route === "catering-confirmed") {
    const query = currentQuery();
    const sessionId = query.get("session_id");
    const ref = query.get("ref");
    const alreadyHave = state.lastCatering && state.lastCatering.ref === ref && state.lastCatering.paid;

    if (sessionId && ref && !alreadyHave) {
      fetch(`/api/catering/${encodeURIComponent(ref)}/verify-payment?session_id=${encodeURIComponent(sessionId)}`)
        .then(r => r.json())
        .then(data => {
          if (data.request) {
            state.lastCatering = data.request;
            sessionStorage.setItem("csb_last_catering", JSON.stringify(data.request));
          }
          if (currentRoute() === "catering-confirmed") render();
        })
        .catch(() => showToast("Could not confirm payment — contact us with your reference code."));
    }
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
