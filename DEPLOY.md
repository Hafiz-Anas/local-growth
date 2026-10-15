# Deploying to Vercel (Neon + Vercel Blob)

Production runs on **Vercel**, with **Neon** PostgreSQL as the database and **Vercel Blob** for uploaded and AI-generated images. Production starts with an **empty database**: migrations create the schema, and you create the first admin with `npm run create-admin`. Nothing is copied over from your local database.

> **Never run `npm run db:seed`, `npm run db:reset`, `prisma migrate reset` or `prisma migrate dev` against Neon.** The seed deletes every table first, and it refuses to run against a `*.neon.tech` host or on Vercel. Production only ever uses `prisma migrate deploy`.

Your local setup doesn't change. `npm run dev`, `npm run build`, Docker Postgres, `STORAGE_PROVIDER="local"` and the seed all work as before.

---

## 1. Create the Neon database

1. Create a project at [console.neon.tech](https://console.neon.tech). Pick the region closest to where your Vercel functions run (for example `aws-eu-central-1` for Vercel's `fra1`).
2. Open **Connect** on the project dashboard and copy two connection strings for the `main` branch:
   - **Pooled** (the host contains `-pooler`): this goes in `DATABASE_URL`. The app uses it.
   - **Direct** (turn "Connection pooling" off): this goes in `DIRECT_URL`. Prisma migrations use it.

   Both should end in `?sslmode=require`.

*Using the Neon integration from the Vercel Marketplace instead?* It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) for you. You still need to add `DIRECT_URL` yourself, with the same value as `DATABASE_URL_UNPOOLED`.

## 2. Create the Blob store

1. In the Vercel dashboard, open the project, then **Storage → Create Database → Blob**.
2. Set the access to **Public**. Images are shown in the app and handed to Instagram by URL, so they need to be public. The app refuses non-public URLs.
3. Connect the store to the project for **Production** (and Preview, if you use it). This adds `BLOB_READ_WRITE_TOKEN` to the project's environment variables.

## 3. Environment variables on Vercel

Set these under **Project → Settings → Environment Variables**, scoped to **Production**. Generate fresh secrets for production. Don't reuse your local ones, and never commit them.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (`…-pooler….neon.tech/…?sslmode=require`) |
| `DIRECT_URL` | Neon **direct** connection string (used only by `prisma migrate deploy` during the build) |
| `AUTH_SECRET` | New random secret: `npx auth secret`, or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_URL` | `https://<your-domain>`: your production URL, with no trailing slash. It's used for Auth.js and for links in emails. |
| `ENCRYPTION_KEY` | New 32-byte base64 key (same command as above). It encrypts Instagram tokens. Keep it stable: changing it later breaks existing Instagram connections. |
| `STORAGE_PROVIDER` | `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` | Added automatically by step 2. |
| `DEMO_ACCOUNTS_ENABLED` | `false` |
| `EMAIL_PROVIDER` | `resend` (real email). `console` only writes links to the function logs. |
| `RESEND_API_KEY` | Resend API key with *Sending access* (Resend → API Keys). Mark it **Sensitive**. |
| `EMAIL_FROM` | A sender on your verified domain, e.g. `Local Growth Engine <no-reply@your-domain>` (see *Email sending domain* below) |
| `INSTAGRAM_PROVIDER` | `meta` for real Instagram connections (`mock` = demo flow) |
| `META_APP_ID` | Your Meta app ID |
| `META_APP_SECRET` | Meta app secret (Meta for Developers → App settings → Basic) |
| `META_REDIRECT_URI` | `https://<your-domain>/api/integrations/instagram/callback` |
| `META_GRAPH_VERSION` | `v26.0` |
| `AI_PROVIDER` | `gemini` (text: captions, reply drafts, Regenerate, assistant, recommendations, reports; `mock` = template text, no AI calls) |
| `GEMINI_TEXT_RPM` | `12` (text requests per minute per instance; over it, template text or "AI unavailable") |
| `GEMINI_TEXT_RPD` | `450` (text requests per day per instance, resets at midnight Pacific time) |
| `IMAGE_PROVIDER` | `gemini` (or `mock` for placeholder images) |
| `GEMINI_API_KEY` | Google AI Studio key (needed when `AI_PROVIDER` or `IMAGE_PROVIDER` is `gemini`). Mark it **Sensitive**. |
| `RATE_LIMIT_STORE` | `memory` |
| `CRON_SECRET` | New random secret (same command as `AUTH_SECRET`). Turns on scheduled publishing; see *Publishing to Instagram* below. Mark it **Sensitive**. |
| `META_WEBHOOK_VERIFY_TOKEN` | New random string (same command as `AUTH_SECRET`). Entered again in Meta's webhook settings (section 5). Mark it **Sensitive**. |

