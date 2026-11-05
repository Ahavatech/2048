import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/db/database.js'
import { createLeaderboardService } from '../src/services/leaderboard-service.js'

const validPayload = {
  displayName: 'ARCADE ACE',
  score: 2400,
  highestTile: 2048,
  moves: 38,
  durationSeconds: 94
}

function testConfig(databasePath, overrides = {}) {
  return {
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    databasePath,
    corsOrigins: ['https://game.example.test'],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
    trustProxyHops: 0,
    ...overrides
  }
}

async function createHarness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '2048-api-test-'))
  const databasePath = path.join(directory, 'test.db')
  const config = testConfig(databasePath, options.config)
  const app = createApp({ config })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    app.locals.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    app,
    databasePath,
    baseUrl,
    async request(route, init) {
      return fetch(`${baseUrl}${route}`, init)
    }
  }
}

function seedScores(db, scores) {
  const insert = db.prepare(`
    INSERT INTO scores (
      display_name, score, highest_tile, moves, duration_seconds,
      submitted_at, idempotency_key, submission_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const transaction = db.transaction(values => {
    values.forEach((score, index) => {
      insert.run(
        score.displayName ?? `PLAYER${index}`,
        score.score,
        score.highestTile ?? 2,
        score.moves ?? 0,
        score.durationSeconds ?? 0,
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        score.idempotencyKey ?? `seed-${index}`,
        score.rank ?? index + 1
      )
    })
  })
  transaction(scores)
}

test('health endpoint confirms API and database availability', async t => {
  const api = await createHarness(t)
  const response = await api.request('/api/v1/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' })
})

test('Swagger UI and the raw OpenAPI 3 document are served', async t => {
  const api = await createHarness(t)
  const docs = await api.request('/api-docs/')
  assert.equal(docs.status, 200)
  assert.match(await docs.text(), /swagger-ui/)

  const specResponse = await api.request('/openapi.json')
  const spec = await specResponse.json()
  assert.equal(specResponse.status, 200)
  assert.equal(spec.openapi, '3.0.3')
  assert.deepEqual(Object.keys(spec.paths).sort(), [
    '/api/v1/health',
    '/api/v1/leaderboard',
    '/api/v1/leaderboard/rank',
    '/api/v1/scores'
  ])
  assert.deepEqual(Object.keys(spec.paths['/api/v1/scores']), ['post'])
  assert.deepEqual(Object.keys(spec.paths['/api/v1/leaderboard/rank']), ['get'])
})

test('empty leaderboard and rank-preview match the frontend response contracts', async t => {
  const api = await createHarness(t)
  const rankResponse = await api.request('/api/v1/leaderboard/rank?score=2400')
  assert.equal(rankResponse.status, 200)
  assert.deepEqual(await rankResponse.json(), {
    rank: 1,
    qualifies: true,
    leaderboardLimit: 100
  })

  const listResponse = await api.request('/api/v1/leaderboard')
  assert.deepEqual(await listResponse.json(), { entries: [], limit: 100 })
})

test('rank calculation uses scores strictly greater than candidate and does not insert', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, [
    { score: 3000 },
    { score: 2400 },
    { score: 1800 }
  ])

  const equalResponse = await api.request('/api/v1/leaderboard/rank?score=2400')
  assert.deepEqual(await equalResponse.json(), {
    rank: 2,
    qualifies: true,
    leaderboardLimit: 100
  })
  const lowerResponse = await api.request('/api/v1/leaderboard/rank?score=1700')
  assert.deepEqual(await lowerResponse.json(), {
    rank: 4,
    qualifies: true,
    leaderboardLimit: 100
  })
  assert.equal(api.app.locals.database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 3)
})

test('equal scores share competition rank and cutoff ties qualify', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, [
    { score: 1000 },
    { score: 900 },
    { score: 900 }
  ])

  const tie = await api.request('/api/v1/leaderboard/rank?score=900')
  assert.deepEqual(await tie.json(), { rank: 2, qualifies: true, leaderboardLimit: 100 })

  const existing = Array.from({ length: 100 }, (_, index) => ({ score: 1000 - index }))
  const isolated = await createHarness(t)
  seedScores(isolated.app.locals.database, existing)

  const cutoffRank = await isolated.request('/api/v1/leaderboard/rank?score=901')
  assert.deepEqual(await cutoffRank.json(), { rank: 100, qualifies: true, leaderboardLimit: 100 })
  const belowCutoff = await isolated.request('/api/v1/leaderboard/rank?score=900')
  assert.deepEqual(await belowCutoff.json(), { rank: null, qualifies: false, leaderboardLimit: 100 })
})

test('invalid rank parameters return useful JSON 400 errors', async t => {
  const api = await createHarness(t)
  for (const score of ['', '-1', '1.5', 'not-a-score', '9007199254740992']) {
    const response = await api.request(`/api/v1/leaderboard/rank?score=${encodeURIComponent(score)}`)
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.error.code, 'INVALID_SCORE')
    assert.ok(body.error.message)
  }
})

test('valid submission persists before returning the frontend-compatible result', async t => {
  const api = await createHarness(t)
  const response = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-valid-1' },
    body: JSON.stringify(validPayload)
  })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    displayName: 'ARCADE ACE',
    score: 2400,
    rank: 1
  })
  assert.equal(api.app.locals.database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 1)
  assert.equal(api.app.locals.database.pragma('foreign_keys', { simple: true }), 1)
  assert.equal(api.app.locals.database.pragma('journal_mode', { simple: true }), 'wal')
})

test('submission rank is calculated after persistence', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, [{ score: 3000 }, { score: 2000 }])
  const response = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-rank-after' },
    body: JSON.stringify(validPayload)
  })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    displayName: 'ARCADE ACE',
    score: 2400,
    rank: 2
  })
})

test('identical idempotent retries return original result without duplicate entries', async t => {
  const api = await createHarness(t)
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-retry-1' },
    body: JSON.stringify(validPayload)
  }
  const first = await api.request('/api/v1/scores', init)
  const firstBody = await first.json()
  const second = await api.request('/api/v1/scores', init)

  assert.equal(first.status, 201)
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), firstBody)
  assert.equal(api.app.locals.database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 1)
})

test('display names are trimmed and the normalized value is persisted and returned', async t => {
  const api = await createHarness(t)
  const response = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-name-trim' },
    body: JSON.stringify({ ...validPayload, displayName: '  ARCADE ACE  ' })
  })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    displayName: 'ARCADE ACE',
    score: 2400,
    rank: 1
  })
  assert.equal(
    api.app.locals.database.prepare('SELECT display_name FROM scores').get().display_name,
    'ARCADE ACE'
  )
})

test('idempotency key reuse with a changed payload returns 409', async t => {
  const api = await createHarness(t)
  await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-conflict-1' },
    body: JSON.stringify(validPayload)
  })
  const response = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-conflict-1' },
    body: JSON.stringify({ ...validPayload, score: 2500 })
  })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(api.app.locals.database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 1)
})

test('concurrent submissions using one key create exactly one row', async t => {
  const api = await createHarness(t)
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-concurrent-1' },
    body: JSON.stringify(validPayload)
  }
  const [first, second] = await Promise.all([
    api.request('/api/v1/scores', init),
    api.request('/api/v1/scores', init)
  ])
  assert.deepEqual([first.status, second.status].sort(), [200, 201])
  assert.equal(api.app.locals.database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 1)
  assert.deepEqual(await first.json(), await second.json())
})

test('score persists and idempotent response survives database close and reopen', async t => {
  const api = await createHarness(t)
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-durable-1' },
    body: JSON.stringify(validPayload)
  }
  const first = await api.request('/api/v1/scores', init)
  const firstBody = await first.json()
  api.app.locals.close()
  const reopened = createDatabase(api.databasePath)
  const service = createLeaderboardService(reopened)
  assert.deepEqual(service.getLeaderboard().entries[0].displayName, 'ARCADE ACE')
  const repeated = service.submitScore({
    ...validPayload,
    displayName: validPayload.displayName.trim()
  }, 'run-durable-1')
  assert.deepEqual(repeated.result, firstBody)
  assert.equal(repeated.statusCode, 200)
  reopened.close()
})

test('submission rejects missing key, invalid names, fields, statistics, and media type', async t => {
  const api = await createHarness(t)
  async function submit(payload, key = 'run-invalid') {
    return api.request('/api/v1/scores', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {})
      },
      body: JSON.stringify(payload)
    })
  }

  const cases = [
    [{ ...validPayload, displayName: '   ' }, 'INVALID_DISPLAY_NAME'],
    [{ ...validPayload, displayName: 'NAME-IS-TOO-LONG' }, 'INVALID_DISPLAY_NAME'],
    [{ ...validPayload, displayName: 'BAD!' }, 'INVALID_DISPLAY_NAME'],
    [{ ...validPayload, score: -1 }, 'INVALID_SCORE'],
    [{ ...validPayload, score: 1.5 }, 'INVALID_SCORE'],
    [{ ...validPayload, score: undefined }, 'INVALID_SCORE'],
    [{ ...validPayload, highestTile: 3 }, 'INVALID_HIGHEST_TILE'],
    [{ ...validPayload, highestTile: -2 }, 'INVALID_HIGHEST_TILE'],
    [{ ...validPayload, moves: -1 }, 'INVALID_MOVES'],
    [{ ...validPayload, durationSeconds: -1 }, 'INVALID_DURATION'],
    [{ ...validPayload, durationSeconds: 1.2 }, 'INVALID_DURATION'],
    [{ ...validPayload, unexpected: true }, 'INVALID_BODY']
  ]

  for (const [payload, code] of cases) {
    const response = await submit(payload, `key-${code}-${Math.random()}`)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, code)
  }

  const missingKey = await submit(validPayload, '')
  assert.equal(missingKey.status, 400)
  assert.equal((await missingKey.json()).error.code, 'INVALID_IDEMPOTENCY_KEY')

  const invalidKey = await submit(validPayload, 'bad key')
  assert.equal(invalidKey.status, 400)
  assert.equal((await invalidKey.json()).error.code, 'INVALID_IDEMPOTENCY_KEY')

  const wrongContentType = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'run-no-json' },
    body: 'not json'
  })
  assert.equal(wrongContentType.status, 415)
})

test('malformed and oversized JSON receive consistent error responses', async t => {
  const api = await createHarness(t)
  const malformed = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'bad-json' },
    body: '{"displayName":'
  })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error.code, 'MALFORMED_JSON')

  const oversized = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'large-json' },
    body: JSON.stringify({ ...validPayload, padding: 'x'.repeat(9000) })
  })
  assert.equal(oversized.status, 413)
  assert.equal((await oversized.json()).error.code, 'REQUEST_TOO_LARGE')
})

test('leaderboard orders scores, shares competition ranks, and never exposes private fields', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, [
    { score: 4000, displayName: 'TOP' },
    { score: 3000, displayName: 'TIE A' },
    { score: 3000, displayName: 'TIE B' },
    { score: 1000, displayName: 'LAST' }
  ])
  const response = await api.request('/api/v1/leaderboard')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body.entries.map(entry => [entry.rank, entry.displayName]), [
    [1, 'TOP'],
    [2, 'TIE A'],
    [2, 'TIE B'],
    [4, 'LAST']
  ])
  assert.equal(body.entries[0].submittedAt, '2026-01-01T00:00:00.000Z')
  assert.equal('id' in body.entries[0], false)
  assert.equal('idempotencyKey' in body.entries[0], false)
})

test('leaderboard returns no more than 100 entries', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, Array.from({ length: 105 }, (_, index) => ({
    score: 100_000 - index,
    displayName: `P${index}`
  })))
  const response = await api.request('/api/v1/leaderboard')
  const body = await response.json()
  assert.equal(body.entries.length, 100)
  assert.equal(body.limit, 100)
  assert.equal(body.entries[99].rank, 100)
})

test('CORS allows configured origin and rejects unconfigured origins', async t => {
  const api = await createHarness(t)
  const allowed = await api.request('/api/v1/health', {
    headers: { Origin: 'https://game.example.test' }
  })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://game.example.test')

  const denied = await api.request('/api/v1/health', {
    headers: { Origin: 'https://attacker.example.test' }
  })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error.code, 'CORS_ORIGIN_DENIED')
  assert.equal(denied.headers.get('access-control-allow-origin'), null)

  const preflight = await api.request('/api/v1/scores', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://game.example.test',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,idempotency-key'
    }
  })
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/)
})

test('GitHub Pages origin can use rank and JSON submission without credentials', async t => {
  const origin = 'https://username.github.io'
  const api = await createHarness(t, { config: { corsOrigins: [origin] } })

  const preflight = await api.request('/api/v1/scores', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,idempotency-key'
    }
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/)
  assert.match(preflight.headers.get('access-control-allow-headers'), /Content-Type/)
  assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/)
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null)

  const rank = await api.request('/api/v1/leaderboard/rank?score=10', {
    headers: { Origin: origin }
  })
  assert.equal(rank.status, 200)

  const denied = await api.request('/api/v1/leaderboard/rank?score=10', {
    headers: { Origin: 'https://other.github.io' }
  })
  assert.equal(denied.status, 403)
})

test('rate limiting returns 429 with retry metadata', async t => {
  const api = await createHarness(t, {
    config: { rateLimitMax: 2, rateLimitWindowMs: 60_000 }
  })
  assert.equal((await api.request('/api/v1/health')).status, 200)
  assert.equal((await api.request('/api/v1/health')).status, 200)
  const limited = await api.request('/api/v1/health')
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED')
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
})

test('unknown routes use the common JSON error response', async t => {
  const api = await createHarness(t)
  const response = await api.request('/api/v1/not-found')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: { code: 'NOT_FOUND', message: 'The requested endpoint was not found.' }
  })
})
