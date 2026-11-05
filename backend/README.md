# 2048 Arcade API

A separate Node.js/Express service for rank previews and opt-in score
submissions. It uses JavaScript ES modules, `better-sqlite3`, versioned SQL
migrations, and Swagger UI. The vanilla frontend remains a static GitHub Pages
app and talks to this service across origins.

## Requirements

- Node.js 20 or newer.
- npm.
- For a local manual database inspection, the SQLite CLI is optional.

## Install and run locally

From this directory:

```sh
npm ci
cp .env.example .env
```

In PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

The example `.env` uses `./data/2048.db` and allows common local frontend
origins. Start the API (Node 20.6 or newer supports `--env-file`):

```sh
node --env-file=.env src/server.js
```

Or use `npm start` after exporting the same variables in your shell. The API
listens on `0.0.0.0:8080` by default. Database migrations also run safely at
startup; they can be applied explicitly with:

```sh
npm run migrate
```

Use `npm run dev` for Node's watch mode. No `.env` file is tracked.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, or `production`. |
| `PORT` | `8080` | HTTP port, from 1 through 65535. |
| `DATABASE_PATH` | `./data/2048.db` outside production | SQLite file path. Production requires it explicitly; on Fly use `/data/2048.db`. The production process does not create a missing parent directory or silently switch to ephemeral storage. |
| `CORS_ORIGINS` | empty | Comma-separated exact `http://` or `https://` browser origins. Set the actual GitHub Pages origin, without a path or trailing slash. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Public API request window per client IP. |
| `RATE_LIMIT_MAX` | `100` | Requests per IP in the configured window. |
| `TRUST_PROXY_HOPS` | `0` | Number of trusted reverse-proxy hops; set to `1` for the Fly Proxy. |

Configuration is validated during startup. The rate limiter is process-local
and is intended for this single-active-machine deployment.

## Database and migrations

`src/db/migrations/` contains ordered, versioned SQL migrations recorded in
`schema_migrations`. Migrations run transactionally and are safe to re-run.
SQLite uses foreign-key enforcement, WAL mode, and a 5-second busy timeout.
Scores and timestamps are stored in UTC ISO 8601 form. Ranking, idempotency,
and display ordering have supporting indexes and parameterized queries.

Local development creates the parent directory when needed. Production
requires the configured database directory to already exist, which helps
surface a missing volume mount rather than creating a database on the
ephemeral root filesystem.

## API

Swagger UI is at `/api-docs`; the OpenAPI 3 document is also available at
`/openapi.json`.

### `GET /api/v1/leaderboard/rank?score={integer}`

Returns the projected rank without creating an entry:

```json
{ "rank": 7, "qualifies": true, "leaderboardLimit": 100 }
```

A score outside the top 100 rank positions returns `rank: null` and
`qualifies: false`. Competition rank is one plus the number of persisted
scores strictly greater than the candidate. Tied scores share a rank, so a
tie at rank 100 qualifies.

### `POST /api/v1/scores`

Requires `Content-Type: application/json` and a unique-run
`Idempotency-Key` header. The key must contain 1–128 ASCII letters, numbers,
dots, underscores, colons, or hyphens.

```json
{
  "displayName": "ARCADE ACE",
  "score": 2400,
  "highestTile": 2048,
  "moves": 38,
  "durationSeconds": 94
}
```

The backend NFC-normalizes and trims the display name, then accepts only 1–12
ASCII letters, numbers, spaces, hyphens, or underscores. Scores, moves, and
duration must be non-negative safe integers; `highestTile` must be a power of
two of at least 2. New entries return `201` with the persisted name, score,
and rank. Repeating the same key and normalized payload returns the original
response with `200`; reusing a key with a different payload returns `409`.
The idempotency key is protected by a database unique constraint, and the
lookup/insert/rank calculation run inside an immediate SQLite transaction.

### `GET /api/v1/leaderboard`

Returns `{ "entries": [...], "limit": 100 }`. Entries are ordered by score
descending, then submission time and insertion order; their `rank` uses
competition ranking. At most 100 entries are returned. The public response
includes rank, display name, score, highest tile, and UTC submission time, but
not internal IDs or idempotency keys.

### `GET /api/v1/health`

Returns `{"status":"ok","database":"ok"}` only when a database query succeeds.
It does not expose a path or credentials.

### Errors and request limits

Errors use a consistent JSON envelope:

```json
{
  "error": {
    "code": "INVALID_SCORE",
    "message": "score must be a non-negative safe integer."
  }
}
```

Invalid input returns `400`, malformed JSON `400`, unsupported media type
`415`, oversized (over 8 KB) body `413`, key conflict `409`, rate limit `429`,
and database busy/unavailable `503`. CORS allows only configured exact
origins; disallowed browser origins receive `403`.

## Tests

Tests use Node's built-in runner and temporary SQLite databases. They cover
ranking, cutoff ties, validation, persistence across connections, concurrent
idempotent requests, public leaderboard shape, health, CORS, and rate limiting.

```sh
npm test
```

The tests do not read or write `DATABASE_PATH` from a developer's real
environment.

## Fly.io deployment

`Dockerfile` builds the native SQLite dependency and runs the API on the
configured port. `fly.toml` sets `NODE_ENV=production`,
`DATABASE_PATH=/data/2048.db`, the verified GitHub Pages CORS origin
`https://ahavatech.github.io`, and mounts the `data` volume at `/data`.