Optional: `COMPETITOR_CRON_BATCH` (AI competitor comparisons per daily run, default 10), `MONITOR_CRON_BATCH` (post-monitoring readings per run, default 100). The daily job also stores one follower count per business per day for the Statistics page; `GEMINI_IMAGE_MODEL`, `META_OAUTH_RESPONSE_TYPE` (defaults to `code`), and `EMAIL_VERIFICATION_BANNER` (`true` shows the "Verify your email" banner after login; leave it unset, which means off, until verification emails are really delivered).

**Don't set these on Vercel:** `UPLOAD_DIR` (local storage only), `GEMINI_API_BASE`, `META_GRAPH_BASE_URL` and `RESEND_API_BASE` (test stubs only), and `ADMIN_*` (used only by `create-admin` on your machine).

### Email sending domain (Resend)

Resend only sends from domains you have verified. Until then it rejects every message (the app logs `[email:resend] … failed (rejected, HTTP 403)` and shows users a friendly "couldn't send the email" message).

1. In Resend, open **Domains → Add domain** and enter the domain used in `EMAIL_FROM` (a subdomain such as `mail.your-domain` is fine).
2. Add the DNS records Resend shows (SPF/MX and DKIM, optionally DMARC) at your DNS provider, then click **Verify**. It usually takes a few minutes.
3. Create an API key with *Sending access*, set `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_PROVIDER=resend`, and redeploy.

Without a verified domain, Resend's test sender `onboarding@resend.dev` can only deliver to the email address of your own Resend account. That is useful for a first local test, not for real users.

Verification, password-reset and onboarding-invite links all use `AUTH_URL`, so set it to the live domain in production.

## 4. Build command and migrations

`package.json` has a `vercel-build` script, and **Vercel runs it automatically in place of `build`**. Leave the Build Command setting at its default, or set it explicitly to `npm run vercel-build`. The script (`scripts/vercel-build.mjs`) does three things:

1. Runs `prisma generate`.
2. Runs `prisma migrate deploy` over `DIRECT_URL`, on **Production** deployments only (`VERCEL_ENV=production`). This applies pending migrations and nothing else. If `DIRECT_URL` is missing, the build fails instead of guessing. Preview deployments skip this step, so a branch can't change the production schema.
3. Runs `next build`. The build doesn't connect to the database.

The first production deployment creates the whole schema in the empty Neon database.

### Running migrations against Neon by hand

You don't normally need this. It's useful if you want the schema in place before the first deploy, or if a build failed partway. From the project folder, in **PowerShell**:

```powershell
$env:DIRECT_URL = Read-Host "Neon DIRECT connection string"
npx prisma migrate status    # shows which migrations are pending
npx prisma migrate deploy    # applies them, and nothing else
Remove-Item Env:DIRECT_URL   # back to your local database
```

`prisma.config.ts` uses `DIRECT_URL` when it's set and falls back to `DATABASE_URL` from `.env` otherwise. Values set in the shell take precedence over `.env`. Open a new terminal afterwards, or remove the variable as shown, so later local commands don't point at Neon.

## 5. Meta (Facebook Login) settings

