const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const GameEngine = require('../game-engine')

const ids = [
  'grid', 'score', 'best-score', 'game-info', 'game-status', 'arcade-screen', 'arcade-heading',
  'mock-badge', 'final-score', 'highest-tile', 'move-count', 'game-duration',
  'local-best', 'rank-error-title', 'rank-error-message', 'rank-value',
  'rank-description', 'rank-invitation', 'not-qualified', 'leaderboard-limit',
  'declined', 'name-form', 'display-name', 'name-counter', 'name-error',
  'submit-score', 'submission-error-message', 'submission-result-title',
  'submission-result-note', 'submitted-name', 'submitted-score', 'submitted-rank',
  'view-leaderboard', 'rank-loading', 'rank-error', 'rank-result', 'name-entry',
  'submission-loading', 'submission-error', 'submission-result', 'retry-rank',
  'enter-name', 'decline-name', 'cancel-name', 'retry-submission', 'cancel-submission',
  'arcade-replay', 'leaderboard-view', 'leaderboard-loading', 'leaderboard-error',
  'leaderboard-error-message', 'leaderboard-empty', 'leaderboard-list',
  'leaderboard-entries', 'retry-leaderboard', 'back-to-result', 'leaderboard-heading'
]

class FakeElement {
  constructor() {
    this.children = []
    this.dataset = {}
    this.attributes = {}
    this.listeners = new Map()
    this.hidden = false
    this.textContent = ''
    this.value = ''
    this.disabled = false
    this.href = ''
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      preventDefault() {
        this.defaultPrevented = true
      },
      ...properties
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
    return event
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }

  replaceChildren(...children) {
    this.children = children
  }

