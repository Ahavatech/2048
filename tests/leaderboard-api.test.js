const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createLeaderboardApi } = require('../leaderboard-api')

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

test('requests projected rank from the configured backend', async () => {
  const requests = []
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    search: '',
    fetch: async (url, init) => {
      requests.push({ url, init })
      return jsonResponse({ rank: 7, qualifies: true, leaderboardLimit: 100 })
    }
  })

  const result = await api.getProjectedRank({ score: 1250 })
  assert.deepEqual(result, {
    rank: 7,
    qualifies: true,
    leaderboardLimit: 100,
    source: 'backend'
  })
  assert.equal(requests[0].url, 'https://api.example.test/api/v1/leaderboard/rank?score=1250')
  assert.equal(requests[0].init.credentials, 'omit')
  assert.ok(requests[0].init.signal instanceof AbortSignal)
})

test('submits the final run and a stable idempotency key to the backend', async () => {
  let request
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    search: '',
    fetch: async (url, init) => {
      request = { url, init }
      return jsonResponse({
        displayName: 'ARCADE ACE',
        score: 1250,
        rank: 4
      })
    }
  })
  const payload = {
    submissionId: '2048-run-1',
    displayName: 'ARCADE ACE',
    score: 1250,
    highestTile: 512,
    moves: 33,
    durationSeconds: 91
  }

  const result = await api.submitScore(payload)
  assert.equal(request.url, 'https://api.example.test/api/v1/scores')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers['Idempotency-Key'], payload.submissionId)
  assert.deepEqual(JSON.parse(request.init.body), {
    displayName: payload.displayName,
    score: payload.score,
    highestTile: payload.highestTile,
    moves: payload.moves,
    durationSeconds: payload.durationSeconds
  })
  assert.equal(result.source, 'backend')
  assert.equal(api.getLeaderboardUrl(), 'https://api.example.test/api/v1/leaderboard')
})

test('explicit localhost mock is visibly marked and only used on service unavailability', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'localhost',
    search: '?leaderboard=mock',
    fetch: async () => {
      throw new Error('network down')
    }
  })

  const rank = await api.getProjectedRank({ score: 1200 })
  const submission = await api.submitScore({
    submissionId: 'mock-run',
    displayName: 'DEMO',
    score: 1200,
    highestTile: 512,
    moves: 12,
    durationSeconds: 45
  })
  assert.deepEqual(rank, {
    rank: 7,
    qualifies: true,
    leaderboardLimit: 100,
    source: 'development-mock'
  })
  assert.equal(submission.source, 'development-mock')
})

test('development mock is unavailable on production hosts and without explicit opt-in', async () => {
  const productionApi = createLeaderboardApi({
    hostname: 'game.example.test',
    search: '?leaderboard=mock',
    fetch: async () => {
      throw new Error('should not fetch')
    }
  })
  const localApi = createLeaderboardApi({
    hostname: 'localhost',
    search: '',
    fetch: async () => {
      throw new Error('should not fetch')
    }
  })

  await assert.rejects(productionApi.getProjectedRank({ score: 1200 }), { code: 'UNAVAILABLE' })
  await assert.rejects(localApi.getProjectedRank({ score: 1200 }), { code: 'UNAVAILABLE' })
})

test('does not replace backend validation errors with mock data', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'localhost',
    search: '?leaderboard=mock',
    fetch: async () => jsonResponse({ error: 'invalid score' }, 400)
  })

  await assert.rejects(api.getProjectedRank({ score: 1200 }), { code: 'REQUEST_FAILED' })
})

test('falls back to the explicit local mock on backend service-unavailable responses', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'localhost',
    search: '?leaderboard=mock',
    fetch: async () => jsonResponse({}, 503)
  })

  const result = await api.getProjectedRank({ score: 100 })
  assert.equal(result.source, 'development-mock')
  assert.equal(result.qualifies, false)
  assert.equal(result.rank, null)
})

test('rejects malformed backend rank responses', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    search: '',
    fetch: async () => jsonResponse({ rank: 'seven', qualifies: true, leaderboardLimit: 100 })
  })

  await assert.rejects(api.getProjectedRank({ score: 1200 }), { code: 'INVALID_RESPONSE' })
})

test('uses the server qualification response for non-qualifying scores', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    fetch: async () => jsonResponse({ rank: null, qualifies: false, leaderboardLimit: 100 })
  })

  assert.deepEqual(await api.getProjectedRank({ score: 0 }), {
    rank: null,
    qualifies: false,
    leaderboardLimit: 100,
    source: 'backend'
  })
})

