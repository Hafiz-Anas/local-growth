# Deploying to DigitalOcean Kubernetes (DOKS)

The app runs on DigitalOcean Kubernetes with a managed PostgreSQL database, a private Spaces bucket for
files and a managed Valkey (Redis) for shared counters. The client's DevOps team creates the cloud
resources and secrets; the repository holds everything else: the `Dockerfile`, the `k8s/` manifests and
two GitHub Actions workflows.

**The Vercel deployment is not affected.** Everything DigitalOcean-specific is switched on by environment
variables that Vercel doesn't set (`STORAGE_PROVIDER=spaces`, `RATE_LIMIT_STORE=redis`,
`BACKGROUND_MODE=worker`, `NEXT_OUTPUT=standalone`). DEPLOY.md still describes Vercel.

---

## What the client provides

Fill these in before the first deploy. Every `CHANGE_ME`, `APP_DOMAIN`, `REGISTRY_NAME`, `SPACES_REGION`
and `SPACES_BUCKET` in `k8s/` must be replaced (search the folder).

| # | Item | Where it goes |
| --- | --- | --- |
| 1 | **Domain** for the app, e.g. `app.example.com` (`APP_DOMAIN`) | `k8s/ingress.yaml`, `k8s/configmap.yaml` (`AUTH_URL`, `META_REDIRECT_URI`, `EMAIL_FROM`) |
| 2 | **DOKS cluster** name (Kubernetes 1.27 or newer) | GitHub variable `DOKS_CLUSTER` |
| 3 | **Container Registry** name (`REGISTRY_NAME`), connected to the cluster | `k8s/kustomization.yaml`, GitHub variable `DOCR_REGISTRY` |
| 4 | **Spaces** bucket name and region, e.g. `fra1` | `k8s/configmap.yaml` (`SPACES_ENDPOINT`, `SPACES_REGION`, `SPACES_BUCKET`) |
| 5 | **Spaces access key** pair limited to that bucket | Secret `SPACES_KEY`, `SPACES_SECRET` |
| 6 | **Managed PostgreSQL** 16 or 17: a database and user for the app, a connection pool | Secret `DATABASE_URL` (pool), `DIRECT_URL` (direct) |
| 7 | **Managed Valkey** (Redis-compatible) | Secret `REDIS_URL` |
| 8 | **ingress-nginx** and **cert-manager** in the cluster, with a ClusterIssuer (default name `letsencrypt-prod`) | `k8s/ingress.yaml` annotation |
| 9 | **DNS**: an `A` record for the domain → the ingress load balancer's IP | DNS provider |
| 10 | **Resend** API key and a verified sending domain | Secret `RESEND_API_KEY`, ConfigMap `EMAIL_FROM` |
| 11 | **Gemini** API key | Secret `GEMINI_API_KEY` |
| 12 | **Meta app**: app ID, app secret, webhook verify token | ConfigMap `META_APP_ID`; Secret `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` |
| 13 | A **DigitalOcean API token** for GitHub Actions (registry write + Kubernetes) | GitHub secret `DIGITALOCEAN_ACCESS_TOKEN` |
| 14 | The first **admin**'s email and name | `npm run create-admin` (step 8) |

---

## How it fits together

```
          Internet ──HTTPS──▶ Load balancer ─▶ ingress-nginx ─▶ Service lge-web ─▶ lge-web pods (2)
                                                                                     │
  CronJobs (publish every minute, monitor hourly, daily 03:00 UTC) ─┐                │ PostgreSQL (managed)
                                                                    ▼                │ Valkey (managed)
                                              Service lge-worker ─▶ lge-worker pod ──┤ Spaces (private bucket)
                                              (+ poller: publish every 15 s)         │
  Migration Job (before each rollout) ───────────────────────────────────────────────┘
```

- **lge-web**: user traffic. Readiness `/api/health?ready=1` (checks the database), liveness `/api/health`.
- **lge-worker**: the same image, not reachable from outside. Publishing (scheduled posts and "Post now")
  runs here; a small `poller` container calls the publish route every 15 seconds. Jobs are stored in the
  database and leased, so a post is never published twice even if runs overlap.
- **CronJobs**: curl pods that call the worker's cron routes inside the cluster with `CRON_SECRET`.
- **Files**: the bucket is private. The app keeps its own link for each file (`/api/files/<key>`), checks
  that the person asking belongs to the file's business (or is an admin), and redirects to a link signed for
  10 minutes. Gallery photos go straight from the browser to Spaces with a presigned upload form; Instagram
  gets a link signed for an hour when it downloads a photo to publish.
