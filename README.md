# Local Growth Engine

AI-powered Instagram growth and management for local businesses — by Raid Technologies.

A Next.js 16 app with a PostgreSQL database, real authentication, role-based access and per-business feature permissions enforced on the server. Instagram data, AI generation and email are behind service interfaces with mock implementations until those integrations land (see [What's real and what's mocked](#whats-real-and-whats-mocked)).

## Requirements

- Node.js 20+ (developed on 24)
- Docker Desktop (for the local PostgreSQL), or any PostgreSQL 15+ server

## Setup

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then fill in AUTH_SECRET and ENCRYPTION_KEY (see below)
npm run db:up               # starts PostgreSQL in Docker (docker compose up -d)
npm run db:migrate          # creates the tables
npm run db:seed             # demo businesses, users and data
npm run dev                 # http://localhost:3000
```

Generate the two secrets for `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
```

### Docker / PostgreSQL

`docker-compose.yml` runs `postgres:17-alpine` on port **5432** with user/password `lge` / `lge` and database `local_growth_engine`, matching `DATABASE_URL` in `.env.example`. Data lives in the `lge-pgdata` volume.

| Command | What it does |
|---|---|
| `npm run db:up` | Start PostgreSQL (`docker compose up -d`) |
| `npm run db:down` | Stop it (data is kept) |
| `docker compose down -v` | Stop it **and delete all data** |

Using your own PostgreSQL instead? Create a UTF-8 database (`CREATE DATABASE local_growth_engine ENCODING 'UTF8' TEMPLATE template0;` — Arabic content needs UTF-8) and point `DATABASE_URL` at it.

### Migrations and seed

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply migrations in development (`prisma migrate dev`); creates a new one if `prisma/schema.prisma` changed |
| `npm run db:deploy` | Apply migrations in production (`prisma migrate deploy`) |
| `npm run db:seed` | **Wipes all tables** and loads the demo data again |
| `npm run db:reset` | Drop the database, re-apply every migration, then seed |

The seed is the way to get back to a clean demo state (e.g. after testing password changes or deleting a business).

### Viewing the database

```bash
npx prisma studio
```

Opens Prisma Studio at http://localhost:5555 — browse and edit every table (users, businesses, feature permissions, drafts, activity log …). `npm run db:studio` does the same.

> Changing `FeaturePermission` rows directly in Studio reaches signed-in users within 5 minutes. Changes made through the admin screens apply on the user's next click.

### Run

```bash
npm run dev                       # development, http://localhost:3000
npm run build && npm start        # production build
npm run lint                      # ESLint
npm run typecheck                 # next typegen + tsc --noEmit
```

## Demo accounts

| Role | Email | Password | Business | Plan | Instagram |
|---|---|---|---|---|---|
| Admin | admin@localgrowth.dev | Admin@123 | — | — | — |
| User | user@mathanetbaity.dev | User@123 | Mathanet Baity (@mathanet_baity) | Pro | Connected |
| User | cafe@localgrowth.dev | User@123 | Dalla & Bean (@dallabean.kw) | Growth (+ trending audio, heatmap) | Needs attention (token expires in 3 days) |
| User | boutique@localgrowth.dev | User@123 | Noor Boutique (@noorboutique.kw) | Starter (− top post) | Disconnected |
| User | bakery@localgrowth.dev | User@123 | Fereej Bakery (self sign-up, onboarding stopped at step 3) | Starter | Skipped |

The login page lists these accounts while `DEMO_ACCOUNTS_ENABLED="true"`. Set it to `"false"` in production.

## Self-onboarding

Anyone can create an account at `/signup` (name, email, password, business name). The business starts on the admin-configured **default plan for self sign-ups** (*Admin → System*) and goes straight to the full-screen wizard at `/onboarding`:

1. **Your business** — type, location, Instagram languages, what they sell, products, audience
2. **Connect Instagram** — recommended, can be skipped (the dashboard then shows a reminder)
3. **Competitors** — at least 5 handles that `InstagramService.lookupBusinessAccount` reports as *Ready*
4. **Your posts** — exactly 5, picked from Instagram or uploaded (JPG/PNG/WebP ≤ 8 MB, MP4 ≤ 50 MB), each with a purpose
5. **Brand basics** — colours suggested from the post images (server-side, `sharp`), logo, tone, words to use/avoid
6. **Review & build** — `AIService.buildBrandContext` creates a versioned `BrandContext`, which the user edits and confirms

The current step is saved on the business, so logging out and back in resumes it; the (user) layout sends anyone with onboarding in progress back to the wizard. Afterwards the brand profile lives in *Settings → Brand profile* and the Post Generator writes with it. Admins can send an existing client through the wizard with *Send onboarding invite* on the client page.

**Testing helpers (mock services):**

- Competitor handles starting with `private_` → Private, `personal_` → Not a business account, `missing_` → Not found; your own handle → Your own account; anything else is Ready.
- A business description containing `[ai-fail]` makes "Build my brand profile" fail (to test the error path).
- Verification and invite emails are printed in the `npm run dev` terminal (`[email:console] Verify your email`).
- Sign-up is rate-limited to 5 attempts per IP per 15 minutes (in memory — restarting the dev server resets it).

**Instrumentation.** Every step start/finish, back-navigation, validation error, failed upload, failed competitor lookup and page close is stored as an `OnboardingEvent`; "Report a problem" on each step saves a `Feedback` note. *Admin → Onboarding* shows the funnel, each business's current step, time per step, errors and reports.

**Forgot password:** with `EMAIL_PROVIDER="console"`, the reset link is printed in the terminal running `npm run dev` (look for `[email:console] Password reset`). Links are single-use and expire after 1 hour.

## Environment variables

All variables are listed in `.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Signs/encrypts the session cookie (Auth.js) |
| `AUTH_URL` | Public URL of the app — used in password-reset links |
| `ENCRYPTION_KEY` | 32-byte base64 key for AES-256-GCM encryption of Instagram tokens |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | Email implementation (`console`) and sender |
| `INSTAGRAM_PROVIDER` | How new Instagram connections are made: `mock` or `meta` (existing connections keep their provider) |
| `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_GRAPH_VERSION` | Meta app for Facebook Login / Graph API (see [Meta / Instagram integration](#meta--instagram-integration)); Meta stays off while the secret is empty |
| `AI_PROVIDER` | Caption/reply generation (`mock`) |
| `STORAGE_PROVIDER`, `UPLOAD_DIR` | File storage (`local` with its folder, or `vercel-blob` + `BLOB_READ_WRITE_TOKEN` in production) |
| `RATE_LIMIT_STORE` | Rate-limit store (`memory`) |
| `DEMO_ACCOUNTS_ENABLED` | Show demo logins on the login page |

## Folder structure

```
app/
  (auth)/                 login, signup, forgot-password, reset-password
  (onboarding)/onboarding full-screen self-onboarding wizard
  verify-email/           email verification link target
  (user)/                 client screens: dashboard, competitors, post-generator,
                          experiment, engagement, settings
  (admin)/admin/          overview, clients, clients/[clientId], onboarding, system
  api/                    JSON API (route handlers) — see "API" below
auth.ts                   Auth.js config: credentials login, JWT session, per-request session checks
proxy.ts                  route protection (Next 16's middleware)
components/
  <feature>/              one folder per screen (views read data via TanStack Query)
  shared/                 Instagram-style building blocks, skeletons, empty and error states
  providers/              TanStack Query, feedback (toasts + Connect Instagram prompt), preferences sync
  ui/                     primitives (Radix-based)
config/                   feature catalogue, plan presets, navigation, demo accounts
lib/
  api/                    browser API client, query hooks, error messages
  auth/                   session helpers, server actions, password hashing, session claims
  server/                 API guards, JSON helpers, data readers, DTO mappers, rate limiter, activity log
  services/               swappable services: instagram, ai, storage, email (+ mock catalogue)
  validation/             Zod schemas shared by API and forms
  generated/prisma/       generated Prisma client (not committed)
locales/                  en.json, ar.json (all UI text; keep keys in sync)
mock-data/                data behind the mock Instagram/AI services and the seed
prisma/                   schema.prisma, migrations/, seed.ts
store/                    toast / prompt state (zustand)
types/                    shared types; types/api.ts is the API contract
```

## How feature permissions work

1. **Catalogue.** `config/features.ts` declares every switchable feature. Keys are either a module (`engagement`) or a sub-feature (`engagement.dmRules`). A sub-feature only counts when its module is also on. Dashboard and Settings are always available; their widgets are sub-features.
2. **Storage.** Each business has one `FeaturePermission` row per key. A new business gets its plan's preset (`config/plans.ts`: Starter / Growth / Pro), and admins can then switch individual features.
3. **Session.** The signed-in user's effective feature list is stored in the session. Every request checks the database cheaply, so when an admin changes a business's permissions (or suspends a user, or a password changes), the user's next request picks it up.
4. **Enforced on the server, everywhere:**
   - **Pages:** a disabled feature's page answers with the not-found page.
   - **Navigation:** the sidebar is built on the server from the enabled features, so hidden items never reach the browser.
   - **API:** every route checks the feature and answers **404** (not 403) when it's off, so its existence isn't revealed. Responses only include sections whose features are on.
   - **UI widgets:** components use `<Feature flag>` / `useFeature()` to remove (never grey out) disabled parts.
5. **Admin.** *Clients → a business* toggles features and plans (saved immediately, logged in the activity log). *Preview as this client* shows exactly what that business sees, read-only.

## API

Every route returns `{ ok: true, data }` or `{ ok: false, error: { code, message, details? } }`, validates input with Zod, and never returns password hashes or tokens. The business is always taken from the session; requesting another business's record by id returns 404.

- **Account:** `GET /api/me`, `PATCH /api/me/preferences`, `PATCH /api/me/notifications`, `PATCH /api/me/password`, `POST /api/me/avatar`
- **Client screens:** `/api/dashboard`, `/api/competitors` (list, add) and `/api/competitors/:id` (get, edit, remove), `/api/competitors/trends`, `/api/post-generator/options`, `/api/post-drafts` (+ `generate`, `:id`, `:id/regenerate`, `:id/queue`, `:id/reject`), `/api/scheduled-posts[/:id]`, `/api/experiment` (+ `apply-window`), `/api/engagement` (+ `settings`, `rules[/:id]`), `/api/reply-drafts` (+ `:id`, `:id/approve`, `:id/dismiss`), `/api/brand-voice`, `/api/instagram/connection`
- **Onboarding & brand:** `GET /api/onboarding`, `PUT /api/onboarding/business`, `POST /api/onboarding/progress`, `POST /api/onboarding/competitors` (+ `DELETE :id`), `POST /api/onboarding/events`, `POST /api/onboarding/feedback`, `POST /api/onboarding/complete`, `GET /api/brand`, `/api/brand/posts` (+ `:id`, `:id/media`), `PUT /api/brand/basics`, `GET /api/brand/colors`, `/api/brand/logo`, `/api/brand/context` (GET, POST = build/rebuild, PATCH = edit), `GET /api/instagram/media`, `POST /api/me/verify-email`
- **Admin:** `/api/admin/overview`, `/api/admin/businesses[/:id]` (+ `permissions`, `permissions/preset`, `brand`, `onboarding-invite`), `/api/admin/users[/:id]` (+ `reset-password`, `suspend`, `reactivate`), `/api/admin/activity`, `/api/admin/preview/:businessId`, `/api/admin/system`, `/api/admin/onboarding`, `/api/admin/settings`
- **Auth:** `/api/auth/*` (Auth.js), `/api/password-reset/request`, `/api/password-reset/confirm`

Error codes the UI turns into friendly messages: `validation_error`, `unauthorized` (→ back to login), `forbidden`, `not_found`, `conflict`, `rate_limited`, `invalid_password`, `invalid_token`, `payload_too_large`, `unsupported_media_type`, `instagram_not_connected` (→ "Connect Instagram" prompt), `instagram_error`, `internal_error`.

## Meta / Instagram integration

Real Instagram data comes through **"Instagram API with Facebook Login"** (Facebook Login for Business) — the route that includes business discovery, which competitor tracking needs. The mock stays: each connection remembers its provider (`InstagramConnection.provider`), so seeded demo businesses keep their mock data while businesses connected through Facebook get real data. `INSTAGRAM_PROVIDER` only decides how **new** connections are made (`mock` = instant demo connection, `meta` = Facebook Login).

**Setup:** set `META_APP_SECRET` in `.env` (Meta for Developers → App settings → Basic), set `INSTAGRAM_PROVIDER="meta"`, restart `npm run dev`. Without the secret the server prints a warning at startup and Meta features stay off (no crash). The redirect URI `http://localhost:3000/api/integrations/instagram/callback` must be listed in the app's Facebook Login for Business settings.

**Connect flow** (`lib/server/meta-connect.ts`, routes under `app/api/integrations/instagram/`):

1. `start` stores a random `state` in an encrypted httpOnly cookie bound to the user and business (10 minutes), then redirects to `https://www.facebook.com/v26.0/dialog/oauth` (`display=page`, `extras={"setup":{"channel":"IG_API_ONBOARDING"}}`, the 8 scopes).
2. Meta returns to `callback` with `?code` → the code is exchanged **server-side** with the app secret, then for a long-lived token (~60 days), checked with `/debug_token` (must be issued to our app) and used for `/me/accounts`. Meta's Business Login docs also describe a mode that returns the token in the URL fragment; set `META_OAUTH_RESPONSE_TYPE="token"` if the code flow is refused — `callback` then serves a tiny page that clears the URL and posts the token once to `token`.
3. One Page with an Instagram professional account → connected. Several → a picker (`pending`, choices kept 15 minutes, tokens encrypted server-side). None → a help screen. Cancel → a calm message where the user started. An account already connected to another business is refused.
4. Stored encrypted in one blob (`InstagramConnection.credentialsEncrypted`): user token + expiry, Page id + token, Instagram account id, granted scopes. The account id is also stored as an HMAC (`igAccountKey`) to detect duplicates without decrypting. Tokens are never sent to the browser or logged; every Graph call carries `appsecret_proof`. Disconnect deletes them.

**Data and sync** (`lib/server/instagram-sync.ts`): pages never call Meta on load — they read what the sync stored (`InstagramMedia`, `InstagramMediaComment`, `InstagramAccountSnapshot`, the profile and insights on the connection). The sync runs on connect (profile + last 50 posts before the redirect, insights + comments right after), on **Settings → Sync now** (1/min), and in the background when the data is older than 6 hours. New customer comments get AI reply drafts in Engagement; approving one replies on Instagram. Competitor lookups are cached 6 hours and every refresh saves a `CompetitorSnapshot`, which drives the follower change and engagement trend.

**Errors:** Meta error 190 → connection `NEEDS_RECONNECT` and a "Reconnect Instagram" banner. Missing permission → listed on the connection, shown with "Reconnect and allow" (asks again with `auth_type=rerequest`). Rate limits (4, 17, 32, 613, 80001+) and the usage headers → short backoff, or a cool-down during which background syncs skip the business. Metrics Meta doesn't return (small/new accounts) show "Not available yet for this account" and are logged. Every failure is an `IntegrationEvent` — admins see the **Integration log** on the client page and the Onboarding page, plus token and data-access expiry.

**Competitor validation — what business discovery can tell us:**

| Meta's answer | Status |
|---|---|
| Success | `READY` |
| The handle is the business's own account (checked before calling, and by returned id) | `OWN_ACCOUNT` |
| Error 110 / subcode 2207013 "user … cannot be found" | `NOT_FOUND` — Meta returns this same error for a username that doesn't exist **and** for personal accounts (public or private), so the message says "not found, or a personal/private account" |
| Error 100/33, 24, other 110 | `NOT_FOUND` |
| — | `PRIVATE` and `NOT_BUSINESS` are never returned for Meta lookups: business/creator accounts can't be private, and personal accounts are indistinguishable from missing ones (they remain for the mock) |
| Token, permission, rate-limit or server errors | Not a status: the request fails with a reconnect / permission / "try again" message |

**Still simulated with a Meta connection** (labelled in the app): publishing — Meta downloads media from a public HTTPS URL and uploads are on local disk (the real `publishImage` code is ready for when a public `StorageService` exists); DM automation — needs webhooks on a public HTTPS domain; trending audio/hashtags — not in the Graph API.

**Tests:** `npm test` runs the mapping and client tests in `tests/meta/` against recorded sample responses (`tests/meta/fixtures.json`: success, several Pages, no Page, expired token, rate limits, permission errors, business discovery not found, unsupported metrics).

## What's real and what's mocked

**Real**

- PostgreSQL database via Prisma: users, businesses, permissions, drafts, scheduled posts, experiments, DM rules, reply drafts, brand voice, competitors, activity log
- Authentication: Auth.js credentials with bcrypt hashes, httpOnly JWT session cookie, roles (admin / user)
- Login rate limiting (5 failed attempts per 15 minutes per IP + email) behind a `RateLimiter` interface
- Password reset (hashed single-use tokens, 1-hour expiry), password change, admin password reset. Any password change signs the user out everywhere. Suspension takes effect on the next request.
- Feature permissions enforced in pages, navigation and every API route, with optimistic admin toggles
- Profile photo upload (JPG/PNG/WebP, 2 MB, type checked from the file's contents)
- Preferences (theme, language, sidebar) and notification settings saved per user
- Instagram access tokens encrypted at rest (AES-256-GCM)
- Real Instagram via Meta (Facebook Login for Business): connect, profile, posts, insights, comments and replies, competitor business discovery with history — see [Meta / Instagram integration](#meta--instagram-integration)
- Admin activity log for every admin action and most user actions
- Public sign-up with email verification (hashed single-use tokens, 48 h), self-onboarding wizard with saved progress, brand posts (uploads type-checked from content), server-side colour extraction, versioned brand contexts, onboarding events and problem reports

**Mocked (behind interfaces in `lib/services`, chosen by environment variables)**

| Area | Mock today | To go live |
|---|---|---|
| Instagram for demo/mock connections — profile numbers, insights, comments, trends, competitor profiles | `MockInstagramService` serves `mock-data/` (new businesses get empty data); mock "connect" approves instantly | Connect through Facebook (`INSTAGRAM_PROVIDER=meta`): `MetaInstagramService` is real |
| Instagram with a Meta connection — publishing, DM automation, trends, API health | Publishing and DMs simulated (need public HTTPS hosting / webhooks); no trends; health is mock | Public `StorageService` (publishing code is ready), webhooks |
| AI captions and reply drafts | `MockAIService` fills caption templates with brand words and the brand context | Implement `AIService` (e.g. Claude), set `AI_PROVIDER` |
| Brand profile (`buildBrandContext`) | Template sentences built from the onboarding answers | Same interface, real model |
| Competitor validation (`lookupBusinessAccount`) for mock connections | Handle prefixes decide the status (see *Self-onboarding*) | Real for Meta connections (business discovery) |
| Instagram posts in the post picker for mock connections | Generated posts with stand-in images from `public/mock-media` (`node scripts/generate-mock-media.mjs`) | Real for Meta connections (synced posts) |
| Product catalogue for the Post Generator | `lib/services/catalog.ts` reads `mock-data/`; other businesses use their onboarding products and post purposes | A table or the AI provider |
| Email | `ConsoleEmailService` prints messages (reset links) to the server log | Implement `EmailService` (SMTP, Resend, SES …), set `EMAIL_PROVIDER` |
| File storage | `LocalStorageService` writes to `UPLOAD_DIR`, served by `/api/uploads/*`; `VercelBlobStorageService` for production | Set `STORAGE_PROVIDER="vercel-blob"` (see [DEPLOY.md](DEPLOY.md)) |
| Rate limits | In-memory (`RATE_LIMIT_STORE="memory"`) — resets on restart, single instance only | Add a Redis `RateLimiter` |

## Deploying

Production runs on Vercel with Neon PostgreSQL and Vercel Blob. See [DEPLOY.md](DEPLOY.md) for setup, environment variables, migrations (`prisma migrate deploy` only, never the seed) and `npm run create-admin`.

## Troubleshooting

- **`DATABASE_URL is not set`:** copy `.env.example` to `.env`.
- **Port 5432 already in use:** another PostgreSQL is running. Stop it, or change the port mapping in `docker-compose.yml` and in `DATABASE_URL`.
- **Arabic text fails to save (`WIN1252` encoding error):** the database isn't UTF-8. Recreate it as shown under *Docker / PostgreSQL*.
- **"Too many attempts":** the in-memory rate limiter. Wait 15 minutes, or restart `npm run dev`.
- **Signed out unexpectedly:** your password was changed, or an admin suspended you or reset your password. Every existing session ends in those cases by design.
