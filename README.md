# Cleveland Smash Burgers — Web App Prototype

A working prototype with two flows — **online ordering** and **catering
booking** (fixed packages, paid online, no back-and-forth quoting) —
plus a "download the app" experience that installs the site itself as
an app (no App Store needed).

It also has real (optional) **payments**, **SMS/email confirmations**,
a **kitchen dashboard**, a **pop-up location schedule with alerts**, and
a **safer data store** — see "The four extensions" below.

## Stack, and why

- **Backend:** Node.js, built-in `http` module only — **still zero npm
  packages**, even with payments and notifications wired in. `node
  server.js` is the entire install step. Stripe, Twilio, and Resend are
  all called directly over REST with `fetch` (built into Node 18+)
  instead of their SDKs, specifically to avoid adding a dependency.
- **Frontend:** plain HTML/CSS/JS, no build step. `public/app.js` is a
  hash-router single-page app (`#/`, `#/order`, `#/checkout`,
  `#/catering`, `#/kitchen`, etc.) so the order ticket stays live while
  you browse the menu.
- **"Mobile app":** the site is an installable PWA (manifest + service
  worker), so "Get the App" actually installs it to a home screen with
  its own icon and full-screen window — real, working, no app store.

This keeps the prototype runnable anywhere with just Node installed —
no build step, no required environment variables, nothing to fight with
on day one. Every integration below degrades gracefully to a "test mode"
until you add real credentials.

## Running it

```bash
node server.js
```

Then open **http://localhost:3000**. No `npm install`, no build step.
Everything works immediately in test mode (see below).

Deploying this somewhere real? See **[DEPLOY.md](DEPLOY.md)** for a
Render-specific walkthrough (`package.json` and `render.yaml` in this
repo are already set up for it — no code changes needed).

(Optional) run on a different port: `PORT=4000 node server.js`.

## The four extensions

### 1. Payments (Stripe)

Both **ordering** and **catering booking** create a real Stripe Checkout
Session when configured. Add a test-mode secret key to a `.env` file
(copy `.env.example` → `.env`):

```
STRIPE_SECRET_KEY=sk_test_...
```

With that set, "Place Order" and "Book & Pay" redirect to Stripe's
hosted payment page; after paying, Stripe redirects back and the server
verifies the payment before marking the order/booking confirmed and
sending confirmations. **Without** a key set, checkout skips straight
to test mode: paid immediately, no card charged, everything else
behaves the same — so you can build/demo the rest of the app with zero
Stripe setup.

If the Stripe API call fails for any reason (bad key, no network), the
server logs the error and **falls back to test mode automatically**
rather than failing the customer's order or booking — you can see this
in `server.js` under `/api/orders` and `/api/catering`.

Catering pricing is fixed per package — `pricePerPerson × headcount`,
no line-item customization — set in `CATERING_PACKAGES` near the top of
`server.js`. That's the only place you need to touch to change prices,
minimum headcounts, or what each package includes.

### 2. Data store (with a caveat)

I did *not* reach for a real SQL database here. `better-sqlite3` (the
usual choice) needs native compilation, and after the path issues you
ran into earlier, I didn't want to hand you an `npm install` that can
fail on Windows without build tools. Instead, `db.js` wraps the same
flat JSON files with:

- **Atomic writes** — every write goes to a temp file and then renames
  it into place, so a crash mid-write can't corrupt `orders.json`.
- **A write queue** — concurrent requests are serialized per file, so
  two orders landing at the same instant can't interleave and stomp on
  each other (this matters more now that order creation can `await` a
  Stripe call mid-transaction).

This fixes the actual risk (corruption/races), without a fragile
install. If you outgrow it later — multiple server processes, heavier
traffic — swap the internals of `db.js` for Postgres/SQLite; every
other file already calls it as `getOrder`/`updateOrder`/etc., so nothing
else has to change.

### 3. Kitchen dashboard

Visit **`/#/kitchen`** (also linked at the bottom of every page) for a
live board of orders and catering requests, polling every 5 seconds,
with a dropdown per card to move it through its status
(`received → in_progress → ready → completed` for orders;
`new → contacted → booked → declined` for catering).

Protect it with a passcode by setting `KITCHEN_PASSWORD` in `.env`.
**Without it set, the board is wide open with no login** — fine for
local development, but set a real passcode (and put this behind real
auth — see "What's still worth extending" below) before this is ever
reachable from outside your machine.

### 4. SMS / email confirmations

Set Twilio credentials and a Resend API key in `.env` to send real
texts and emails:

```
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
RESEND_API_KEY=...
RESEND_FROM_EMAIL=orders@yourdomain.com
```

Without them, `notify.js` just logs what it *would have* sent to the
terminal — prefixed with `[DEV]` — so you can see the exact message
content while you're building without needing real accounts yet.

## Pop-up locations & alerts

Since you run out of a mobile stand with no fixed address, there's now
a **`/#/locations`** page ("Find Us" in the nav) built around that:

- A "Next Stop" callout that surfaces whichever pop-up is coming up
  soonest (and says "Happening Today" if it is).
- The full upcoming schedule — date, time, address, a *Directions*
  button straight to Google Maps, and a badge for **weekly stop** vs
  **pop-up event**.
