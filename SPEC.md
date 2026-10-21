# Mutual — product & contract spec

A prettier, simpler When2Meet. Self-hosted on a personal Linux server behind Cloudflare
(Cloudflare Tunnel), run via Docker Compose.

This file is the **contract** between the backend (`server/`) and frontend (`web/`).
If you need to deviate, update this file in the same change and keep both sides consistent.

---

## 1. Product scope

### Creating an event (home page `/`)
- Fields:
  - **Title** (required, 1–100 chars)
  - **Description** (optional, ≤ 1000 chars, plain text, newlines preserved)
  - **Mode**: `dates` (specific calendar dates, picked on a month calendar with click/drag
    multi-select) or `weekdays` (Mon–Sun toggles, no specific dates)
  - **Hours**: "no earlier than" / "no later than" (whole hours or matching the slot size;
    end may be 24:00)
  - **Slot size**: 15 / 30 / 60 minutes (default 15)
  - **Timezone**: IANA name, defaults to the creator's browser timezone, searchable select
  - **Custom URL slug** (optional): `/e/<slug>`, otherwise a random ID. Live availability check.
- On create: redirect to `/e/<id>`. Show a one-time success panel there with the share link
  and the **admin link** (copy buttons). The creating device is remembered as admin via cookie.
- Home page also shows **Recent events** on this device (localStorage: id, title, last visited,
  whether admin), newest first, removable.

