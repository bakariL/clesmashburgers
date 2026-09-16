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

const state = {
  menu: FALLBACK_MENU,
  cart: JSON.parse(localStorage.getItem("csb_cart") || "[]"),
  lastOrder: JSON.parse(sessionStorage.getItem("csb_last_order") || "null"),
  lastCatering: JSON.parse(sessionStorage.getItem("csb_last_catering") || "null"),
  fulfillment: "pickup",
  deferredInstallPrompt: null,
};

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

// ---------------- Router ----------------

function currentRoute() {
  return (location.hash || "#/").replace("#", "").replace(/^\//, "") || "home";
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
      <a href="#/" class="brand" style="text-decoration:none;">CLEVELAND<span>&nbsp;SMASH&nbsp;BURGERS</span></a>
      <nav class="nav-links">
        ${link('#/', 'Home')}
        ${link('#/order', 'Order')}
        ${link('#/catering', 'Catering')}
        <a href="https://instagram.com/clesmashburgers" target="_blank" rel="noopener" class="ig-link">@clesmashburgers</a>
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
          <h4>Cleveland Smash Burgers</h4>
          <p>Thin-smashed, crispy-edge burgers off the griddle. Order ahead for pickup, or book us for your next event.</p>
        </div>
        <div>
          <h4>Find Us</h4>
          <p>2140 Lorain Ave<br>Cleveland, OH 44113<br>Tue–Sun, 11am–9pm</p>
        </div>
        <div>
          <h4>Connect</h4>
          <p><a href="https://instagram.com/clesmashburgers" target="_blank" rel="noopener">Instagram: @clesmashburgers</a><br>
          <a href="tel:+12165550142">(216) 555-0142</a><br>
          <a href="#/order">Start an order →</a></p>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} Cleveland Smash Burgers. Prototype build.</span>
        <a href="#" id="installFooterBtn" style="color:var(--mustard);">Install the app</a>
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
          <a href="#/catering" class="btn btn-secondary">Cater Your Event</a>
        </div>
      </div>
      ${burgerArt()}
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
          <p style="margin:0 0 10px; font-size:0.95rem; color:#5b5347;">This site installs like a native app right from your browser: tap <strong>Get the App</strong> above, or use your browser's "Add to Home Screen" option. It'll launch full-screen with an icon on your home screen — no App Store or Play Store listing yet.</p>
          <button class="btn btn-dark" id="installInlineBtn">Install the App</button>
        </div>
      </div>
    </div>
  </section>`;
}

function burgerArt() {
  return `
  <svg class="burger-art" viewBox="0 0 420 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of a smash burger cross-section on a grill grate">
    <defs>
      <pattern id="grate" width="40" height="40" patternUnits="userSpaceOnUse">
        <rect width="40" height="40" fill="#241d16"/>
        <rect y="16" width="40" height="8" fill="#2f261b"/>
      </pattern>
    </defs>
    <rect x="0" y="230" width="420" height="130" fill="url(#grate)"/>
    <ellipse cx="210" cy="255" rx="150" ry="16" fill="#0f0c08" opacity="0.5"/>
    <!-- bottom bun -->
    <path d="M90 250 q120 -26 240 0 v18 q-120 20 -240 0 z" fill="#d99a4e"/>
    <!-- patty -->
    <rect x="85" y="210" width="252" height="30" rx="6" fill="#5c3420"/>
    <rect x="95" y="214" width="232" height="8" rx="4" fill="#7a4a2c" opacity="0.7"/>
    <!-- cheese drape -->
    <path d="M80 214 l30 -14 l30 14 l30 -14 l30 14 l30 -14 l30 14 l30 -14 l30 14 v10 h-260 z" fill="#e8a33d"/>
    <!-- pickles -->
    <circle cx="140" cy="204" r="7" fill="#6e7b3f"/>
    <circle cx="200" cy="200" r="7" fill="#6e7b3f"/>
    <circle cx="270" cy="205" r="7" fill="#6e7b3f"/>
    <!-- top bun -->
    <path d="M75 195 q135 -80 270 0 q10 5 5 16 h-280 q-5 -11 5 -16 z" fill="#e3a84f"/>
    <path d="M75 195 q135 -80 270 0" fill="none" stroke="#c98a35" stroke-width="3"/>
    <circle cx="160" cy="150" r="3" fill="#f6e9d8"/>
    <circle cx="190" cy="140" r="3" fill="#f6e9d8"/>
    <circle cx="225" cy="138" r="3" fill="#f6e9d8"/>
    <circle cx="255" cy="145" r="3" fill="#f6e9d8"/>
    <circle cx="145" cy="165" r="3" fill="#f6e9d8"/>
    <circle cx="280" cy="160" r="3" fill="#f6e9d8"/>
  </svg>`;
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
      <div class="row"><span>Tax (8%)</span><span>${money(tax)}</span></div>
      <div class="row total"><span>Total</span><span>${money(total)}</span></div>
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

            <button type="submit" class="btn btn-primary btn-block">Place Order — ${money(cartSubtotal() * 1.08)}</button>
          </form>
        </div>
        <div class="ticket-col">
          ${ticket({ showCheckoutBtn: false })}
        </div>
      </div>
    </div>
  </section>`;
}

