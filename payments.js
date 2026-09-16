// Stripe integration — talks to Stripe's REST API directly with fetch,
// so there's no SDK to npm-install. Set STRIPE_SECRET_KEY in .env (a test
// key looks like sk_test_...) to turn this on; until then, isStripeConfigured()
// is false and server.js skips straight to "test mode" (order marked paid
// immediately, no real charge).

const STRIPE_SECRET_KEY = () => process.env.STRIPE_SECRET_KEY || "";

function isStripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY());
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

// Builds a Stripe-hosted Checkout Session from a plain list of line items
// and returns it. Generic on purpose — both the order flow and the
// catering flow call this with their own line items.
//
// lineItems: [{ name, unitAmountCents, quantity }]
// successUrl / cancelUrl: full URLs, e.g. from buildRedirectUrls() below
// customerEmail: optional, prefills Stripe's checkout email field
// metadata: optional flat { key: "value" } object, stored on the session
async function createCheckoutSession({ lineItems, successUrl, cancelUrl, customerEmail, metadata }) {
  const params = {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
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
  });

  return stripePost("checkout/sessions", params);
}

async function retrieveCheckoutSession(sessionId) {
  return stripeGet(`checkout/sessions/${sessionId}`);
}

module.exports = { isStripeConfigured, createCheckoutSession, retrieveCheckoutSession };