The backend is deployed at `https://2048.fly.dev` in app `2048`, region `ams`.
One 1 GB persistent volume named `data` is attached to one active machine. The
live health endpoint confirms database access; no production score was
submitted during verification.

The GitHub repository is `ahavatech/2048`; its Pages origin is
`https://ahavatech.github.io`. Pages still uses the legacy `main`/repository
root source. To publish the frontend through the prepared GitHub Actions
workflow, set the repository variable, then change **Settings → Pages → Build
and deployment → Source** to **GitHub Actions** and manually run **Actions →
Deploy GitHub Pages → Run workflow**:

```sh
gh variable set ARCADE_API_BASE_URL \
  --repo ahavatech/2048 \
  --body 'https://2048.fly.dev'
```

No application secrets are required. Runtime environment values including
`DATABASE_PATH=/data/2048.db`, `PORT=8080`, and CORS are in `fly.toml`; do not
store database files or secrets in the frontend. The configuration is for one
active machine only. Do not scale multiple machines against this SQLite
volume.

For future backend code changes, commit and push the changes, then deploy from
`backend/` after reviewing the diff:

```sh
flyctl deploy --app 2048
flyctl status --app 2048
flyctl checks list --app 2048
```

Do not use a path, wildcard CORS, or trailing slash. The Pages workflow stages
only `index.html`, `styles.css`, `game-engine.js`, `leaderboard-api.js`, and
`functions.js`; the checked-in meta tag remains empty.

### Verify and operate

```sh
curl -fsS https://2048.fly.dev/api/v1/health
curl -fsS 'https://2048.fly.dev/api/v1/leaderboard/rank?score=2400'
curl -fsS https://2048.fly.dev/api/v1/leaderboard
```

Swagger UI is at `https://2048.fly.dev/api-docs`. Check the Pages
preflight without submitting a score:

```sh
curl -i -X OPTIONS 'https://2048.fly.dev/api/v1/scores' \
  -H 'Origin: https://ahavatech.github.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,idempotency-key'
```

Inspect deployment health, logs, volume allocation, and actual filesystem use:

```sh
flyctl status --app 2048
flyctl checks list --app 2048
flyctl logs --app 2048
flyctl volumes list --app 2048
flyctl ssh console --app 2048 --user node --command "df -h /data"
```

Do not make a public score submission as a production smoke test without
explicit approval: it creates a public leaderboard entry. Rank preview,
leaderboard retrieval, health, Swagger, and CORS checks do not create an entry.
The deployment uses a single Fly Machine because a Fly Volume is local to one
machine and SQLite is not a multi-writer, multi-machine database.

This SQLite-on-volume design is for **one active Fly Machine**. Do not scale
multiple machines to write to the same SQLite database. Fly Volumes are
machine-local and do not replicate; the template caps the service at one
machine.

### Backups

Fly snapshots are useful for recovery but should not be the only backup.
SQLite's WAL mode makes copying only the `.db` file while the service is
running unsafe. `src/db/backup.js` uses SQLite's online backup API. Create a
backup on the attached volume, then copy it to independent storage:

```sh
flyctl ssh console --app 2048 --user node \
  --command "node src/db/backup.js /data/backups/2048-YYYY-MM-DD.db"
flyctl ssh sftp get /data/backups/2048-YYYY-MM-DD.db ./2048-YYYY-MM-DD.db \
  --app 2048 --user node
```

Keep multiple dated copies outside the Fly Volume and repository, protect
them as production data, and periodically test a restore. Local development
can use `npm run backup -- <destination>`; set `DATABASE_PATH` to the intended
local database first.

### Restore from a backup

The restore utility checks SQLite integrity, writes to a **new** database
file, verifies the restored copy, and refuses to overwrite an existing file.
For a production restore, first verify the backup and plan a maintenance
window. Upload the backup to the existing volume and restore it to a new path:

```sh
flyctl ssh sftp put ./2048-YYYY-MM-DD.db /data/restore-source.db \
  --app 2048 --user node
flyctl ssh console --app 2048 --user node \
  --command "node src/db/restore.js /data/restore-source.db /data/2048-restored.db"
```

Review the restore output, then change `DATABASE_PATH` in `fly.toml` to
`/data/2048-restored.db` and deploy the reviewed configuration. This preserves
the previous `/data/2048.db` file for a controlled rollback; do not delete or
overwrite either file as part of the restore. After deployment, verify health
and persistence before accepting the restore. A rollback to the old path can
discard scores submitted to the restored database after the switch, so pause
submissions or account for that data before changing paths again.

On an outage, inspect `flyctl status --app 2048`, `flyctl checks list --app
2048`, and `flyctl logs --app 2048`,
then check volume attachment and free space. Do not create another machine
against the same database volume. Redeploy a reviewed code change from this
directory with `flyctl deploy --app 2048`; do not change app, volume, or
machine count as an outage shortcut.

## Security limitations

There are no accounts, passwords, email addresses, or identity claims. Scores
and game statistics come from the browser and can be forged. Validation,
rate limiting, CORS, and idempotency improve reliability and reduce accidental
abuse, but **do not make scores cheat-proof**. This phase deliberately does
not add authentication or a complex anti-cheat system.
