// Stripe integration — talks to Stripe's REST API directly with fetch,
// so there's no SDK to npm-install. Set STRIPE_SECRET_KEY in .env (a test
// key looks like sk_test_...) to turn this on; until then, isStripeConfigured()
// is false and server.js skips straight to "test mode" (order marked paid
// immediately, no real charge).

const STRIPE_SECRET_KEY = () => process.env.STRIPE_SECRET_KEY || "";

function isStripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY());
}

// Publishable keys are designed by Stripe to be public — safe to send to
// the browser, unlike the secret key. The frontend needs it to load
// Stripe.js and mount the embedded payment form.
function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}

async function stripePost(pathname, params) {
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Stripe request failed");
  return data;
}

async function stripeGet(pathname) {
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Stripe request failed");
  return data;
}

// Builds an Embedded Stripe Checkout Session from a plain list of line
// items and returns it. Generic on purpose — both the order flow and the
// catering flow call this with their own line items.
//
// lineItems: [{ name, unitAmountCents, quantity, taxCode }]
//   taxCode is a Stripe product tax code (e.g. "txcd_40060003" for
//   "Food for Immediate Consumption") — optional per line item; omit it
//   and Stripe falls back to whatever default tax code is set in your
//   Dashboard under Tax settings, if any.
// returnUrl: where Stripe sends the browser after the payment attempt —
//   include the literal string "{CHECKOUT_SESSION_ID}" and Stripe
//   substitutes the real session id before redirecting.
// customerEmail: optional, prefills Stripe's checkout email field
// metadata: optional flat { key: "value" } object, stored on the session
//
// ui_mode "embedded" means the payment form (card entry, Apple Pay,
// Google Pay) mounts directly inside our own page via Stripe.js —
// the customer never leaves the site. The response's client_secret is
// what the frontend uses to mount it (see public/app.js).
async function createCheckoutSession({ lineItems, returnUrl, customerEmail, metadata }) {
  const params = {
    mode: "payment",
    ui_mode: "embedded",
    return_url: returnUrl,
    // Stripe Tax: calculates real tax once you have an active tax
    // registration for the customer's jurisdiction (Dashboard → Tax →
    // Registrations). Returns $0 tax — not an error — until you do.
    "automatic_tax[enabled]": "true",
    // Collect enough address info for Stripe Tax to work, without
    // implying this is a shippable order (we're pickup-only).
    billing_address_collection: "auto",
  };
  if (customerEmail) params.customer_email = customerEmail;
  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      params[`metadata[${key}]`] = value;
    }
  }

  lineItems.forEach((line, i) => {
    params[`line_items[${i}][quantity]`] = line.quantity;
    params[`line_items[${i}][price_data][currency]`] = "usd";
    params[`line_items[${i}][price_data][unit_amount]`] = line.unitAmountCents;
    params[`line_items[${i}][price_data][product_data][name]`] = line.name;
    // "exclusive" = the amount above is the pre-tax price; Stripe adds
    // tax on top and shows it as its own line on the Checkout page.
    params[`line_items[${i}][price_data][tax_behavior]`] = "exclusive";
    if (line.taxCode) {
      params[`line_items[${i}][price_data][product_data][tax_code]`] = line.taxCode;
    }
  });

  return stripePost("checkout/sessions", params);
}

async function retrieveCheckoutSession(sessionId) {
  return stripeGet(`checkout/sessions/${sessionId}`);
}

// Verified against the live Tax Codes API (GET /v1/tax_codes/txcd_40060003)
// on 2026-09-16 — "Food for Immediate Consumption." Covers both burger
// orders and catering per Stripe's own description ("prepared foods,
// ready-to-eat foods, or meals"). Not a substitute for your own tax
// advice if you want catering classified separately.
const FOOD_TAX_CODE = "txcd_40060003";

module.exports = { isStripeConfigured, getPublishableKey, createCheckoutSession, retrieveCheckoutSession, FOOD_TAX_CODE };
