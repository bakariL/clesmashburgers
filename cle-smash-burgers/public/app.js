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

const state = {
  menu: FALLBACK_MENU,
  cateringPackages: FALLBACK_CATERING_PACKAGES,
  cart: JSON.parse(localStorage.getItem("csb_cart") || "[]"),
  lastOrder: JSON.parse(sessionStorage.getItem("csb_last_order") || "null"),
  lastCatering: JSON.parse(sessionStorage.getItem("csb_last_catering") || "null"),
  fulfillment: "pickup",
  deferredInstallPrompt: null,
  kitchenAuthed: false,
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
        <div class="eyebrow">CLEVELAND, OHIO · GRIDDLE-SMASHED DAILY</div>
        <h1 class="h-display">SMASHED&nbsp;THIN.<br>STACKED&nbsp;HIGH.<br><em>CLEVELAND MADE.</em></h1>
        <p class="lede">Crispy-edge smash burgers, hand-cut fries, and shakes — order ahead for pickup or bring us to your next event. No app store required, just the griddle.</p>
        <div class="hero-actions">
          <a href="#/order" class="btn btn-primary">Order Now</a>
          <a href="#/locations" class="btn btn-secondary">Find the Stand</a>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Catch us on the road</h2>
          <p>We're a mobile stand — no fixed address yet, so the schedule moves week to week.</p>
        </div>
        <a href="#/locations" class="btn btn-dark">Full Schedule &amp; Alerts</a>
      </div>
      <div id="homeLocationsPreview">
        <p style="color:var(--steel);">Loading this week's stops…</p>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Why it's smashed</h2>
          <p>Every patty hits a screaming-hot griddle and gets flattened hard — more surface area, more crust, more flavor.</p>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-card">
          <h3>Fresh, never frozen</h3>
          <p>Beef is ground and portioned daily. Smashed to order, never held under a heat lamp.</p>
        </div>
        <div class="info-card">
          <h3>Griddled buns</h3>
          <p>Every bun gets buttered and griddled so it holds up to the juice and the char.</p>
        </div>
        <div class="info-card">
          <h3>Pickup in ~15 min</h3>
          <p>Order ahead from this site and skip the line — we'll have it ready when you walk in.</p>
        </div>
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

        <div class="field-row">
          <div class="field">
            <label for="cDate">Event date</label>
            <input type="date" id="cDate" required>
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
          <h2 class="h-display">Pop-Up Schedule</h2>
          <p>Add or remove stops. Subscribers can be alerted per stop once it's posted.</p>
        </div>
      </div>

      <div id="kitchenAddStopError"></div>
      <form id="kitchenAddStopForm" class="form-card" style="margin-bottom:28px;" novalidate>
        <div class="field-row">
          <div class="field">
            <label for="stopDate">Date</label>
            <input type="date" id="stopDate" required>
          </div>
          <div class="field">
            <label for="stopType">Type</label>
            <select id="stopType">
              <option value="weekly">Weekly stop</option>
              <option value="event">Pop-up event</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="stopStart">Start time</label>
            <input type="time" id="stopStart">
          </div>
          <div class="field">
            <label for="stopEnd">End time</label>
            <input type="time" id="stopEnd">
          </div>
        </div>
        <div class="field">
          <label for="stopName">Stop name</label>
          <input type="text" id="stopName" required placeholder="Ohio City — W 25th & Lorain">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="stopAddress">Address</label>
            <input type="text" id="stopAddress" required placeholder="W 25th St & Lorain Ave, Cleveland, OH">
          </div>
          <div class="field">
            <label for="stopZip">Zip <span class="hint">(for "near you" alerts)</span></label>
            <input type="text" id="stopZip" inputmode="numeric" maxlength="5" placeholder="44113">
          </div>
        </div>
        <div class="field">
          <label for="stopNotes">Notes <span class="hint">(optional)</span></label>
          <input type="text" id="stopNotes" placeholder="Live music night, dinner service only, etc.">
        </div>
        <button type="submit" class="btn btn-primary btn-block">Add Stop</button>
      </form>

      <div id="kitchenSchedule">
        <p style="color:var(--steel);">Loading schedule…</p>
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
      const [ordersRes, cateringRes, locationsRes, alertsRes, cloverRes] = await Promise.all([
        fetch("/api/orders", { headers: { "x-kitchen-passcode": passcode } }),
        fetch("/api/catering", { headers: { "x-kitchen-passcode": passcode } }),
        fetch("/api/locations"),
        fetch("/api/alerts", { headers: { "x-kitchen-passcode": passcode } }),
        fetch("/api/clover/status", { headers: { "x-kitchen-passcode": passcode } }),
      ]);
      if (ordersRes.status === 401 || cateringRes.status === 401 || alertsRes.status === 401) {
        state.kitchenAuthed = false;
        clearInterval(kitchenPollTimer);
        render();
        return;
      }
      const ordersData = await ordersRes.json();
      const cateringData = await cateringRes.json();
      const locationsData = await locationsRes.json();
      const alertsData = await alertsRes.json();
      const cloverData = await cloverRes.json().catch(() => ({ enabled: false }));

      const board = document.getElementById("kitchenBoard");
      if (board) board.innerHTML = renderKitchenBoard(ordersData.orders || [], cateringData.requests || [], Boolean(cloverData.enabled));
      attachKitchenStatusHandlers();

      const schedule = document.getElementById("kitchenSchedule");
      if (schedule) schedule.innerHTML = renderKitchenSchedule(locationsData.locations || [], alertsData.signups || []);
      attachKitchenScheduleHandlers();
    } catch {
      // transient network hiccup — next poll will retry
    }
  };
  load();
  kitchenPollTimer = setInterval(load, 5000);
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

