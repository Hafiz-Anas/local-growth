# AI Growth Engine

Instagram growth and management for local businesses, built by Raid Technologies. Business owners connect their Instagram account to manage a photo gallery, schedule and publish posts, reply to comments and DMs, and get AI-written captions, recommendations and reports. An admin area manages clients, plans and feature access.

Instagram, AI and file storage sit behind service interfaces with mock or local implementations, so the app runs locally without any third-party accounts.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript
- PostgreSQL with Prisma 7
- Auth.js v5 (credentials, JWT sessions)
- TanStack Query, Zustand, Zod
- Tailwind CSS 4, Radix UI / Base UI
- Integrations: Meta Graph API (Instagram), Google Gemini (text and images), Vercel Blob or DigitalOcean Spaces (storage)
- Tests: Node test runner (unit), Playwright (end-to-end)

## Local setup

### Prerequisites

- Node.js 22 or later
- PostgreSQL 15 or later, either through Docker (`docker-compose.yml`) or your own server. The database must use UTF-8 encoding (Arabic content).

### Environment

```bash
cp .env.example .env
```

Set `AUTH_SECRET` and `ENCRYPTION_KEY` in `.env`. Each is a random 32-byte base64 value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The defaults use the mock Instagram and AI services and local file storage. Every variable is described in `.env.example`.

### Database

```bash
npm install          # also generates the Prisma client
npm run db:up        # start PostgreSQL in Docker (skip if you use your own)
npm run db:migrate   # apply migrations
npm run db:seed      # load demo data (wipes existing data)
```

The seed creates demo businesses and logins and prints the logins when it finishes (they are defined in `config/demo.ts`). `npm run db:reset` drops the database, reapplies migrations and seeds again.

### Run

```bash
npm run dev          # http://localhost:3000
npm run build        # production build
npm start            # serve the production build
```


### Test

```bash
npm run typecheck    # next typegen + tsc
npm run lint
npm test             # unit tests (tests/**/*.test.ts), no database needed
npm run test:e2e     # Playwright
```

The end-to-end suite starts its own dev server on port 3001 and reseeds the database, so `DATABASE_URL` must point to a local database whose name contains `e2e` or `test`. See `playwright.config.ts` for the available options.

On Windows, run the dev server, build and tests from the correctly-cased project path; a path with different casing makes Next.js load its internals twice and the build fails.

## Deployment

Production runs as a Next.js server with a managed PostgreSQL database, object storage for uploads, and scheduled calls to the cron routes under `/api/cron/*`. [DEPLOY.md](DEPLOY.md) covers Vercel with Neon and Vercel Blob, including environment variables, migrations and creating the first admin (`npm run create-admin`). [DEPLOY-DIGITALOCEAN.md](DEPLOY-DIGITALOCEAN.md) covers the Docker image and the Kubernetes setup on DigitalOcean (`Dockerfile`, `k8s/`).

## Project structure

```
app/            routes: (auth), (onboarding), (user) client screens, (admin), api/ route handlers
components/     UI, one folder per feature; shared/ and ui/ hold common components
config/         feature catalogue, plans, navigation, demo accounts
lib/
  api/          browser API client and query hooks
  auth/         session helpers and server actions
  server/       server-only logic: guards, data access, background jobs
  services/     Instagram, AI, image and storage services (mock and real)
  analysis/     pure analytics used by insights and recommendations
locales/        UI text (en.json, ar.json)
mock-data/      data for the mock services and the seed
prisma/         schema, migrations, seed
scripts/        one-off and developer scripts (create-admin, webhook simulators, backfills)
tests/          unit tests; tests/e2e/ for Playwright
k8s/            Kubernetes manifests
auth.ts         Auth.js configuration
proxy.ts        route protection
```