- **Valkey**: rate limits (logins, AI calls, uploads) and the Gemini request budget are shared by every pod.
  If Valkey doesn't answer, each pod falls back to its own in-memory counters and logs a warning.

---

## 1. Create the cloud resources

1. **Container Registry.** Create it and, under *Kubernetes → your cluster → Settings*, enable the
   registry integration so every namespace can pull from it.
2. **Kubernetes cluster** (DOKS, 1.27+), at least 2 nodes of 2 vCPU / 4 GB.
3. **ingress-nginx** (Marketplace 1-click or Helm). So the app sees the visitor's real IP (login rate limits
   depend on it), turn on PROXY protocol on both sides:
   - on the ingress controller's Service: annotation
     `service.beta.kubernetes.io/do-loadbalancer-enable-proxy-protocol: "true"`
   - in the ingress-nginx ConfigMap: `use-proxy-protocol: "true"`
4. **cert-manager** with a `ClusterIssuer` named `letsencrypt-prod` (HTTP-01 through the nginx class).
5. **Managed PostgreSQL** in the same region and VPC. Create the database and user, then a **connection
   pool** (*Connection Pools*, transaction mode, ~20 connections). Add the cluster as a trusted source.
   - `DATABASE_URL` = the **pool**'s connection string, with `?sslmode=require`
   - `DIRECT_URL` = the **direct** connection string (port 25060), with `?sslmode=require` (migrations)
6. **Managed Valkey** in the same region; add the cluster as a trusted source.
   `REDIS_URL` = `rediss://default:<password>@<host>:<port>` (TLS).
7. **Spaces bucket**, **private** (file listing restricted), in the same region. Create an access key with
   access to this bucket only. Apply this **CORS** rule (*Settings → CORS*, or with `s3cmd setcors`):

   ```xml
   <CORSConfiguration>
     <CORSRule>
       <AllowedOrigin>https://APP_DOMAIN</AllowedOrigin>
       <AllowedMethod>GET</AllowedMethod>
       <AllowedMethod>HEAD</AllowedMethod>
       <AllowedMethod>PUT</AllowedMethod>
       <AllowedMethod>POST</AllowedMethod>
       <AllowedHeader>*</AllowedHeader>
       <ExposeHeader>ETag</ExposeHeader>
       <MaxAgeSeconds>3000</MaxAgeSeconds>
     </CORSRule>
   </CORSConfiguration>
   ```

   Do **not** enable the Spaces CDN or public access: files are only ever opened through signed links.
8. **DNS**: once ingress-nginx is installed, point an `A` record for `APP_DOMAIN` at its load balancer IP.

## 2. Secrets and settings

**Secret `lge-secrets`** (names in `k8s/secret.example.yaml`; never commit values):

| Name | What |
| --- | --- |
| `DATABASE_URL` | Managed PostgreSQL **pool** URL (`?sslmode=require`) |
| `DIRECT_URL` | Managed PostgreSQL **direct** URL (migrations only) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — encrypts Instagram tokens; **never change it** once there is data |
| `CRON_SECRET` | `openssl rand -base64 32` |
| `SPACES_KEY`, `SPACES_SECRET` | Spaces access key pair |
| `REDIS_URL` | Managed Valkey URL (`rediss://…`) |
| `RESEND_API_KEY` | Resend API key |
| `GEMINI_API_KEY` | Google AI Studio key |
| `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | Meta app secret; any long random string for the webhook |

```bash
kubectl apply -f k8s/namespace.yaml
kubectl -n lge create secret generic lge-secrets --from-env-file=lge-secrets.env   # a local file, not committed
```

**ConfigMap `lge-config`** (`k8s/configmap.yaml`, committed): replace `APP_DOMAIN`, `SPACES_REGION`,
`SPACES_BUCKET` and `META_APP_ID`. Every variable is described in `.env.example`.

## 3. Meta (Instagram) settings

In Meta for Developers, for the app:
- Facebook Login for Business → **Valid OAuth Redirect URIs**: `https://APP_DOMAIN/api/integrations/instagram/callback`
- App settings → Basic → **App domains**: `APP_DOMAIN`
- Webhooks → Instagram: callback `https://APP_DOMAIN/api/webhooks/instagram`, verify token = `META_WEBHOOK_VERIFY_TOKEN`

(Permissions, App Review and Page Publishing Authorization: same as DEPLOY.md.)

## 4. GitHub

- **Docker build check** (`.github/workflows/docker-build.yml`) runs on every push without secrets: it
  builds both images, applies the migrations to a throwaway Postgres and checks `/api/health` and readiness.