In [Meta for Developers](https://developers.facebook.com/apps), open your app → **Facebook Login for Business → Settings → Valid OAuth Redirect URIs** and add:

```
https://<your-domain>/api/integrations/instagram/callback
```

It must exactly match `META_REDIRECT_URI`. Also add your domain under **App settings → Basic → App domains**. Keep the `http://localhost:3000/...` URI if you still connect Instagram locally.

### Publishing to Instagram

Publishing uses the Instagram Graph API's single-image flow (create a container from the image URL and caption, wait until Instagram has processed it, then publish it). It needs:

- **The `instagram_content_publish` permission.** The app already requests it at login. Businesses that connected before it was granted must reconnect. Until Meta approves it in **App Review** (Advanced Access), it only works for people with a role on the Meta app (admins, developers, testers) and their Instagram accounts.
- **Public images.** `STORAGE_PROVIDER=vercel-blob` on a public Blob store. Instagram only accepts JPEGs between 4:5 and 1.91:1, so at publish time the app stores a converted, centre-cropped JPEG copy under `ig-publish/`, passes its URL to Meta, and deletes it afterwards.
- **"Publish now"** (on a draft in the Post Generator, or a queued post) works as soon as Instagram is connected.
- **The daily job** is scheduled in `vercel.json` (`/api/cron/daily`, 03:00 UTC, which Hobby allows): Instagram reconnect alerts, then a weekly report and weekly AI recommendations for each business whose last one is a week old. AI calls are spaced to `GEMINI_TEXT_RPM`. It needs `CRON_SECRET` like publishing. If you add the publish cron to `vercel.json`, keep this entry in the same `crons` list.
- **Scheduled publishing** needs something to call `GET /api/cron/publish` with `Authorization: Bearer <CRON_SECRET>`, ideally every 5 minutes:
  - **Vercel Pro:** add `"crons": [{ "path": "/api/cron/publish", "schedule": "*/5 * * * *" }]` to `vercel.json`. Vercel sends the `CRON_SECRET` header itself.
  - **Vercel Hobby:** crons can run at most once a day there (and a more frequent schedule fails the deploy), so use an external scheduler instead, e.g. [cron-job.org](https://cron-job.org): URL `https://<your-domain>/api/cron/publish`, every 5 minutes, header `Authorization: Bearer <CRON_SECRET>`.

  A post more than 6 hours late (scheduler down) isn't published late. It fails as "missed" and goes back to the drafts.

### Post monitoring (hourly job)

"Monitor this post" reads a post's numbers every hour for durations up to 3 days, and once a day for longer ones. The hourly readings need something to call `GET /api/cron/monitor` every hour with the same `CRON_SECRET` header. The daily job (`/api/cron/daily`) runs the same sweep once a day as a fallback, so daily monitoring and the end-of-monitoring summaries keep working without it; only the hourly readings depend on the hourly call.

- **Vercel Hobby (cron-job.org):** create a cron job with
  - URL: `https://<your-domain>/api/cron/monitor`
  - Schedule: every hour (e.g. minute 5 of every hour: `5 * * * *`)
  - Request method: `GET`
  - Advanced → Headers: `Authorization` = `Bearer <CRON_SECRET>` (the same value as the Vercel variable)
  - Timeout: the maximum cron-job.org allows (the job answers within a few seconds normally; it stops starting new work after 4 minutes).

  A `200` answer with a JSON summary (`read`, `reused`, `ended`, `summarized`, `failed`) means it worked; `401` means the header doesn't match `CRON_SECRET`; `503` means `CRON_SECRET` isn't set on Vercel.
- **Vercel Pro:** add `{ "path": "/api/cron/monitor", "schedule": "5 * * * *" }` to the `crons` list in `vercel.json` instead.

Each reading is at most two Instagram calls per monitored post (counts + insights), businesses that Meta asked to slow down are skipped until the next run, and a plan can monitor at most 5 posts at once by default (admin System page → *Limits per plan*). Optional: `MONITOR_CRON_BATCH` (readings per run, default 100).

### Instagram DM replies (messaging webhooks)

Customers' Instagram DMs reach the app through a webhook. The app drafts an AI reply into the Engagement approval queue, and a person approves it before it is sent. Set it up once per Meta app:

1. **Deploy first.** Meta checks the URL while you save it, so `/api/webhooks/instagram` must be live with `META_WEBHOOK_VERIFY_TOKEN` set.
2. **Use case / products.** In your app, make sure **Messenger** (or the *Engage with customers on Messenger from Meta* use case) is added. Instagram messaging with Facebook Login runs on the Messenger Platform.
3. **Webhooks.** Open **Webhooks** in the app dashboard, choose the **Instagram** object, and click **Subscribe to this object**:
   - Callback URL: `https://<your-domain>/api/webhooks/instagram`
   - Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`

   Click **Verify and save**, then **Subscribe** to the **`messages`** field. The other fields (reactions, seen, postbacks) aren't used.
4. **Permissions.** Login requests `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, `pages_show_list` and `business_management` (plus the others the app already uses). `pages_manage_metadata` is new: businesses that connected earlier must **reconnect** once and allow it.
5. **Page subscription.** It's automatic: after connecting (or the next "Sync now"), the app subscribes the business's Facebook Page to the `messages` webhooks (`POST /{page-id}/subscribed_apps`). The integration log shows "Page … subscribed to Instagram messaging webhooks", or a warning if a permission is missing.
6. **Instagram setting.** On the Instagram professional account: **Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages** must be on.
7. **App mode and review.** Webhooks are only delivered while the app is **Live** (published). Until Meta approves **Advanced Access** for `instagram_manage_messages` (and `pages_manage_metadata`) in App Review, it only works for people with a role on the app (admins, developers, testers) and their accounts. App Review needs Business Verification, a privacy policy URL, and a screencast of a DM arriving, the draft being approved, and the reply arriving in Instagram.

Rules Instagram enforces: replies only within **24 hours** of the customer's last message (older drafts expire in the queue), DMs at most **1,000 characters**, and Meta rate limits apply.

## 6. Create the first admin

Production has no users, and the seed never runs there. Create one admin from your machine against Neon. The script inserts that one user, refuses to run if the email already exists, and never changes or deletes anything else. The password is read without echo and is never printed or logged.

In PowerShell, from the project folder:

```powershell
$env:DATABASE_URL = Read-Host "Neon connection string (pooled or direct)"
npm run create-admin
Remove-Item Env:DATABASE_URL
```

The script asks for the email, the name and the password (twice, hidden). It then shows the target database (host and database name only, no credentials) and asks for confirmation before it writes anything. The password has to meet the app's normal rules: 8 to 200 characters, at least one letter and one number, and it can't contain the name or the email's local part.

For non-interactive use you can set `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` in the shell instead of answering the prompts. Remove them right after the run, and never put them in `.env` or a file. Without a terminal, the confirmation step is skipped.

Then sign in at `https://<your-domain>/login`.

## 7. Deploy checklist

1. Neon project created; pooled and direct URLs copied.
2. Public Blob store created and connected (`BLOB_READ_WRITE_TOKEN` present).
3. All variables from section 3 set for Production, including `STORAGE_PROVIDER=vercel-blob`, `DEMO_ACCOUNTS_ENABLED=false` and `AUTH_URL=https://<your-domain>`.
4. Domain added in Vercel. `AUTH_URL` and `META_REDIRECT_URI` use that domain.
5. Redirect URI added in Meta.
6. Deploy to Production. The build log should show `prisma migrate deploy` applying the migrations.
7. Run `npm run create-admin` against Neon (section 6), then sign in.

---

## Known limitations on Vercel serverless

| Area | What happens on Vercel | Acceptable for now? |
| --- | --- | --- |
| **Rate limiter** (`RATE_LIMIT_STORE="memory"`) | Counters live in each function instance's memory. Separate instances don't share them, and they reset on a cold start. Login, sign-up, reset, sync and image-generation limits become best-effort: an attacker can get more attempts than the limit allows. | **Yes, at low traffic.** Passwords are bcrypt-hashed and checked by policy. Before real growth, add a Redis/Upstash `RateLimiter` (`lib/server/rate-limit.ts`). Callers don't need to change. |
| **Upload size** | Vercel rejects function request bodies over **4.5 MB**. Avatars and logos (2 MB) are fine. Post images (up to 8 MB in the UI) and brand-post videos (up to 50 MB) fail above 4.5 MB with a 413 error. | **Mostly.** Typical phone photos fit. Fixing it properly means direct browser-to-Blob uploads (`@vercel/blob/client`). |
| **Email** | With `EMAIL_PROVIDER="resend"`, emails are sent during the request. If Resend fails, sign-up still succeeds and the banner offers "Resend verification email"; reset and invite show a friendly error. There is no retry queue. | **Yes.** Users can resend; failures are in the function logs as `[email:resend]`. |
| **Background sync** (`after()`) | Instagram syncs after connecting and auto-syncs run after the response is sent, within the function's maximum duration. A very large account could be cut off. | **Yes.** Syncs are incremental, and "Sync now" picks up the rest. |
| **Local file storage** | The disk is read-only and per-instance. With `STORAGE_PROVIDER="vercel-blob"`, nothing writes to disk. `/api/uploads/*` only serves `local` files and just returns 404 on Vercel. | **Yes**, as long as `STORAGE_PROVIDER` is `vercel-blob`. |
| **Mock-media colour extraction** | Reads `public/mock-media/*.svg` from disk for demo (`mock`) Instagram data. Those files may not be inside the function bundle, so it falls back to no colours. | **Yes.** It's demo-only, and the failure is silent. |
| **Prisma client** | One client per function instance over Neon's pooler (PgBouncer). | **Yes.** |
| **Publishing** | "Publish now" waits for Instagram inside the request (usually a few seconds, up to about 1 minute; `maxDuration` is 120 s). The cron publishes due posts one by one for up to 4 minutes per run, and the rest wait for the next run. | **Yes.** A run that dies mid-publish leaves the post "interrupted" (failed, with a note to check Instagram) instead of risking a double post. |