### Event page `/e/:id`
- Header: title, description, share/copy-link button, timezone selector ("Showing times in …",
  defaults to the viewer's browser tz).
- **Sign in panel**: name + optional password. Same as When2Meet: new name creates a participant;
  existing name requires the password if one was set. Password protects only that row.
  Once signed in, you can sign out ("Not you?").
- **Layout**: two grids side by side on desktop — **Your availability** (editable) and
  **Group availability** (heatmap). On narrow screens use tabs: *Mine* / *Group*.
- **Painting**: two brushes: **Available** and **If needed** (plus an eraser by toggling: dragging
  starting on a cell already in the active state clears instead, like When2Meet). Click-and-drag
  rectangle selection with mouse; touch support (drag paints, page doesn't scroll while painting
  inside the grid). Saves automatically (debounced ~400 ms) with a subtle "Saved" indicator.
- **Group heatmap**: cell intensity = (available + 0.5 × ifNeeded) / participantCount. Legend
  showing 0/N … N/N.
- **Hover/tap roster**: hovering (or tapping on touch, which pins it) a group cell opens a themed
  tooltip beside the cell with the slot time, the availability summary, and who is Available,
  If needed, and Unavailable for that slot. Hovering a name in the participants list highlights
  that person's availability on the group grid.
- **Best times**: ranked list of the top contiguous blocks (merge adjacent slots on the same day
  with identical sets of people), sorted by score then length; show e.g.
  "Tue, Oct 14 · 2:00–4:00 PM · 7/8 available (1 if needed)". Clicking one highlights it on the grid.
- **Live updates**: the group grid updates in real time via SSE when others save.
- **Admin** (when admin cookie present): an "Edit event" dialog for title, description, dates /
  weekdays, hours, and slot size. Mode and timezone are immutable after creation. The dialog previews
  whose answers a change would merge or clear before saving. Admin can also
  delete the event (with confirmation). Visiting `/e/:id?admin=<token>` claims admin on that device
  (sets the cookie) and strips the query string.
- **Automatic deletion**: the create form asks how long to keep the event, 1 to 6 months (default 1)
  after its last date. Weekday events, and date events whose dates have passed, count from the day
  of creation. The event header shows the deletion date. In the last 10 days anyone opening the event
  sees a dialog offering to keep it for another month, and the header badge reopens it. When the
  date passes, the server deletes the event and its responses. An admin edit that moves the last date
  later pushes the deletion date back by the same rule, and an edit never brings it forward.

### Timezones
- Event slots are defined in the **event timezone**.
- Each viewer sees the grid converted into the **viewer timezone** (selectable). Columns =
  local days that contain at least one slot; rows = union of local times. Cells that don't
  correspond to a real event slot render as disabled/hatched.
- `weekdays` mode converts using the **current week**: the Monday-to-Sunday week containing
  today in the *event* timezone (dayIndex 0 = Monday), so DST-observing zones use today's
  offsets (a 9 AM America/New_York weekly slot is 10 PM in Tokyo in October, 11 PM in winter).
  Column headers show weekday names only.
- All conversion is done on the **frontend** (use `Intl` / `@date-fns/tz` or similar). The backend
  never converts timezones; it only validates the IANA name.

### Themes
- 12 themes, each with **light and dark** variants. Visitor picks theme + mode
  (light / dark / system). Persisted in localStorage. Picker in the header on every page.
- Classic: `minimal` (default), `neumorphic`, `material`, `glass`, `nord`, `paper`
- Eccentric: `retro-os`, `terminal`, `brutalist`, `y2k`, `sketchbook`, `cottagecore`
- Theme = shared CSS tokens + optional per-theme CSS for textures/decoration. Layout and
  markup are shared; themes must not require component changes. See `web/THEMING.md`
  (written by the core UI work).

---

## 2. Slot model (shared by both sides)

```
slotsPerDay = (endMinute - startMinute) / slotMinutes
days        = mode === 'dates' ? dates (sorted 'YYYY-MM-DD') : weekdays (sorted ints 0..6, 0 = Mon)
totalSlots  = days.length * slotsPerDay
slotIndex   = dayIndex * slotsPerDay + slotOfDay
slot start  = days[dayIndex] at (startMinute + slotOfDay * slotMinutes), in event timezone
```

**Availability** is a string of length `totalSlots`, one char per slot:
`'0'` = unavailable, `'1'` = available, `'2'` = if needed.

Constraints:
- `slotMinutes ∈ {15, 30, 60}`
- `0 ≤ startMinute < endMinute ≤ 1440`, both multiples of `slotMinutes`
- `dates`: 1–62 unique valid dates; `weekdays`: 1–7 unique ints in 0..6
- Max participants per event: 200

When the admin edits days/hours/slot size, the server **remaps** each participant's availability by
`(dayKey, time overlap)`: a new slot takes the value of the old slot it falls in (finer slots lose
nothing), or the least committed value of the old slots it spans (`'0'` < `'2'` < `'1'`) when slots
get coarser. Times nobody answered for become `'0'`.

---

## 3. HTTP API

Base path `/api`. JSON in/out. Errors: `{ "error": { "code": string, "message": string } }`
with an appropriate 4xx/5xx status. Codes used: `invalid_input`, `not_found`, `slug_taken`,
`wrong_password`, `unauthorized`, `forbidden`, `rate_limited`, `too_many_participants`.

Request rules for every `/api` call that is not `GET`/`HEAD`/`OPTIONS`:
- Bodies must be sent with `Content-Type: application/json` (`415 invalid_input` otherwise).
- An `Origin` header, if present, must match the request host, and `Sec-Fetch-Site`, if
  present, must be `same-origin` or `none` (`403 forbidden` otherwise).

Rate limits (`429 rate_limited` with `Retry-After`), keyed by client IP (IPv6 by /64):
- All `/api` requests: burst 240, refill 4/s.
- `POST /api/events`, `/session`, `/admin`, `/api/admin/login`: burst 20, refill 1 per 6 s.
- Password checks per participant: burst 10, refill 1 per 6 min, regardless of IP.
- Live update streams: 20 open per IP, 300 per event, 2000 total.
Limit state is persisted in SQLite on shutdown.

### Types

```ts
type EventMode = 'dates' | 'weekdays';

interface EventDTO {
  id: string;              // slug or random id, [a-z0-9-], 3–48 chars
  title: string;
  description: string;     // '' when none
  mode: EventMode;
  dates: string[];         // mode 'dates' → 'YYYY-MM-DD' sorted; else []
  weekdays: number[];      // mode 'weekdays' → sorted 0..6 (0 = Mon); else []
  startMinute: number;
  endMinute: number;
  slotMinutes: 15 | 30 | 60;
  timezone: string;        // IANA
  createdAt: string;       // ISO 8601
  updatedAt: string;       // last schedule edit, availability save, or new participant
  keepMonths: number;      // 1..6, chosen at creation
  expiresAt: string;       // ISO 8601; the server deletes the event at this instant
}

interface ParticipantDTO {
  id: string;
  name: string;
  hasPassword: boolean;
  availability: string;    // see slot model
  updatedAt: string;
}

interface ViewerDTO {
  isAdmin: boolean;
  participantId: string | null;   // signed-in participant for this event, if any
}
```

### Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| GET | `/api/slugs/:slug` | – | `{ available: boolean, valid: boolean }` |
| POST | `/api/events` | `{ title, description?, mode, dates?, weekdays?, startMinute, endMinute, slotMinutes, timezone, slug?, keepMonths? }` | `201 { event: EventDTO, adminToken: string }` + sets admin cookie |
| GET | `/api/events/:id` | – | `{ event, participants: ParticipantDTO[], viewer: ViewerDTO }` |
| PATCH | `/api/events/:id` | partial `{ title, description, dates, weekdays, startMinute, endMinute, slotMinutes }` (admin) | `{ event, participants }` |
| POST | `/api/events/:id/extend` | – (anyone) | `{ event }` with `expiresAt` one month later; `409 too_early` unless within 10 days of deletion. `updatedAt` is unchanged. |
| DELETE | `/api/events/:id` | – (admin) | `204` |
| POST | `/api/events/:id/admin` | `{ token }` | `{ viewer }` + sets admin cookie; `403 forbidden` if wrong |
| POST | `/api/events/:id/session` | `{ name, password? }` | `{ participant, viewer }` + sets participant cookie. Creates participant if name (case-insensitive, trimmed) is new; if existing with password → must match (`401 wrong_password`); if existing without password → ok. A password supplied for a new participant is stored. |
| DELETE | `/api/events/:id/session` | – | `204`, clears participant cookie |
| PUT | `/api/events/:id/availability` | `{ availability }` (signed-in participant) | `{ participant }` |
| GET | `/api/events/:id/stream` | – | SSE (below) |

Names: trimmed, 1–40 chars. Passwords: 0–128 chars (empty = none).

### Site admin dashboard

`ADMIN_TOKEN` (at least 32 characters) enables the read-only `/admin` dashboard; empty or
unset disables every `/api/admin/*` route with `404 not_found`.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/admin/login` | `{ token }` (string, max 200 chars, no extra fields) | `{ ok: true }` + console cookie; `403 forbidden` if wrong |
| POST | `/api/admin/logout` | – | `204`, clears console cookie, even without a valid session |
| GET | `/api/admin/stats` | – | Site statistics; `401 unauthorized` without a valid console cookie |

Stats contain `generatedAt`, `server` (version, Node, uptime, memory), `events` (total,
active with >= 2 participants, createdLast30Days, byMode, expiringWithin7Days), `people`
(unique case-insensitive names, entries, withPassword, responded, avgPerEvent), `storage`
(databaseBytes, walBytes, freeBytes, tables, volume), `live` (streams, streamLimit,
eventsWithViewers), `topEvents` (top 8 by participant count, with live viewers), `rateLimits`
(throttledLastHour, passwordLockoutsLastHour, trackedClients, up to 8 lowest-token client
buckets, excluding participant-password keys), `backups` (configured, snapshots, count,
totalBytes, latestAt), and `history` (exactly 30 UTC days ascending, ending today; day,
activeEvents, uniquePeople, eventsCreated, participantsJoined, availabilitySaves, throttled).
Expired events and their participants are excluded from current counts. Missing historical
snapshots are null and missing counters are zero. History persists in `daily_stats` and is
retained for about 400 days. `BACKUP_DIR` optionally exposes file metadata for the newest
20 `.sqlite` snapshots, including whether a matching `.secret` file exists; no contents are read.

Login uses the per-IP auth limit plus a global limit of 10 failed attempts, refilling 10/hour;
successful logins do not consume it. All admin API
responses use `Cache-Control: no-store` and `X-Robots-Tag: noindex`. `mutual_console` contains
an expiry and HMAC derived from the session secret and admin token hash; token rotation
invalidates sessions. Flags: HttpOnly, SameSite=Strict, Path=/api/admin, Max-Age 12 hours,
Secure according to `COOKIE_SECURE` (production by default).

### Cookies
- Admin: `mutual_admin_<eventId>` = admin token (random 32 bytes, base64url). Stored hashed
  (SHA-256) server-side. HttpOnly, SameSite=Lax, Secure when `NODE_ENV=production`, Path=/,
  Max-Age 1 year.
- Participant: `mutual_p_<eventId>` = HMAC-signed participant id (secret from `SESSION_SECRET`
  env, or generated once and persisted in the data dir). Same flags, Max-Age 1 year.

### SSE `/api/events/:id/stream`
Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
`X-Accel-Buffering: no`. Heartbeat comment every 20 s.
Events:
- `event: participant` / `data: ParticipantDTO` (created or availability changed)
- `event: event` / `data: { event: EventDTO, participants: ParticipantDTO[] }` (admin edit or extension)
- `event: deleted` / `data: {}`

---

## 4. Repo layout & runtime

```
/                  root (package.json with prefix scripts, docker-compose.yml, Dockerfile, README.md)
/server            Node 22 + TypeScript, Hono, better-sqlite3. Serves /api and web/dist in prod.
/web               React 19 + Vite + TypeScript SPA (react-router). Dev proxy /api → :8787.
/data              SQLite db + secrets (Docker volume, gitignored)
```

- Server port `PORT` (default 8787). `DATA_DIR` (default `./data`). `TRUST_PROXY=cloudflare` reads
  `CF-Connecting-IP` for rate limiting.
- In production the server serves `web/dist` statically with SPA fallback to `index.html`
  for non-`/api` routes, long-cache for hashed assets.
- `server/` and `web/` are independent npm projects (own package.json + lockfile, no workspaces). Root scripts: `npm run install:all`, `npm run dev` (both), `npm run build`, `npm start`, `npm test`.
- Docker: multi-stage build → single image; `docker-compose.yml` with the app + optional
  `cloudflared` service (profile `tunnel`, `TUNNEL_TOKEN` env).
