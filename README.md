# Cleveland Smash Burgers — web app

A zero-dependency Node.js (v18+) site + installable PWA.

- **Order Now** buttons link to the Picnic ordering page (`ORDER_URL` at the top of `public/app.js`).
- **Catering booking** (`/#/catering`): pick sandwiches + quantities (10-sandwich minimum), optional combo/dessert upgrades, per-sandwich notes, choose an open date, and book. **No payment is taken online** — the team follows up.
- **Find Us**: the Cleveland storefront (3915 Carnegie Ave).
- **Private admin dashboard** at `/admin` (see below).

## Run it

```
node server.js     # http://localhost:3000
```

Everything is optional; without env vars, texts/emails are logged to the console. Copy `.env.example` to `.env` to configure.

## Catering

- Menu and prices live in `CATERING_MENU` in `server.js` (Cleveland Classic $10, Jive Turkey $10, Q Dogg $8; combo +$5 = fries + drink; fries only +$3.50; dessert +$5; Pan of Fries $25 as a standalone side that doesn't count toward the minimum). Prices are always computed on the server. The minimum is `CATERING_MIN`.
- Several events can be booked on the same day (each with its own title and time). Customers only see days staff have blocked — never other customers' events. Staff can block/unblock whole days in the admin calendar.
- The form validates: organizer first + last name, a real email, exactly 10 phone digits, and an event address.
- On booking, the customer gets a confirmation at the email they typed, and the **full form** is emailed to `operations@clesmashburgers.com` and `bakarilewis@gmail.com` (override with `CATERING_NOTIFY_EMAILS`, comma-separated). Needs `RESEND_API_KEY` and a verified sending domain in Resend.
- All messages are sent by `notifications.js` (retries 3x, never blocks a booking).

## Admin dashboard (`/admin`)

One login only: set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the environment (until both are set, the dashboard is locked). Shows every booking with contact info, event details, items and notes, status, and a log of emails sent; "Email customer" sends from the dashboard (replies go to `ADMIN_REPLY_TO`, default the first notify address). Login is rate-limited (5 wrong tries → 15-minute lockout), sessions last 12 hours.

## Optional integrations

- **Twilio** (SMS), **Resend** (email), **Clover** (pushes bookings to the POS; set `CLOVER_MERCHANT_ID` + `CLOVER_API_TOKEN`).
- Data is stored as JSON files in `data/` (on Render, a persistent disk).

See `DEPLOY.md` for Render setup.