- A sign-up form: name (optional), email and/or phone, and a zip code
  so "near you" alerts mean something. Subscribing sends a real
  confirmation text/email (or logs it in test mode, same as
  orders/catering).
- A working unsubscribe flow, by email or phone.
- The homepage shows a live preview of the next few stops too.

**Managing the schedule** happens from the kitchen board
(`/#/kitchen`), since that's real day-to-day operations, not a one-time
setup:

- Add a stop (date, time, name, address, zip, notes, weekly vs. event).
- Each stop gets a **Notify Nearby / Notify Everyone** button — press
  it and every subscriber (optionally filtered to the same zip-code
  area as the stop) gets a text/email automatically.
- Remove old stops. Subscriber count is shown at the top.

The "near you" filtering is a simple zip-prefix match (same first 3
digits), not real distance — there's no geocoding API wired in. It's a
reasonable proxy for a Cleveland-area zip cluster, and documented here
so it's not a silent limitation: if you want actual mile-radius
matching later, that's where a Google Maps/Mapbox geocoding call would
slot in (see "What's still worth extending" below).

## What's in here

```
server.js                 API + static file server (still zero dependencies)
db.js                     Data layer — atomic, queued file-based store
payments.js               Stripe REST integration (fetch, no SDK)
notify.js                 Twilio SMS + Resend email (fetch, no SDK)
env.js                    Tiny .env file loader (no dependency)
.env.example              Every optional setting, documented
data/orders.json          Orders land here
data/catering.json        Catering requests land here
data/locations.json       Pop-up schedule stops land here
data/alerts.json          Location-alert subscribers land here
public/
  index.html               App shell
  app.js                    Frontend logic (router, cart, forms, schedule, kitchen board, PWA install)
  styles.css                Design system (colors, type, components)
  manifest.webmanifest      Makes the site installable
  sw.js                     Service worker (offline app-shell caching)
  icons/                    App icons generated from your real logo
```

## Try it

**Ordering:** Home → *Order Now* → add items → *Continue to Details* →
name + phone → *Place Order*. In test mode you land straight on a
confirmation with a `CSB-XXXX` code; with Stripe configured you're sent
to a real payment page first.

**Catering:** Home → *Cater Your Event* → pick a package → enter
headcount (total updates live) + date + address + contact info →
*Book & Pay*. Same test-mode/Stripe behavior as ordering. Anyone with
booking trouble is pointed to a phone number — there's no separate
"request a quote" form anymore.

**Find the Stand:** `/#/locations` → sign up with a zip code → go to
`/#/kitchen` and add a stop with that same zip → hit *Notify Nearby* →
check the terminal (or your phone/inbox, if Twilio/Resend are
configured) for the alert.

**Kitchen board:** `/#/kitchen` → enter the passcode if you set one →
watch orders/catering requests appear as you submit them, try changing
a status dropdown, and add/remove/notify pop-up stops.

**Install the app:** *Get the App* in the nav. Real install prompt on
Chrome/Edge/Android; "Add to Home Screen" instructions on iOS Safari.

## What's still worth extending

1. **Real auth for the kitchen board.** The passcode is a shared secret
   in one env var — fine for a single-location prototype, not real
   access control. Move to per-staff accounts before relying on it.
2. **Stripe webhooks.** Payment verification currently happens when the
   customer's browser redirects back from Stripe — reliable in
   practice, but a `POST /api/webhooks/stripe` endpoint listening for
   `checkout.session.completed` is the more bulletproof pattern (covers
   the case where the customer closes the tab right after paying).
3. **Real menu images + item customization.** Menu is text-only right
   now. Add photos per item, and structured modifiers (temp, add bacon,
   no onion) instead of the free-text notes field.
4. **Accounts for repeat customers.** Nothing persists between visits
   except the cart (`localStorage`). Accounts unlock order history and
   faster repeat ordering.
5. **A real SQL database**, if this grows past a single Node process —
   see the caveat in "Data store" above for exactly where to make that
   swap.
6. **True native app**, if push notifications or deeper device
   integration matter later — React Native or Capacitor could reuse the
   same API unchanged.
7. **Real geocoding for alerts.** "Notify Nearby" currently matches on
   the first 3 digits of a zip code — a reasonable proxy for Cleveland,
   but a real mile-radius match needs a geocoding API (Google Maps or
   Mapbox) to convert zips/addresses to coordinates first.

## Design notes

The palette is pulled directly from your logo — black, white, and one
vivid red (`#E2131B`, sampled from the badge and used as the single
accent color throughout) — rather than an invented brand-kit look. The
"CLEVELAND" wordmark's condensed bold feel carries through as the site's
display type (Oswald), and the logo's brush-marker "SMASH BURGERS" script
shows up as an accent font (Permanent Marker) on the hero headline and
the order-confirmation stamp, so it reads as the same brand, not a
different one.

Structurally it's still a griddle/diner-ticket concept — the order cart
is a literal order ticket, the menu reads like a chalkboard list rather
than product cards — just recolored to match: white "receipt paper"
tickets and cards, black chrome, red for anything actionable (buttons,
prices you can tap, the confirmation stamp). Your actual logo badge is
now used site-wide (nav, footer, PWA icons) instead of a placeholder.