// ---------------- Locations / pop-up schedule ----------------

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function upcomingStops(locations, limit) {
  const today = todayISO();
  const upcoming = locations
    .filter(l => l.date >= today)
    .sort((a, b) => `${a.date}${a.startTime || ""}`.localeCompare(`${b.date}${b.startTime || ""}`));
  return limit ? upcoming.slice(0, limit) : upcoming;
}

function formatStopDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = dateStr === todayISO();
  const label = date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return isToday ? `Today — ${label}` : label;
}

function stopTypeBadge(type) {
  return type === "event"
    ? `<span class="status-badge" style="background:var(--crust); color:#fff;">pop-up event</span>`
    : `<span class="status-badge" style="background:#e2e2e2; color:#2b2b2b;">weekly stop</span>`;
}

function renderStopRow(loc, opts = {}) {
  const time = loc.startTime ? `${loc.startTime}${loc.endTime ? `–${loc.endTime}` : ""}` : "";
  return `
  <div class="menu-row" style="grid-template-columns:1fr auto;">
    <div>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:4px;">
        <h3 style="margin:0;">${loc.name}</h3>
        ${stopTypeBadge(loc.type)}
      </div>
      <p style="margin:0 0 4px;">${loc.address}</p>
      <p style="margin:0; color:var(--steel); font-size:0.85rem;">${formatStopDate(loc.date)}${time ? ` · ${time}` : ""}</p>
      ${loc.notes ? `<p style="margin:6px 0 0; font-size:0.88rem;">${loc.notes}</p>` : ""}
    </div>
    ${opts.showDirections !== false ? `
    <a class="btn btn-dark btn-sm" style="align-self:center;" target="_blank" rel="noopener"
       href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}">Directions</a>
    ` : ""}
  </div>`;
}