- **Deploy to DigitalOcean** (`.github/workflows/deploy-doks.yml`) is manual and does nothing until enabled.
  Set, under *Settings → Secrets and variables → Actions*:
  - secret `DIGITALOCEAN_ACCESS_TOKEN`
  - variables `DOKS_CLUSTER`, `DOCR_REGISTRY`, and finally `DOKS_ENABLED` = `true`
  - optionally an environment named `production` with required reviewers (the job uses it)

## 5. Deploy

*Actions → Deploy to DigitalOcean (DOKS) → Run workflow* (leave *image_tag* empty). It:

1. builds `lge-web` and `lge-migrate` for this commit and pushes them to the registry (tag = commit SHA);
2. runs the **migration Job** (`prisma migrate deploy`: pending migrations only, never the seed) and waits —
   if it fails, nothing is rolled out and the old version keeps running;
3. applies `k8s/` with the new tag and waits for both Deployments to be ready;
4. checks readiness from inside a web pod.

By hand, the same steps: build/push the two targets, then
`sed "s|MIGRATE_IMAGE|<registry>/lge-migrate:<tag>|" k8s/migrate-job.yaml | kubectl apply -f -`,
`kubectl -n lge wait --for=condition=complete job/lge-migrate --timeout=600s`, set `newTag` in
`k8s/kustomization.yaml`, `kubectl apply -k k8s`.

## 6. Check it works

```bash
kubectl -n lge get pods,cronjobs
kubectl -n lge logs deploy/lge-worker -c poller          # silent unless a publish run fails
curl -s https://APP_DOMAIN/api/health?ready=1            # {"status":"ok","checks":{"database":"ok"}}
kubectl -n lge create job --from=cronjob/lge-cron-daily daily-now   # run the daily job once
kubectl -n lge logs job/daily-now
```

## 7. Roll back

- *Run workflow* again with **image_tag** = an earlier commit SHA: it re-deploys that image (no build).
- Or `kubectl -n lge rollout undo deployment/lge-web deployment/lge-worker`.

Migrations are forward-only and additive (new tables and columns), so an older image runs on a newer
schema. Never roll the database back by hand.

## 8. First admin

Production starts empty and never runs the seed. From a computer with the repository and Node.js, against
the **direct** database URL (add your IP as a trusted source first, remove it afterwards):

```powershell
$env:DATABASE_URL = Read-Host "Managed PostgreSQL DIRECT connection string"
npm run create-admin
Remove-Item Env:DATABASE_URL
```

## 9. Moving existing data later (not built yet)

DigitalOcean starts with a fresh database. If the client later wants the Vercel/Neon data and files:

1. **Database**: put the Vercel app in maintenance, `pg_dump --no-owner --no-acl` from Neon's direct URL,
   `pg_restore` into the empty DigitalOcean database (before the first migration Job, or into a database
   already at the same migration level), then run the migration Job.
2. **Files**: Vercel Blob files are public and their links are stored in the database. They keep working
   from DigitalOcean as they are (the app shows them and Instagram can download them), but the Spaces
   provider doesn't own them (it won't delete them). To move them: a one-off script would list every stored
   Blob link (photos, brand posts, logos, avatars, drafts, publish copies, style picks), copy each file into
   Spaces under the business's key, and rewrite the link to `/api/files/<key>` — in batches, idempotent,
   with a dry run first. Then the Blob store can be removed.
3. Instagram tokens stay valid only if `ENCRYPTION_KEY` is the **same** value as on Vercel.

## 10. Try it locally (optional, needs Docker)

`docker-compose.prod.yml` runs the production image with Postgres, Valkey and MinIO (an S3-compatible
stand-in for Spaces):

```bash
docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml --profile seed run --rm seed   # demo data, optional
# http://localhost:3000  ·  http://localhost:3000/api/health?ready=1  ·  MinIO console http://localhost:9001
docker compose -f docker-compose.prod.yml down -v
```

## Known limits

| Area | What happens | OK for now? |
| --- | --- | --- |
| Background work after a response (`after()`) | Syncs, style guides and webhook processing finish after the response on the web pods; a pod replaced mid-task drops it (it runs again on the next trigger). Publishing is durable and runs on the worker. | Yes |
| Gemini per-minute budget in Valkey | Counted in fixed one-minute windows (not rolling): at a minute boundary up to twice `GEMINI_TEXT_RPM` can go out within a few seconds. | Yes (Google's quota is per minute too) |
| Meta "slow down" cooldown | Kept per pod in memory. | Yes |
| Old file links | Files saved before this setup (or without a business, e.g. avatars) open for any signed-in user, not just their business. | Yes (keys are random) |
