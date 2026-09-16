// Clover POS integration — pushes paid orders and catering bookings into
// the restaurant's own Clover account so staff see them on the
// register/KDS and a kitchen ticket can print. Plain REST via fetch, no
// SDK, same pattern as payments.js/notify.js. Set CLOVER_MERCHANT_ID and
// CLOVER_API_TOKEN in .env to turn this on; until then, isCloverConfigured()
// is false and orders simply aren't pushed — nothing else breaks, customers
// still get their normal confirmation either way.
//
// Get both values from the Clover Dashboard (dashboard.clover.com) under
// Setup > API Tokens: generate a token there, and the Merchant ID is shown
// alongside it. That's a private, single-merchant token — no OAuth flow
// needed for this kind of one-restaurant integration.
//
// Important quirk, confirmed against Clover's own developer community
// (not guessed): a single custom line item does NOT reliably support a
// quantity multiplier — asking for unitQty > 1 on one line item can show
// the wrong total. The correct way to represent "2x Double Smash" is two
// separate line items, each priced as one unit. buildOrderLineItems()
// below does this expansion for you.

function isCloverConfigured() {
  return Boolean(process.env.CLOVER_MERCHANT_ID && process.env.CLOVER_API_TOKEN);
}

function baseUrl() {
  // CLOVER_SANDBOX=true points at Clover's sandbox for testing before
  // you're ready to have real orders land on your live device.
  return process.env.CLOVER_SANDBOX === "true"
    ? "https://apisandbox.dev.clover.com"
    : "https://api.clover.com";
}

async function cloverFetch(path, options = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.CLOVER_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Clover request failed (${res.status})`);
  }
  return data;
}

// Expands [{ name, qty, priceCents }] into one entry per unit — see the
// quirk note above. Use this for a food order's cart items.
function expandLineItems(items) {
  const expanded = [];
  for (const item of items) {
    for (let i = 0; i < item.qty; i++) {
      expanded.push({ name: item.name, priceCents: item.priceCents });
    }
  }
  return expanded;
}

// Creates an open order in Clover with the given line items and an
// optional note (order ref, customer name/phone, pickup time, or event
// details for catering). Returns the created Clover order's id.
async function pushOrder({ lineItems, note }) {
  const mId = process.env.CLOVER_MERCHANT_ID;

  const order = await cloverFetch(`/v3/merchants/${mId}/orders`, {
    method: "POST",
    body: JSON.stringify({ state: "open" }),
  });

  await cloverFetch(`/v3/merchants/${mId}/orders/${order.id}/bulk_line_items`, {
    method: "POST",
    body: JSON.stringify({
      items: lineItems.map((li) => ({
        name: li.name,
        price: li.priceCents,
        isRevenue: true,
      })),
    }),
  });

  if (note) {
    await cloverFetch(`/v3/merchants/${mId}/orders/${order.id}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  }

  return order.id;
}

module.exports = { isCloverConfigured, expandLineItems, pushOrder };