function renderSchedulePreview(locations) {
  const stops = upcomingStops(locations, 3);
  const el = document.getElementById("homeLocationsPreview");
  if (!el) return;
  if (stops.length === 0) {
    el.innerHTML = `<p style="color:var(--steel);">No stops posted yet — check back soon, or sign up below to get an alert the moment one goes up.</p>`;
    return;
  }
  el.innerHTML = `<div class="menu-board">${stops.map(l => renderStopRow(l)).join('')}</div>`;
}

function viewLocations() {
  return `
  <section style="padding-top:40px;">
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Find the Stand</h2>
          <p>We're a mobile stand, so the spot changes — this list is always current. No location posted yet? Sign up below and we'll text or email you the second one goes up.</p>
        </div>
      </div>

      <div id="nextStopCallout"></div>

      <div id="fullSchedule" style="margin:32px 0 48px;">
        <p style="color:var(--steel);">Loading schedule…</p>
      </div>

      <div class="section-head">
        <div>
          <h2 class="h-display">Get a Text When We're Near You</h2>
          <p>Drop your zip and we'll alert you the moment a new stop is posted nearby. No spam — just pop-up locations.</p>
        </div>
      </div>

      <div id="alertSignupMsg"></div>

      <form id="alertSignupForm" class="form-card" style="max-width:520px;" novalidate>
        <div class="field">
          <label for="alertName">Name <span class="hint">(optional)</span></label>
          <input type="text" id="alertName" placeholder="Jordan Smith">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="alertEmail">Email <span class="hint">(optional if phone given)</span></label>
            <input type="email" id="alertEmail" placeholder="you@example.com">
          </div>
          <div class="field">
            <label for="alertPhone">Phone <span class="hint">(optional if email given)</span></label>
            <input type="tel" id="alertPhone" placeholder="(216) 555-0100">
          </div>
        </div>
        <div class="field">
          <label for="alertZip">Zip code</label>
          <input type="text" id="alertZip" inputmode="numeric" maxlength="5" placeholder="44113" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Sign Up for Alerts</button>
      </form>

      <p style="margin-top:14px; font-size:0.85rem; color:var(--steel);">
        Already signed up and want out? <a href="#" id="unsubscribeToggle" style="color:var(--crust);">Unsubscribe here</a>.
      </p>
      <div id="unsubscribeBox" style="display:none; max-width:520px; margin-top:14px;">
        <div class="form-card">
          <div class="field">
            <label for="unsubContact">Email or phone you signed up with</label>
            <input type="text" id="unsubContact" placeholder="you@example.com or (216) 555-0100">
          </div>
          <button type="button" id="unsubscribeBtn" class="btn btn-dark btn-block">Unsubscribe</button>
          <div id="unsubscribeMsg"></div>
        </div>
      </div>
    </div>
  </section>`;
}

function renderNextStopCallout(locations) {
  const el = document.getElementById("nextStopCallout");
  if (!el) return;
  const stops = upcomingStops(locations, 1);
  if (stops.length === 0) {
    el.innerHTML = `
    <div class="install-card">
      <div>
        <p style="margin:0; font-size:0.95rem;">Nothing posted yet — sign up below and we'll alert you the moment a new stop goes up.</p>
      </div>
    </div>`;
    return;
  }
  const next = stops[0];
  const isToday = next.date === todayISO();
  el.innerHTML = `
  <div class="install-card">
    <div class="qr" style="background:var(--crust); color:#fff;">${isToday ? "HAPPENING<br>TODAY" : "NEXT<br>STOP"}</div>
    <div>
      ${renderStopRow(next)}
    </div>
  </div>`;
}

function renderFullSchedule(locations) {
  const el = document.getElementById("fullSchedule");
  if (!el) return;
  const stops = upcomingStops(locations);
  if (stops.length === 0) {
    el.innerHTML = `<p style="color:var(--steel);">No upcoming stops posted right now.</p>`;
    return;
  }
  el.innerHTML = `<div class="menu-board">${stops.map(l => renderStopRow(l)).join('')}</div>`;
}