  setAttribute(name, value) {
    this.attributes[name] = value
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  focus() {
    this.focused = true
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeApi({ rank, rankError, submission, submissionError, leaderboard, leaderboardError } = {}) {
  const calls = { rank: [], submissions: [], leaderboard: 0 }
  const api = {
    getProjectedRank(payload) {
      calls.rank.push(payload)
      if (rankError) {
        return Promise.reject(rankError)
      }
      return typeof rank === 'function' ? rank(payload) : Promise.resolve(rank ?? {
        rank: 7,
        qualifies: true,
        leaderboardLimit: 100,
        source: 'backend'
      })
    },
    submitScore(payload) {
      calls.submissions.push(payload)
      if (submissionError) {
        return Promise.reject(submissionError)
      }
      return typeof submission === 'function' ? submission(payload) : Promise.resolve(submission ?? {
        displayName: payload.displayName,
        score: payload.score,
        rank: 7,
        leaderboardUrl: 'https://api.example.test/api/v1/leaderboard',
        source: 'backend'
      })
    },
    getLeaderboardUrl() {
      return 'https://api.example.test/api/v1/leaderboard'
    },
    getLeaderboard() {
      calls.leaderboard += 1
      if (leaderboardError) {
        return Promise.reject(leaderboardError)
      }
      if (leaderboard) {
        return Promise.resolve(leaderboard)
      }
      return Promise.resolve({
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
    }
  }
  return { api, calls }
}

function createApp({ api = makeApi().api, outcome, initialState } = {}) {
  const elements = new Map(ids.map(id => [id, new FakeElement()]))
  elements.get('display-name').setAttribute('maxlength', '12')
  const document = new FakeElement()
  document.getElementById = id => elements.get(id)
  document.createElement = () => new FakeElement()
  const stored = new Map()
  const localStorage = {
    getItem(key) {
      return stored.get(key) ?? null
    },
    setItem(key, value) {
      stored.set(key, value)
    }
  }

  let firstGame = true
  const engine = {
    ...GameEngine,
    createGame() {
      if (firstGame && initialState) {
        firstGame = false
        return { ...initialState, board: initialState.board.slice() }
      }
      firstGame = false
      return GameEngine.createGame(() => 0.1)
    },
    move(state, direction) {
      if (outcome) {
        return { ...outcome, state: { ...outcome.state, board: outcome.state.board.slice() } }
      }
      return GameEngine.move(state, direction, () => 0.1)
    }
  }

  const script = fs.readFileSync(path.join(__dirname, '..', 'functions.js'), 'utf8')
  vm.runInNewContext(script, { document, GameEngine: engine, LeaderboardAPI: api, localStorage })
  document.dispatch('DOMContentLoaded')

  return { document, elements, grid: elements.get('grid'), stored }
}

function endGame(app) {
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve))
}

const initialState = {
  board: [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  score: 0,
  status: 'playing'
}

const terminalOutcome = {
  moved: true,
  scoreDelta: 2400,
  state: {
    board: [2048, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2, 4, 8, 16, 32, 64],
    score: 2400,
    status: 'won'
  }
}

test('game end shows final score, highest tile, moves, duration, and rank loading state', () => {
  const pendingRank = deferred()
  const { api, calls } = makeApi({ rank: () => pendingRank.promise })
  const app = createApp({ api, outcome: terminalOutcome, initialState })

  endGame(app)

  assert.equal(app.elements.get('arcade-heading').textContent, 'GAME OVER')
  assert.equal(app.elements.get('arcade-screen').hidden, false)
  assert.equal(app.elements.get('grid').hidden, true)
  assert.equal(app.elements.get('game-info').hidden, true)
  assert.match(app.elements.get('game-status').className, /visually-hidden/)
  assert.equal(app.elements.get('final-score').textContent, '2400')
  assert.equal(app.elements.get('highest-tile').textContent, '2048')
  assert.equal(app.elements.get('move-count').textContent, '1')
  assert.match(app.elements.get('game-duration').textContent, /^\d+:\d{2}$/)
  assert.equal(app.elements.get('rank-loading').hidden, false)
  assert.equal(calls.rank.length, 1)
  assert.equal(calls.rank[0].score, 2400)
})

test('qualifying rank invites the player to enter a name and accepts it only by choice', async () => {
  const pendingSubmission = deferred()
  const { api, calls } = makeApi({ submission: () => pendingSubmission.promise })
  const app = createApp({ api, outcome: terminalOutcome, initialState })

  endGame(app)
  await settle()

  assert.equal(app.elements.get('rank-result').hidden, false)
  assert.equal(app.elements.get('rank-value').textContent, 'TOP 10 — GLOBAL RANK #7')
  assert.equal(app.elements.get('rank-invitation').hidden, false)
  assert.equal(calls.submissions.length, 0)

  app.elements.get('enter-name').dispatch('click')
  assert.equal(app.elements.get('name-entry').hidden, false)
  assert.equal(app.elements.get('display-name').focused, true)
  assert.equal(app.elements.get('display-name').attributes.maxlength, '12')
})

test('non-qualifying scores are clearly explained without inviting name entry', async () => {
  const { api } = makeApi({
    rank: { rank: null, qualifies: false, leaderboardLimit: 100, source: 'backend' }
  })
  const app = createApp({ api, outcome: terminalOutcome, initialState })

  endGame(app)
  await settle()

  assert.equal(app.elements.get('rank-value').textContent, 'OUTSIDE THE TOP 100')
  assert.equal(app.elements.get('rank-invitation').hidden, true)
  assert.equal(app.elements.get('not-qualified').hidden, false)
  assert.equal(app.elements.get('leaderboard-limit').textContent, '100')
})

test('empty, overlong, and unsupported display names are rejected before submission', async () => {
  const { api, calls } = makeApi()
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')

  app.elements.get('name-form').dispatch('submit')
  assert.match(app.elements.get('name-error').textContent, /Enter a display name/)
  assert.equal(calls.submissions.length, 0)

  const input = app.elements.get('display-name')
  input.value = 'PLAYER!'; input.dispatch('input')
  app.elements.get('name-form').dispatch('submit')
  assert.match(app.elements.get('name-error').textContent, /Use letters/)
  input.value = 'TOO-LONG-PLAYER'; input.dispatch('input')
  assert.equal(app.elements.get('name-counter').textContent, '15 / 12')
  app.elements.get('name-form').dispatch('submit')
  assert.match(app.elements.get('name-error').textContent, /12 characters or fewer/)
  assert.equal(calls.submissions.length, 0)
})

test('name entry submits only after consent and displays backend-confirmed rank', async () => {
  const pendingSubmission = deferred()
  const { api, calls } = makeApi({ submission: () => pendingSubmission.promise })
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')

  const input = app.elements.get('display-name')
  input.value = 'ARCADE ACE'
  input.dispatch('input')
  assert.equal(app.elements.get('name-counter').textContent, '10 / 12')
  app.elements.get('name-form').dispatch('submit')
  assert.equal(app.elements.get('submission-loading').hidden, false)
  assert.equal(app.elements.get('submit-score').disabled, true)
  assert.equal(calls.submissions.length, 1)
  assert.equal(calls.submissions[0].displayName, 'ARCADE ACE')
  assert.equal(calls.submissions[0].score, 2400)
  assert.equal(calls.submissions[0].highestTile, 2048)
  assert.equal(calls.submissions[0].moves, 1)
  assert.equal(Number.isInteger(calls.submissions[0].durationSeconds), true)
  assert.match(calls.submissions[0].submissionId, /^2048-/)

  app.elements.get('name-form').dispatch('submit')
  assert.equal(calls.submissions.length, 1)
  pendingSubmission.resolve({
    displayName: 'ARCADE ACE',
    score: 2400,
    rank: 3,
    leaderboardUrl: 'https://api.example.test/api/v1/leaderboard',
    source: 'backend'
  })
  await settle()

  assert.equal(app.elements.get('submission-result').hidden, false)
  assert.equal(app.elements.get('submission-result-title').textContent, 'SCORE RECORDED')
  assert.equal(app.elements.get('submitted-name').textContent, 'ARCADE ACE')
  assert.equal(app.elements.get('submitted-score').textContent, '2400')
  assert.equal(app.elements.get('submitted-rank').textContent, '#3')
  assert.equal(app.elements.get('view-leaderboard').hidden, false)
})

test('declining does not submit a score, returns to the summary, and replay preserves local best', async () => {
  const { api, calls } = makeApi()
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()

  app.elements.get('decline-name').dispatch('click')
  assert.equal(app.elements.get('rank-result').hidden, false)
  assert.equal(app.elements.get('declined').hidden, false)
  assert.equal(calls.submissions.length, 0)
  assert.equal(app.stored.get('2048-best-score'), '2400')
  assert.equal(app.elements.get('local-best').textContent, '2400')

  app.elements.get('arcade-replay').dispatch('click')
  assert.equal(app.elements.get('arcade-screen').hidden, true)
  assert.equal(app.elements.get('grid').hidden, false)
  assert.equal(app.elements.get('game-info').hidden, false)
  assert.equal(app.elements.get('best-score').textContent, '2400')
  assert.equal(app.document.listenerCount('keydown'), 1)
})

test('failed submission is not reported as successful and can be retried', async () => {
  let attempts = 0
  const { api, calls } = makeApi({
    submission: () => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({
          displayName: 'ACE',
          score: 2400,
          rank: 8,
          source: 'backend'
        })
    }
  })
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')
  await settle()

  assert.equal(app.elements.get('submission-error').hidden, false)
  assert.equal(app.elements.get('submission-result').hidden, true)
  assert.match(app.elements.get('submission-error-message').textContent, /not confirm/)

  app.elements.get('retry-submission').dispatch('click')
  await settle()
  assert.equal(calls.submissions.length, 2)
  assert.equal(calls.submissions[0].submissionId, calls.submissions[1].submissionId)
  assert.deepEqual(calls.submissions[0], calls.submissions[1])
  assert.equal(app.elements.get('submission-result').hidden, false)
  assert.equal(app.elements.get('submitted-rank').textContent, '#8')
})

test('submission retries keep the attempted name and all request fields bound to its key', async () => {
  const calls = { count: 0, payloads: [] }
  const { api } = makeApi({
    submission: payload => {
      calls.count += 1
      calls.payloads.push({ ...payload })
      if (calls.count === 1) {
        return Promise.reject(Object.assign(new Error('timed out'), { code: 'TIMEOUT' }))
      }
      return Promise.resolve({
        displayName: payload.displayName,
        score: payload.score,
        rank: 2,
        source: 'backend'
      })
    }
  })
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')
  await settle()

  assert.match(app.elements.get('submission-error-message').textContent, /may have been saved/)
  app.elements.get('cancel-submission').dispatch('click')
  assert.equal(app.elements.get('name-entry').hidden, false)
  assert.equal(app.elements.get('display-name').readOnly, true)
  app.elements.get('display-name').value = 'CHANGED'
  app.elements.get('name-form').dispatch('submit')
  await settle()

  assert.equal(calls.payloads.length, 2)
  assert.deepEqual(calls.payloads[0], calls.payloads[1])
  assert.equal(app.elements.get('submitted-name').textContent, 'ACE')
  assert.equal(app.elements.get('submission-result').hidden, false)
})

test('confirmed leaderboard control loads a useful in-app list and returns to the score', async () => {
  const { api, calls } = makeApi()
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')
  await settle()

  app.elements.get('view-leaderboard').dispatch('click')
  await settle()
  assert.equal(calls.leaderboard, 1)
  assert.equal(app.elements.get('leaderboard-list').hidden, false)
  assert.equal(app.elements.get('leaderboard-entries').children.length, 1)
  assert.deepEqual(
    app.elements.get('leaderboard-entries').children[0].children.map(cell => cell.textContent),
    ['#1', 'ARCADE ACE', '2,400', '2,048']
  )

  app.elements.get('back-to-result').dispatch('click')
  assert.equal(app.elements.get('submission-result').hidden, false)
})

test('leaderboard failures show a retry state without hiding play again', async () => {
  const { api, calls } = makeApi({
    leaderboardError: Object.assign(new Error('Leaderboard is offline.'), { code: 'UNAVAILABLE' })
  })
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')
  await settle()
  app.elements.get('view-leaderboard').dispatch('click')
  await settle()

  assert.equal(app.elements.get('leaderboard-error').hidden, false)
  assert.match(app.elements.get('leaderboard-error-message').textContent, /offline/)
  assert.equal(app.elements.get('arcade-replay').hidden, false)
  app.elements.get('retry-leaderboard').dispatch('click')
  await settle()
  assert.equal(calls.leaderboard, 2)
})

test('rank-service outage offers retry and replay without fabricating a rank', async () => {
  let calls = 0
  const { api } = makeApi({
    rank: () => {
      calls += 1
      return Promise.reject(Object.assign(new Error('offline'), { code: 'UNAVAILABLE' }))
    }
  })
  const app = createApp({ api, outcome: terminalOutcome, initialState })

  endGame(app)
  await settle()
  assert.equal(app.elements.get('rank-error').hidden, false)
  assert.equal(app.elements.get('rank-error-title').textContent, 'LEADERBOARD OFFLINE')
  assert.equal(app.elements.get('rank-value').textContent, '')
  assert.equal(app.elements.get('rank-invitation').hidden, true)

  app.elements.get('retry-rank').dispatch('click')
  await settle()
  assert.equal(calls, 2)
  app.elements.get('arcade-replay').dispatch('click')
  assert.equal(app.elements.get('arcade-screen').hidden, true)
})

test('development mock results are visibly identified and never claim a real submission', async () => {
  const { api } = makeApi({
    rank: { rank: 7, qualifies: true, leaderboardLimit: 100, source: 'development-mock' },
    submission: payload => Promise.resolve({
      displayName: payload.displayName,
      score: payload.score,
      rank: 7,
      source: 'development-mock'
    })
  })
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  assert.equal(app.elements.get('mock-badge').hidden, false)
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'DEMO'
  app.elements.get('name-form').dispatch('submit')
  await settle()

  assert.match(app.elements.get('submission-result-title').textContent, /NOT SUBMITTED/)
  assert.match(app.elements.get('submission-result-note').textContent, /did not publish/)
  assert.equal(app.elements.get('view-leaderboard').hidden, true)
})

test('restart after a confirmed submission begins a fresh game', async () => {
  const app = createApp({ outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')
  await settle()

  app.elements.get('arcade-replay').dispatch('click')
  assert.equal(app.elements.get('arcade-screen').hidden, true)
  assert.equal(app.elements.get('score').textContent, '0')
  assert.equal(app.elements.get('best-score').textContent, '2400')
  assert.equal(app.document.listenerCount('keydown'), 1)
})

test('each completed game run receives a different idempotency key', async () => {
  const { api, calls } = makeApi()
  const app = createApp({ api, outcome: terminalOutcome, initialState })

  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')
  await settle()
  const firstKey = calls.submissions[0].submissionId

  app.elements.get('arcade-replay').dispatch('click')
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')
  await settle()
  const secondKey = calls.submissions[1].submissionId

  assert.notEqual(firstKey, secondKey)
})

test('play again remains available while requests are pending and ignores stale responses', async () => {
  const pendingRank = deferred()
  const { api } = makeApi({ rank: () => pendingRank.promise })
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)

  assert.equal(app.elements.get('rank-loading').hidden, false)
  app.elements.get('arcade-replay').dispatch('click')
  assert.equal(app.elements.get('arcade-screen').hidden, true)
  pendingRank.resolve({
    rank: 7,
    qualifies: true,
    leaderboardLimit: 100,
    source: 'backend'
  })
  await settle()
  assert.equal(app.elements.get('arcade-screen').hidden, true)
  assert.equal(app.document.listenerCount('keydown'), 1)
})

test('replay during submission unlocks the next run and ignores the old confirmation', async () => {
  const pendingSubmission = deferred()
  const { api } = makeApi({ submission: () => pendingSubmission.promise })
  const app = createApp({ api, outcome: terminalOutcome, initialState })
  endGame(app)
  await settle()
  app.elements.get('enter-name').dispatch('click')
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('name-form').dispatch('submit')

  assert.equal(app.elements.get('submit-score').disabled, true)
  app.elements.get('arcade-replay').dispatch('click')
  assert.equal(app.elements.get('arcade-screen').hidden, true)
  assert.equal(app.elements.get('submit-score').disabled, false)

  pendingSubmission.resolve({
    displayName: 'ACE',
    score: 2400,
    rank: 7,
    source: 'backend'
  })
  await settle()
  assert.equal(app.elements.get('arcade-screen').hidden, true)
})
