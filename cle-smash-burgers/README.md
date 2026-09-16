# Cleveland Smash Burgers — Web App Prototype

A working prototype with two flows — **online ordering** and **catering
requests** — plus a "download the app" experience that installs the site
itself as an app (no App Store needed).

## Stack, and why

- **Backend:** Node.js, built-in `http` module only — **zero npm packages**.
  `node server.js` is the entire install step. It serves the frontend and a
  small JSON API, and persists orders/catering requests to flat JSON files
  in `/data`.
- **Frontend:** plain HTML/CSS/JS, no build step. `public/app.js` is a small
  hash-router single-page app (`#/`, `#/order`, `#/checkout`,
  `#/catering`, etc.) so the order ticket stays live while you browse the
  menu.
- **"Mobile app":** the site is a installable PWA (manifest + service
  worker), so "Get the App" actually installs it to a home screen with its
  own icon and full-screen window — real, working, and needs no app store.

This keeps the prototype runnable anywhere with just Node installed, with
no API keys, accounts, or dependency installs to fight with. It's meant to
be replaced piece by piece — see "What to extend" below.

## Running it

```bash
node server.js
```

Then open **http://localhost:3000**. That's it — no `npm install`, no
build step, no environment variables required.

(Optional) run on a different port: `PORT=4000 node server.js`.

## What's in here

```
server.js                 Zero-dependency API + static file server
data/orders.json          Orders land here (created/append at runtime)
data/catering.json        Catering requests land here
public/
  index.html               App shell
  app.js                    All frontend logic (router, cart, forms, PWA install)
  styles.css                Design system (colors, type, components)
  manifest.webmanifest      Makes the site installable
  sw.js                     Service worker (offline app-shell caching)
  icons/                    Generated placeholder app icons
```

## Try the two flows

**Ordering:** Home → *Order Now* → add a few items (they land on the ticket
on the right) → *Continue to Details* → fill in name + phone → *Place
Order* → you get a reference code (`CSB-XXXX`).

**Catering:** Home → *Cater Your Event* → fill in the form → submit → you
get a reference code (`CATER-XXXX`).

**Install the app:** click *Get the App* in the nav (or the footer link).
On Chrome/Edge/Android it triggers the real browser install prompt; on
Safari/iOS (which doesn't support that prompt) it shows the "Add to Home
Screen" instructions instead.

Every order and catering request is appended to `data/orders.json` /
`data/catering.json` as it's submitted — open those files after testing to
see the raw records.

## What I'd extend first

Roughly in the order I'd tackle them:

1. **Payments.** There's no real payment step right now — checkout collects
   contact info and submits the order, but nothing charges a card. Wire in
   Stripe (Checkout or Payment Intents) between "Place Order" and the
   confirmation screen.
2. **A real database.** `data/*.json` is a flat-file store — great for a
   prototype, but it'll race/corrupt under concurrent writes. Swap
   `readJSON`/`writeJSON` in `server.js` for Postgres/SQLite (the API shape
   stays the same).
3. **Kitchen-facing view.** `GET /api/orders` and `GET /api/catering`
   already exist and return everything — right now nothing in the UI
   reads them. That's the seed of a "live orders" screen for the counter,
   with status updates (received → in progress → ready).
4. **SMS/email confirmations.** The order/catering confirmation screens
   promise a text or email; nothing actually sends one yet. Twilio for SMS,
   Resend/Postgres-backed email for catering follow-up.
5. **Real menu images + item customization.** The menu is text-only with
   an illustrated hero graphic. Add photos per item, and structured
   modifiers (temp, add bacon, no onion) instead of the notes free-text
   field.
6. **Auth for repeat customers.** Nothing is saved between visits except the
   cart (in `localStorage`). Accounts would unlock order history, saved
   addresses, and faster repeat ordering.
7. **True native app.** The installable PWA covers "add to home screen"
   well, but if push notifications or deeper device integration matter
   later, wrap this in React Native or Capacitor — the API in `server.js`
   can serve both the web app and a native client unchanged.

## Design notes

The visual language leans into the subject: a griddle/diner-ticket
aesthetic — the order cart is a literal order ticket with a torn-paper
edge, the menu reads like a chalkboard list rather than product cards, and
the palette (char black, smashed-crust red-brown, mustard, pickle green)
comes from the food itself rather than a generic brand-kit look.