function renderKitchenSchedule(locations, alerts) {
  const stops = [...locations].sort((a, b) => `${a.date}${a.startTime || ""}`.localeCompare(`${b.date}${b.startTime || ""}`));
  return `
  <p style="color:var(--steel); font-size:0.85rem; margin-bottom:14px;">${alerts.length} subscriber${alerts.length === 1 ? '' : 's'} signed up for alerts.</p>
  ${stops.length === 0 ? '<p style="color:var(--steel);">No stops posted yet.</p>' : stops.map(loc => `
    <div class="kitchen-card">
      <div class="kitchen-card-head">
        <strong>${loc.name}</strong> ${stopTypeBadge(loc.type)}
      </div>
      <div class="kitchen-card-body">
        <div>${loc.address}${loc.zip ? ` · ${loc.zip}` : ''}</div>
        <div>${formatStopDate(loc.date)}${loc.startTime ? ` · ${loc.startTime}${loc.endTime ? `–${loc.endTime}` : ''}` : ''}</div>
        ${loc.notes ? `<div>${loc.notes}</div>` : ''}
        <div style="color:var(--steel); font-size:0.8rem;">${loc.notifiedAt ? `Alerted subscribers ${new Date(loc.notifiedAt).toLocaleString()}` : 'Not yet alerted'}</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-dark btn-sm" data-notify-stop="${loc.id}" data-near="${loc.zip ? '1' : '0'}">
          ${loc.zip ? 'Notify Nearby' : 'Notify Everyone'}
        </button>
        <button class="btn btn-secondary btn-sm" style="color:var(--ink); border-color:var(--steel);" data-delete-stop="${loc.id}">Remove</button>
      </div>
    </div>
  `).join('')}`;
}

