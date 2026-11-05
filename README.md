# 2048

A 4×4 sliding-tile game built with vanilla HTML, CSS, and JavaScript.

## How to play

Use the arrow keys or **WASD** to slide the tiles. On touch screens, swipe on
the board. Tiles with the same value merge, and each tile can merge only once
per move. A new 2 or 4 tile appears after each valid move.

The game ends when you reach 2048 or when the board has no valid moves. Choose
**Play again** to start a new game.

## Game-over and leaderboard flow

At game end, the page shows the final score, highest tile, move count, elapsed
time, and the best score saved in this browser. The rank check and score
submission use the isolated `leaderboard-api.js` service. A name is sent only
after the player opts in and submits it.

The backend URL is configured with the `arcade-api-base` meta tag in
`index.html`. The frontend calls the rank preview, score submission, and
leaderboard endpoints through `leaderboard-api.js`. Rank values and submission
success are accepted only from validated backend responses. A leaderboard
control in the confirmed-submission screen fetches and displays the actual
public entries.

### Configure the production API URL

GitHub Pages does not substitute environment variables into HTML. Keep the
committed tag in `index.html` empty. The manual GitHub Actions release workflow
stages only the frontend files and injects the API origin from the repository
variable `ARCADE_API_BASE_URL`:

```sh
gh variable set ARCADE_API_BASE_URL \
  --repo ahavatech/2048 \
  --body 'https://2048.fly.dev'
```

The deployed API origin is `https://2048.fly.dev`; use only this HTTPS origin,
with no path or trailing slash. It is public configuration, not a secret.
Never put backend secrets in the frontend. The workflow is manual so it cannot
publish until deliberately run, and it fails before deployment if the variable
is missing or is not an HTTPS origin. If the API is unavailable, players can
still play; rankings show an unavailable state and no score is claimed as
submitted. The development mock remains restricted to explicit localhost
opt-in and cannot activate on GitHub Pages.

For a local-only UI demo, serve the page from `localhost` or `127.0.0.1` and
open it with `?leaderboard=mock`. This explicit development adapter simulates a
rank of 7 for scores of 1,000 or more (otherwise outside the top 100). Every
mock result is marked **DEVELOPMENT MOCK — NOT REAL RANKINGS**, and a simulated
submission explicitly says it was not submitted. The mock is disabled on
deployed hosts.

## Backend API contract and local integration

The frontend expects the following operations relative to the configured API
base URL. The implementation and setup instructions are in
[`backend/README.md`](./backend/README.md).

### `GET /api/v1/leaderboard/rank?score={integer}`

Returns the projected rank and eligibility for a score:

```json
{
  "rank": 7,
  "qualifies": true,
  "leaderboardLimit": 100
}
```

For a score outside the configured limit, return `"rank": null` and
`"qualifies": false`. The backend owns rank, tie-breaking, and qualification
rules.

### `POST /api/v1/scores`

The frontend sends `Content-Type: application/json` and a stable
`Idempotency-Key` header for the game run. The backend should honor that key so
a retry after a network interruption cannot create a duplicate entry.

```json
{
  "displayName": "ARCADE ACE",
  "score": 2400,
  "highestTile": 2048,
  "moves": 38,
  "durationSeconds": 94
}
```

Return success only after persistence and rank confirmation, preferably with
HTTP `201`:

```json
{
  "displayName": "ARCADE ACE",
  "score": 2400,
  "rank": 3
}
```

### `GET /api/v1/leaderboard`

The confirmed-submission screen has a **VIEW LEADERBOARD** control. It requests
this endpoint and renders the entries returned by the backend; the browser
does not calculate rank.

### Run the frontend and backend together

Use two terminals from the repository root. The backend example configuration
allows `http://localhost:5500` and `http://127.0.0.1:5500` in CORS. Keep its
database path pointed at a local development file, never the deployed Fly
volume.

Terminal 1 — configure and start the backend with its isolated local SQLite
database:

```powershell
cd backend
Copy-Item .env.example .env
```

In `backend/.env`, set `DATABASE_PATH=./data/dev-2048.db` and ensure
`CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500`. Install and start:

```powershell
npm ci
node --env-file=.env src/server.js
```

Terminal 2 — serve the static frontend:

```powershell
cd ..
python -m http.server 5500
```

Before opening `http://localhost:5500`, set the `arcade-api-base` meta tag in
`index.html` to `http://localhost:8080`. After local testing, restore the tag
to its empty value; the Pages workflow injects the production API origin when
it builds the published artifact. Start the frontend from localhost rather
than opening `index.html` as a `file://` URL so browser CORS behavior matches
deployment.

Play until game over, opt in, enter a name, and submit. The UI shows success
only after the API response confirms the saved name, score, and rank. The
leaderboard view is fetched from the API. For a backend-only safe smoke test,
use `backend/tests/api.test.js`; tests use temporary databases. To inspect the
local development database, use SQLite read-only tooling against
`backend/data/dev-2048.db`. Repeating a submission with the same game-run
idempotency key and payload returns the original result rather than creating a
second entry.

### CORS and deployment

The backend accepts exact origins only. On Fly, set `CORS_ORIGINS` to the
actual GitHub Pages origin `https://ahavatech.github.io`, without a path or
trailing slash. Do not use `*`. JSON score submissions preflight the
`Content-Type` and `Idempotency-Key` headers, which the backend explicitly
allows. The frontend sends no cookies or credentials.

The repository is `ahavatech/2048`; its Pages URL is
`https://ahavatech.github.io/2048/`, currently published from `main` at the
repository root using the legacy Pages source. The prepared release workflow
uses GitHub Actions and publishes only the five frontend files. Before using
it, change **Settings → Pages → Build and deployment → Source** to **GitHub
Actions**, then set `ARCADE_API_BASE_URL` as above and run **Actions → Deploy
GitHub Pages → Run workflow**. The workflow does not change repository
settings or deploy automatically.

To prepare a local release artifact without deploying, set
`ARCADE_API_BASE_URL` to a confirmed HTTPS API origin in the shell, then run:

```sh
npm test
node --check functions.js
node --check game-engine.js
node --check leaderboard-api.js
npm run pages:prepare
```

For example, in PowerShell set it with
`$env:ARCADE_API_BASE_URL = "https://2048.fly.dev"`.

The preparation script writes the allowlisted frontend files to
`pages-artifact/`; it rejects missing, non-HTTPS, or non-origin API URLs. The
committed HTML remains unchanged.

The backend is deployed at `https://2048.fly.dev`. It runs one Fly Machine in
`ams`, with the 1 GB persistent volume `data` mounted at `/data` and SQLite at
`/data/2048.db`. Health, rank preview, leaderboard, Swagger, and the exact
GitHub Pages CORS preflight have been checked. The public leaderboard is
currently empty; no production score was submitted during verification.
GitHub Pages still uses its legacy `main`/root source until you switch it to
GitHub Actions and set `ARCADE_API_BASE_URL` as described above. See
[`backend/README.md`](./backend/README.md) for operations, backup, and restore
steps.

## Tests

The game engine, leaderboard adapter, and game-over interaction are tested
with Node.js's built-in test runner. No additional dependencies are required.

```sh
npm test
```
