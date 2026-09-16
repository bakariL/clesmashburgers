# Deploying to Render

This repo needs zero code changes to deploy — `package.json`,
`render.yaml`, and `.gitignore` (all in this folder) are the only
additions. Everything below assumes you're deploying from a GitHub
repo, since that's how Render auto-redeploys on every push.

## 1. Get this repo onto GitHub

**Important:** when you create the repo, the files listed above
(`server.js`, `package.json`, `render.yaml`, `public/`, etc.) need to
sit at the **top level** of the repo — not nested inside another
`cle-smash-burgers/` folder. This is the same double-nested-folder
issue you hit unzipping the file locally — easy to accidentally repeat
when dragging a folder into GitHub Desktop or a file upload UI. If
you're not sure, after pushing, GitHub's repo page should show
`server.js` directly in the file list, not one folder deeper.

If you haven't used GitHub before and want a walkthrough for this
step specifically, just ask — happy to go command-by-command.

## 2. Create the Render service

1. Sign up / log in at [render.com](https://render.com).
2. **New → Web Service**, connect your GitHub account, pick this repo.
3. Render should detect `render.yaml` automatically and offer to use it
   as a **Blueprint** — accept that; it pre-fills the build/start
   commands, the persistent disk, and prompts you for the env vars
   below. (If it doesn't detect it, set these manually: Runtime =
   Node, Build Command = *(leave blank)*, Start Command =
   `node server.js`.)
4. Pick a plan that supports persistent disks — Render's free tier
   doesn't, and this app needs one to keep orders/catering/schedule
   data across restarts. Check Render's current plan names/pricing in
   their dashboard, since these change.

## 3. Fill in environment variables

Render will prompt for each of these (from `render.yaml`) during
setup — **every one is optional**:

| Variable | Leave blank and... |
|---|---|
| `STRIPE_SECRET_KEY` | payments stay in test mode (no real charge) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | texts get logged, not sent |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | emails get logged, not sent |
| `KITCHEN_PASSWORD` | the kitchen board is open with no login |

Set as many or as few as you're ready for — you can always add the
rest later from the Render dashboard (Environment tab) without
redeploying code.

## 4. Confirm the persistent disk

`render.yaml` mounts a disk at `/opt/render/project/src/data` —
that matches where `db.js` writes (`data/orders.json`,
`data/catering.json`, `data/locations.json`, `data/alerts.json`)
*only if* step 1's folder structure is correct. After your first
deploy, check the Render **Shell** tab and run `ls data/` — you
should see those four files. If that path doesn't exist, your repo
root is nested one level too deep (back to step 1).

## 5. First deploy

Render builds and starts the service automatically. Once it's live,
you'll get a URL like `https://cle-smash-burgers.onrender.com` —
open it and confirm the homepage loads, then place a test order and
check it shows up on `/#/kitchen`.

## 6. Connect your domain

Once you're happy with it on the `.onrender.com` URL:

1. In the Render dashboard: your service → **Settings → Custom
   Domains** → add `clesmashburgers.com` and `www.clesmashburgers.com`.
2. Render shows you the exact DNS records to add.
3. Log into Squarespace → **Domains** → `clesmashburgers.com` →
   DNS Settings, and add those records (this replaces whatever's
   currently pointing it at Squarespace's own "Coming Soon" page —
   double-check you're not also removing MX records for any email
   tied to the domain before you save).
4. Render auto-issues HTTPS once the DNS change propagates — usually
   minutes, sometimes up to a day.

## After that

Every `git push` to your main branch redeploys automatically. Your
`data/` files persist across those deploys because of the disk from
step 4 — but they still live on one disk on one instance, so it's
worth periodically downloading a copy (Render's Shell tab, or set up
a small scheduled job later) as a backup.