function attachKitchenScheduleHandlers() {
  document.querySelectorAll("[data-notify-stop]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
      const nearOnly = btn.dataset.near === "1";
      btn.disabled = true;
      try {
        const res = await fetch(`/api/locations/${btn.dataset.notifyStop}/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kitchen-passcode": passcode },
          body: JSON.stringify({ nearOnly }),
        });
        const data = await res.json();
        showToast(res.ok ? `Alerted ${data.notified} of ${data.of} subscribers` : (data.error || "Couldn't send alerts"));
      } catch {
        showToast("Couldn't send alerts — try again.");
      }
      btn.disabled = false;
    });
  });

  document.querySelectorAll("[data-delete-stop]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
      btn.disabled = true;
      try {
        await fetch(`/api/locations/${btn.dataset.deleteStop}`, {
          method: "DELETE",
          headers: { "x-kitchen-passcode": passcode },
        });
        showToast("Stop removed");
      } catch {
        showToast("Couldn't remove that stop — try again.");
      }
      btn.disabled = false;
    });
  });
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

  if (route === "home") {
    fetch("/api/locations")
      .then(r => r.json())
      .then(data => renderSchedulePreview(data.locations || []))
      .catch(() => {
        const el = document.getElementById("homeLocationsPreview");
        if (el) el.innerHTML = `<p style="color:var(--steel);">Couldn't load the schedule right now.</p>`;
      });
  }

  if (route === "locations") {
    fetch("/api/locations")
      .then(r => r.json())
      .then(data => {
        const locations = data.locations || [];
        renderNextStopCallout(locations);
        renderFullSchedule(locations);
      })
      .catch(() => {
        const el = document.getElementById("fullSchedule");
        if (el) el.innerHTML = `<p style="color:var(--steel);">Couldn't load the schedule right now.</p>`;
      });

    document.getElementById("alertSignupForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msgBox = document.getElementById("alertSignupMsg");
      msgBox.innerHTML = "";

      const payload = {
        name: document.getElementById("alertName").value.trim(),
        email: document.getElementById("alertEmail").value.trim(),
        phone: document.getElementById("alertPhone").value.trim(),
        zip: document.getElementById("alertZip").value.trim(),
      };

      if (!payload.zip) {
        msgBox.innerHTML = `<div class="form-error-banner">Add a zip code so we know where "near you" means.</div>`;
        return;
      }
      if (!payload.email && !payload.phone) {
        msgBox.innerHTML = `<div class="form-error-banner">Add an email or phone number so we can actually reach you.</div>`;
        return;
      }

      const submitBtn = e.target.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "Signing up…";

      try {
        const res = await fetch("/api/alerts/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong.");
        e.target.reset();
        msgBox.innerHTML = `<div class="confirm-detail-card" style="border-color:var(--crust);"><strong>You're in!</strong> We'll text or email you when a new stop goes up near ${payload.zip}.</div>`;
      } catch (err) {
        msgBox.innerHTML = `<div class="form-error-banner">${err.message}</div>`;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign Up for Alerts";
      }
    });

    document.getElementById("unsubscribeToggle").addEventListener("click", (e) => {
      e.preventDefault();
      const box = document.getElementById("unsubscribeBox");
      box.style.display = box.style.display === "none" ? "block" : "none";
    });

    document.getElementById("unsubscribeBtn").addEventListener("click", async () => {
      const raw = document.getElementById("unsubContact").value.trim();
      const msgBox = document.getElementById("unsubscribeMsg");
      msgBox.innerHTML = "";
      if (!raw) {
        msgBox.innerHTML = `<div class="form-error-banner">Enter the email or phone you signed up with.</div>`;
        return;
      }
      const isEmail = raw.includes("@");
      try {
        const res = await fetch("/api/alerts/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isEmail ? { email: raw } : { phone: raw }),
        });
        const data = await res.json();
        msgBox.innerHTML = data.removed > 0
          ? `<p style="color:var(--steel); margin-top:10px;">You're unsubscribed.</p>`
          : `<p style="color:var(--steel); margin-top:10px;">Didn't find a signup with that info.</p>`;
      } catch {
        msgBox.innerHTML = `<div class="form-error-banner">Something went wrong. Try again.</div>`;
      }
    });
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
      const name = document.getElementById("name").value.trim();
      const phone = document.getElementById("phone").value.trim();
      const email = document.getElementById("email").value.trim();
      const notes = document.getElementById("notes").value.trim();
      const errorBox = document.getElementById("checkoutError");
      errorBox.innerHTML = "";

      if (!name || !phone) {
        errorBox.innerHTML = `<div class="form-error-banner">Please add your name and phone number so we can text you when it's ready.</div>`;
        return;
      }

      const payload = {
        items: state.cart,
        customer: { name, phone, email },
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

      document.getElementById("kitchenAddStopForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errorBox = document.getElementById("kitchenAddStopError");
        errorBox.innerHTML = "";

        const payload = {
          date: document.getElementById("stopDate").value,
          startTime: document.getElementById("stopStart").value,
          endTime: document.getElementById("stopEnd").value,
          name: document.getElementById("stopName").value.trim(),
          address: document.getElementById("stopAddress").value.trim(),
          zip: document.getElementById("stopZip").value.trim(),
          notes: document.getElementById("stopNotes").value.trim(),
          type: document.getElementById("stopType").value,
        };

        if (!payload.date || !payload.name || !payload.address) {
          errorBox.innerHTML = `<div class="form-error-banner">Date, stop name, and address are required.</div>`;
          return;
        }

        const passcode = localStorage.getItem("csb_kitchen_passcode") || "";
        const submitBtn = e.target.querySelector("button[type=submit]");
        submitBtn.disabled = true;

        try {
          const res = await fetch("/api/locations", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-kitchen-passcode": passcode },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Something went wrong.");
          e.target.reset();
          showToast("Stop added to the schedule");
        } catch (err) {
          errorBox.innerHTML = `<div class="form-error-banner">${err.message}</div>`;
        } finally {
          submitBtn.disabled = false;
        }
      });
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
