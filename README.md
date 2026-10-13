# Mutual

A prettier self-hosted When2Meet clone with three-state availability, live updates,
participant passwords, and private admin links. Node 22+ and SQLite; independent
`server/` and `web/` npm projects.

For local development:

```sh
npm run install:all
npm run dev
```

The API runs on port 8787; Vite proxies `/api` to it. Root commands also include
`npm run build`, `npm start`, and `npm test`. For server-only checks, use
`npm --prefix server run build` and `npm --prefix server test`.
Set environment variables in your shell for local runs (`.env` is loaded by Compose).

Deploy with Docker Compose (v2.24.0+ for optional `env_file`):

```sh
git clone <repository-url> Pretty-WTM
cd Pretty-WTM
cp .env.example .env
# Edit .env; set TUNNEL_TOKEN if using the tunnel profile.
docker compose up -d --build
```

The app runs as non-root and stores SQLite and its generated session secret in the
`mutual-data` named volume (Compose prefixes the volume name with the project name).
No host directory or `chown` is needed. `.env` is optional; Compose fixes
`NODE_ENV=production`, `PORT=8787`, and `DATA_DIR=/data` regardless of `.env`.
Keep the project name stable when updating so Compose reuses the same volume.
If migrating an existing `./data` deployment, stop the old app and copy the entire
data directory into the named volume with ownership UID/GID 1000 before starting.

For Cloudflare Tunnel, create a remotely managed tunnel, put its `TUNNEL_TOKEN`
in `.env`, and set the public hostname's service to **`http://app:8787`**.
Then start the optional connector:

```sh
docker compose --profile tunnel up -d
```

If cloudflared is installed on the host, use **`http://localhost:8787`** instead.
The published port is bound only to `127.0.0.1:8787`; LAN/server-IP access is not
published. Compose defaults `TRUST_PROXY=cloudflare` for per-client rate limits;
missing or empty `CF-Connecting-IP` falls back to the socket address. Set
`TRUST_PROXY=none` for direct access without Cloudflare, and only trust Cloudflare
headers when requests reach the app through that proxy.

Use the tunnel's HTTPS public hostname for normal access. Cookies default to
Secure in production. For temporary plain-HTTP testing, set `COOKIE_SECURE=false`
in `.env` and run `docker compose up -d` to recreate the app. Test locally at
`http://localhost:8787`, or forward the loopback port with SSH. Remove the override
for HTTPS deployment.

SSE live updates work through Cloudflare. Do not apply caching rules to `/api` or
its subpaths; optionally add a Cache Rule with cache eligibility **Bypass cache**
for `/api/*` (and `/api` if matched separately). Keep SSE responses unbuffered;
the server supplies `no-cache, no-transform` and `X-Accel-Buffering: no` headers.

To update (the named volume is preserved):

```sh
git pull
docker compose up -d --build
# If using the optional connector:
docker compose --profile tunnel up -d
```

For a live backup, use SQLite's online backup API through the installed
`better-sqlite3` package, then copy the completed snapshot to the host:

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T app node -e 'const DB = require("better-sqlite3"); const db = new DB("/data/mutual.sqlite", { readonly: true }); db.backup("/tmp/mutual-backup.sqlite").then(() => db.close()).catch(error => { console.error(error); db.close(); process.exitCode = 1; });'
docker compose cp app:/tmp/mutual-backup.sqlite ./backups/mutual.sqlite
# When SESSION_SECRET is empty, also preserve the generated secret:
docker compose cp app:/data/secret ./backups/secret
```

The database uses WAL: copying only the live `mutual.sqlite` file can lose changes.
The backup API includes committed WAL data in a consistent snapshot. Preserve
`.env` securely too, especially if it supplies `SESSION_SECRET`; the generated
secret file may not exist in that case. Keep dated copies off the server.
To restore, stop the app, replace the database and generated secret in the volume,
remove stale `mutual.sqlite-wal`/`mutual.sqlite-shm` files, ensure UID/GID 1000 owns
restored files, and start the app with the same `SESSION_SECRET` configuration.
`docker compose down` preserves data; `docker compose down -v` deletes the volume.

Environment variables (see `.env.example`; for local npm runs set these in your
shell because the server does not load `.env` itself):

- `PORT`: server port (default `8787`; Compose fixes it at `8787`).
- `DATA_DIR`: SQLite and secret directory (default `./data`; Compose fixes `/data`).
- `SESSION_SECRET`: participant cookie signing key; empty generates and persists `DATA_DIR/secret`.
- `TRUST_PROXY`: `cloudflare` trusts `CF-Connecting-IP`, falling back to the socket IP; unset or `none` uses the socket IP. Compose defaults empty/unset to `cloudflare`.
- `COOKIE_SECURE`: `true` or `false`; unset/empty defaults to `true` in production and `false` otherwise. Controls admin and participant cookies, including deletion.
- `HOST_PORT`: Compose only. Host port the app is published on, bound to `127.0.0.1` (default `8787`).
- `EVENT_TTL_DAYS`: delete events inactive for this many days (default `180`; `0` disables).
- `NODE_ENV`: `production` enables static SPA serving and defaults to Secure cookies (set by Docker/Compose).
- `WEB_DIST`: static build directory (default `web/dist` beside `server/`; Docker sets `/app/web/dist`).
- `TUNNEL_TOKEN`: Cloudflare Tunnel token for the optional `tunnel` profile.