function viewOrderConfirmed() {
  const order = state.lastOrder;
  if (!order) {
    location.hash = "#/order";
    return "";
  }
  return `
  <section style="padding-top:56px;">
    <div class="container confirm-wrap">
      ${stepper(2)}
      <div class="stamp">Order Received</div>
      <h2 class="h-display">We're firing up the griddle.</h2>
      <div class="ref-code">${order.ref}</div>
      <p style="color:#5b5347;">Show this code at the counter. Pickup at 2140 Lorain Ave — text you at ${order.customer.phone} if anything changes.</p>

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

const CATERING_PACKAGES = [
  { name: "Office Lunch", price: "$14 / person", features: ["Single smash sliders", "Fries + house salad", "Serves 10–40"] },
  { name: "Backyard Griddle", price: "$19 / person", features: ["Build-your-own smash bar", "Two sides + shakes", "On-site cook option"] },
  { name: "Full Event", price: "Custom quote", features: ["Full menu + staff", "Weddings, corporate, tailgates", "Custom menu available"] },
];

function viewCatering() {
  return `
  <section class="catering-hero">
    <div class="container">
      <div class="eyebrow" style="color:#f6ded4;">CATERING</div>
      <h1 class="h-display">FEEDING THE CROWD.</h1>
      <p>From a 10-person office lunch to a 300-person wedding, we bring the griddle. Tell us about your event and we'll follow up with a menu and quote.</p>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-head">
        <div>
          <h2 class="h-display">Starting points</h2>
          <p>Every event gets a custom menu — these packages are just a starting price per person.</p>
        </div>
      </div>
      <div class="pkg-grid">
        ${CATERING_PACKAGES.map(p => `
          <div class="pkg-card">
            <div class="pkg-name">${p.name}</div>
            <div class="pkg-price">${p.price}</div>
            <ul>${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
          </div>
        `).join('')}
      </div>

      <div class="section-head">
        <div>
          <h2 class="h-display">Request a quote</h2>
          <p>Fill this out and our catering team will follow up within one business day.</p>
        </div>
      </div>

      <div id="cateringError"></div>

      <form id="cateringForm" class="form-card" style="max-width:640px;" novalidate>
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
        <div class="field-row">
          <div class="field">
            <label for="cDate">Event date</label>
            <input type="date" id="cDate" required>
          </div>
          <div class="field">
            <label for="cHeadcount">Headcount</label>
            <input type="number" id="cHeadcount" min="1" required placeholder="50">
          </div>
        </div>
        <div class="field-row">
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
            <label for="cBudget">Budget range <span class="hint">(optional)</span></label>
            <input type="text" id="cBudget" placeholder="e.g. $500–$800">
          </div>
        </div>
        <div class="field">
          <label for="cNotes">Tell us about the event</label>
          <textarea id="cNotes" placeholder="Location, dietary needs, timing, anything else"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Submit Catering Request</button>
      </form>
    </div>
  </section>`;
}

function viewCateringConfirmed() {
  const req = state.lastCatering;
  if (!req) {
    location.hash = "#/catering";
    return "";
  }
  return `
  <section style="padding-top:56px;">
    <div class="container confirm-wrap">
      <div class="stamp">Request Sent</div>
      <h2 class="h-display">We've got your event.</h2>
      <div class="ref-code">${req.ref}</div>
      <p style="color:#5b5347;">Our catering team will email ${req.contact.email} within one business day with a menu and quote.</p>

      <div class="confirm-detail-card">
        <div class="row"><span>Event date</span><span>${req.eventDate}</span></div>
        <div class="row"><span>Headcount</span><span>${req.headcount}</span></div>
        <div class="row"><span>Event type</span><span>${req.eventType}</span></div>
      </div>

      <div class="hero-actions" style="justify-content:center;">
        <a href="#/" class="btn btn-dark">Back Home</a>
        <a href="#/order" class="btn btn-secondary" style="color:var(--ink); border-color:var(--steel);">Order for Yourself</a>
      </div>
    </div>
  </section>`;
}

// ---------------- Render ----------------

function render() {
  const route = currentRoute();
  let body = "";
  switch (route) {
    case "home": body = viewHome(); break;
    case "order": body = viewOrder(); break;
    case "checkout": body = viewCheckout(); break;
    case "order-confirmed": body = viewOrderConfirmed(); break;
    case "catering": body = viewCatering(); break;
    case "catering-confirmed": body = viewCateringConfirmed(); break;
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

        state.lastOrder = data.order;
        sessionStorage.setItem("csb_last_order", JSON.stringify(data.order));
        state.cart = [];
        saveCart();
        location.hash = "#/order-confirmed";
      } catch (err) {
        errorBox.innerHTML = `<div class="form-error-banner">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = `Place Order — ${money(cartSubtotal() * 1.08)}`;
      }
    });
  }

  if (route === "catering") {
    document.getElementById("cateringForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorBox = document.getElementById("cateringError");
      errorBox.innerHTML = "";

      const payload = {
        contact: {
          name: document.getElementById("cName").value.trim(),
          phone: document.getElementById("cPhone").value.trim(),
          email: document.getElementById("cEmail").value.trim(),
        },
        eventDate: document.getElementById("cDate").value,
        headcount: document.getElementById("cHeadcount").value,
        eventType: document.getElementById("cType").value,
        budget: document.getElementById("cBudget").value.trim(),
        menuNotes: document.getElementById("cNotes").value.trim(),
      };

      if (!payload.contact.name || !payload.contact.phone || !payload.contact.email || !payload.eventDate || !payload.headcount) {
        errorBox.innerHTML = `<div class="form-error-banner">Please fill in your contact info, event date, and headcount.</div>`;
        return;
      }

      const submitBtn = e.target.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";

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
        location.hash = "#/catering-confirmed";
      } catch (err) {
        errorBox.innerHTML = `<div class="form-error-banner">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Catering Request";
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