test('reports backend validation and idempotency conflict errors', async () => {
  for (const [status, code, message] of [
    [400, 'INVALID_DISPLAY_NAME', 'displayName is invalid.'],
    [409, 'IDEMPOTENCY_CONFLICT', 'The key was already used.']
  ]) {
    const api = createLeaderboardApi({
      baseUrl: 'https://api.example.test',
      hostname: 'game.example.test',
      fetch: async () => jsonResponse({ error: { code, message } }, status)
    })
    await assert.rejects(
      api.submitScore({
        submissionId: 'run-1',
        displayName: 'ACE',
        score: 10,
        highestTile: 2,
        moves: 1,
        durationSeconds: 2
      }),
      error => error.code === code && error.status === status && error.message === message
    )
  }
})

test('reports non-2xx and malformed successful JSON without fabricating a result', async () => {
  const rejected = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    fetch: async () => jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error.' } }, 500)
  })
  await assert.rejects(rejected.getProjectedRank({ score: 1 }), {
    code: 'INTERNAL_ERROR',
    status: 500,
    message: 'Unexpected error.'
  })

  const invalid = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('not json') }
    })
  })
  await assert.rejects(invalid.getProjectedRank({ score: 1 }), { code: 'INVALID_RESPONSE' })
})

test('times out a pending request and includes the abort signal', async () => {
  let signal
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    timeoutMs: 10,
    fetch: (url, init) => {
      signal = init.signal
      return new Promise(() => {})
    }
  })

  await assert.rejects(api.getProjectedRank({ score: 1 }), { code: 'TIMEOUT' })
  assert.equal(signal.aborted, true)
})

test('request timeout also covers a stalled response body', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    timeoutMs: 10,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => {})
    })
  })

  await assert.rejects(api.getProjectedRank({ score: 1 }), { code: 'TIMEOUT' })
})

test('network failures are explicit and use no credentials', async () => {
  let requestInit
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    fetch: async (url, init) => {
      requestInit = init
      throw new TypeError('Network error')
    }
  })

  await assert.rejects(api.getProjectedRank({ score: 1 }), { code: 'UNAVAILABLE' })
  assert.equal(requestInit.credentials, 'omit')
})

test('GitHub Pages hosts never enable the localhost development mock', async () => {
  const api = createLeaderboardApi({
    hostname: 'username.github.io',
    search: '?leaderboard=mock'
  })

  await assert.rejects(api.getProjectedRank({ score: 1000 }), { code: 'UNAVAILABLE' })
})

test('fetches and validates the real leaderboard response shape', async () => {
  const requests = []
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    hostname: 'game.example.test',
    fetch: async (url, init) => {
      requests.push({ url, init })
      return jsonResponse({
        entries: [{
          rank: 1,
          displayName: 'ARCADE ACE',
          score: 2400,
          highestTile: 2048,
          submittedAt: '2026-11-05T10:00:00.000Z'
        }],
        limit: 100
      })
    }
  })

  assert.deepEqual(await api.getLeaderboard(), {
    entries: [{
      rank: 1,
      displayName: 'ARCADE ACE',
      score: 2400,
      highestTile: 2048,
      submittedAt: '2026-11-05T10:00:00.000Z'
    }],
    limit: 100,
    source: 'backend'
  })
  assert.equal(requests[0].url, 'https://api.example.test/api/v1/leaderboard')
  assert.equal(requests[0].init.credentials, 'omit')
})

test('browser global is an API instance configured from the arcade-api-base meta tag', async () => {
  let requestedUrl
  const context = {
    document: {
      querySelector(selector) {
        assert.equal(selector, 'meta[name="arcade-api-base"]')
        return { content: ' https://api.example.test/ ' }
      }
    },
    location: { hostname: 'username.github.io', search: '?leaderboard=mock' },
    fetch: async url => {
      requestedUrl = url
      return jsonResponse({ rank: 3, qualifies: true, leaderboardLimit: 100 })
    },
    AbortController,
    setTimeout,
    clearTimeout,
    URLSearchParams
  }
  const script = fs.readFileSync(path.join(__dirname, '..', 'leaderboard-api.js'), 'utf8')
  vm.runInNewContext(script, context)

  assert.equal(typeof context.LeaderboardAPI.getProjectedRank, 'function')
  assert.equal(typeof context.LeaderboardAPI.submitScore, 'function')
  const result = await context.LeaderboardAPI.getProjectedRank({ score: 1000 })
  assert.equal(result.rank, 3)
  assert.equal(result.qualifies, true)
  assert.equal(result.leaderboardLimit, 100)
  assert.equal(result.source, 'backend')
  assert.equal(requestedUrl, 'https://api.example.test/api/v1/leaderboard/rank?score=1000')
})
