# Deployment

**Current status: not deployed.** This document is the procedure and the
configuration the code actually expects — it is not a claim that a deployment
exists. Every value below is verified against the source.

---

## 1. What you need

| Requirement | Notes |
|---|---|
| Node.js 18+ | Uses `fetch` in tests, ES modules in the browser, `crypto.scrypt` |
| MongoDB 6+ | Atlas free tier is enough; the app needs one database |
| A host that runs a long-lived Node process | Render, Railway, Fly.io, a VPS, Azure App Service, … |
| TLS | Terminated by the platform or a reverse proxy |
| 1 MB request bodies | The default limit is set in `server/server.js` |

No build step. The repository is the deployable artifact.

## 2. Environment variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `MONGODB_URI` | **Yes** | `mongodb+srv://user:pass@cluster/db` | The server exits 1 if missing |
| `PORT` | No | `3000` | Most platforms inject it; the app honours it |
| `NODE_ENV` | In production | `production` | Enables `Secure` cookies and fail-closed CORS |
| `ALLOWED_ORIGIN` | Only for cross-origin | `https://careerflow.example` | Comma-separated; omit when the app serves its own frontend |
| `TRUST_PROXY` | Behind a proxy | `true` | Needed for correct `req.ip` in rate limiting |
| `ALLOW_LEGACY_ADOPTION` | No | `false` | One-time migration flag; leave off |
| `MONGO_TIMEOUT_MS` | No | `10000` | Startup connection timeout |

`server/.env.example` is the template. `server/.env` is git-ignored and must
never be committed; the HTTP server cannot serve it in any case.

## 3. Database

1. Create a database and a user with read/write on it (not admin).
2. Restrict network access to the host's egress addresses where the platform
   supports it. Otherwise use Atlas' allowlist with the narrowest range possible.
3. Use the SRV connection string with `retryWrites=true&w=majority`.
4. The app creates collections and indexes on first write; no migration step is
   required.
5. Optional demo data: `node seed-demo.js` (from the project root, with
   `server/.env` present).

Backups: use the database provider's snapshots. The app's JSON backup is
per-user and is not a substitute for a database backup.

## 4. Install and run

```bash
# from the repository root
cd server
npm ci                 # reproducible install from package-lock.json
node server.js         # or: npm start
```

The process:

- exits 1 if `MONGODB_URI` is missing;
- exits 1 if MongoDB cannot be reached (nothing listens in the meantime);
- logs `CareerFlow running at http://localhost:PORT` only after both succeed.

### 4.1 Process management

Use the platform's process supervisor, or `systemd` on a VPS:

```ini
[Unit]
Description=CareerFlow
After=network.target

[Service]
Type=simple
User=careerflow
WorkingDirectory=/srv/careerflow/server
EnvironmentFile=/srv/careerflow/server/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

`SIGTERM` triggers the graceful shutdown: stop accepting connections, close the
Mongo connection, exit 0. `TimeoutStopSec` must exceed the time needed for
in-flight requests; 15 s is generous for this app.

## 5. Reverse proxy

The app serves its own frontend, so a minimal nginx configuration is enough:

```nginx
server {
  listen 443 ssl http2;
  server_name careerflow.example;

  ssl_certificate     /etc/letsencrypt/live/careerflow.example/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/careerflow.example/privkey.pem;

  client_max_body_size 1m;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
  }
}

server {
  listen 80;
  server_name careerflow.example;
  return 301 https://$host$request_uri;
}
```

With this proxy, set `TRUST_PROXY=true` so Express reads the client address from
`X-Forwarded-For` instead of the proxy's `127.0.0.1`. Without it, every client
shares one rate-limit bucket; with it enabled but no proxy, a client could spoof
the header. Set it only when a proxy is actually in front.

## 6. Platform notes

### Render / Railway / Fly.io

- Build command: `cd server && npm ci`
- Start command: `cd server && node server.js`
- Add `MONGODB_URI`, `NODE_ENV=production`; leave `ALLOWED_ORIGIN` unset if the
  app serves the frontend.
- Health check path: `/api/health`
- Do not enable “auto-deploy on every push” without a review step.

### Docker (optional)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/server
CMD ["node", "server.js"]
```

Run with the environment variables above. Mount nothing; `.env` should come from
the platform's secret store.

## 7. Post-deploy checklist

| Check | Expected |
|---|---|
| `GET /api/health` | `200 { "status": "ok" }` |
| `GET /` | Landing page, HTTPS |
| `GET /dashboard` signed out | `302 /login?next=%2Fdashboard` |
| Register a test account | `201`, cookie with `Secure` |
| Create an application | `201`, appears after reload |
| Change its status | One new history entry, no duplicate |
| Add an interview round | Appears in Interview Prep **and** Calendar |
| `GET /api/analytics/summary` | Rates with denominators |
| `GET /server/server.js` | `404` |
| `GET /seed-demo.js` | `404` |
| Fail a login six times | Sixth `429` with `Retry-After` |
| Restart the process | Session still valid (stored in MongoDB) |
| Send `SIGTERM` | Graceful log, exit 0, no dropped in-flight request |

## 8. Rollback

The app keeps no generated state, so a rollback is a code rollback plus a
database restore only if a schema-destructive change was deployed. There has
been none: the two schema changes (`statusHistory`, date-only serialisation) are
additive.

1. Redeploy the previous release.
2. If a bad migration ran, restore the provider's snapshot.
3. Verify `/api/health`, then the checklist above.

## 9. Operating the app

| Task | Command / action |
|---|---|
| Logs | Platform log stream, or `journalctl -u careerflow -f` |
| Restart | `systemctl restart careerflow` (sessions survive) |
| Demo data | `node seed-demo.js` from the root |
| Tests | `cd server && npm test` (starts its own instance on 3100) |
| Backup | Provider snapshot; per-user JSON export lives in Settings |

## 10. Security checklist for the operator

- [ ] `NODE_ENV=production` (enables `Secure` cookies, fail-closed CORS)
- [ ] HTTPS on every route; HTTP redirects
- [ ] `MONGODB_URI` only in the secret store, never in the repository
- [ ] Database user limited to the app's database, not admin
- [ ] `TRUST_PROXY=true` only when a proxy is present
- [ ] `ALLOWED_ORIGIN` unset unless the frontend is served elsewhere
- [ ] `ALLOW_LEGACY_ADOPTION` unset
- [ ] Health check pointed at `/api/health`
- [ ] Restart policy `on-failure`, graceful stop timeout ≥ 15 s
- [ ] Backups enabled and a restore has been tested

## 11. What this project does not do for you

- No CI pipeline is committed (tests are runnable but not wired to a provider).
- No infrastructure-as-code, container registry or CDN configuration.
- No log aggregation, metrics or alerts; `/api/health` is the only probe.
- No multi-instance session or rate-limit store.

These are integration decisions that depend on the host. They are listed here so
the boundary between "the app" and "the platform" is explicit.
