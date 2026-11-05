const test = require('node:test')
const assert = require('node:assert/strict')
const GameEngine = require('../game-engine')

function randomSequence(...values) {
  let index = 0
  return () => values[index++ % values.length]
}

function gameWith(board, score = 0) {
  return { board, score, status: 'playing' }
}

function boardWith(values) {
  const board = Array(16).fill(0)
  for (const [index, value] of Object.entries(values)) {
    board[Number(index)] = value
  }
  return board
}

test('moves and merges each horizontal row independently', () => {
  const state = gameWith(boardWith({ 0: 2, 2: 2, 3: 2 }))
  const outcome = GameEngine.move(state, 'left', randomSequence(0.99, 0.99))

  assert.equal(outcome.moved, true)
  assert.equal(outcome.scoreDelta, 4)
  assert.equal(outcome.state.score, 4)
  assert.deepEqual(outcome.state.board.slice(0, 4), [4, 2, 0, 0])
  assert.equal(outcome.state.board[15], 4)
})

test('moves and merges each vertical column independently', () => {
  const state = gameWith(boardWith({ 0: 2, 4: 2, 12: 2 }))
  const outcome = GameEngine.move(state, 'up', randomSequence(0.99, 0.99))

  assert.equal(outcome.scoreDelta, 4)
  assert.deepEqual(
    [outcome.state.board[0], outcome.state.board[4], outcome.state.board[8], outcome.state.board[12]],
    [4, 2, 0, 0]
  )
})

test('does not merge the end of one row with the start of another', () => {
  const state = gameWith(boardWith({ 3: 2, 4: 2 }))
  const outcome = GameEngine.move(state, 'left', randomSequence(0.99, 0.99))

  assert.equal(outcome.scoreDelta, 0)
  assert.deepEqual(outcome.state.board.slice(0, 8), [2, 0, 0, 0, 2, 0, 0, 0])
})

test('a tile can merge only once in a move', () => {
  const state = gameWith(boardWith({ 0: 2, 1: 2, 2: 2, 3: 2 }))
  const outcome = GameEngine.move(state, 'left', randomSequence(0.99, 0.99))

  assert.equal(outcome.scoreDelta, 8)
  assert.deepEqual(outcome.state.board.slice(0, 4), [4, 4, 0, 0])
  assert.equal(outcome.state.board[15], 4)
})

test('moves right and down toward the correct edge', () => {
  const row = gameWith(boardWith({ 0: 2, 1: 2, 2: 2, 3: 2 }))
  const right = GameEngine.move(row, 'right', randomSequence(0.99, 0.99))
  assert.deepEqual(right.state.board.slice(0, 4), [0, 0, 4, 4])

  const column = gameWith(boardWith({ 0: 2, 4: 2, 8: 2, 12: 2 }))
  const down = GameEngine.move(column, 'down', randomSequence(0.99, 0.99))
  assert.deepEqual(
    [down.state.board[0], down.state.board[4], down.state.board[8], down.state.board[12]],
    [0, 0, 4, 4]
  )
})

test('generates two tiles in random empty cells with the existing 60/40 values', () => {
  const state = GameEngine.createGame(randomSequence(0, 0.1, 0.99, 0.9))
  assert.equal(state.board[0], 2)
  assert.equal(state.board[15], 4)
  assert.equal(state.board.filter(value => value !== 0).length, 2)

  const noSpace = gameWith(Array(16).fill(2))
  assert.equal(GameEngine.generateTile(noSpace, () => 0), noSpace)
})

test('detects a win and stops at 2048 without spawning another tile', () => {
  const state = gameWith(boardWith({ 0: 1024, 1: 1024 }))
  const outcome = GameEngine.move(state, 'left', () => {
    throw new Error('A winning move must not spawn a tile')
  })

  assert.equal(outcome.state.status, 'won')
  assert.equal(outcome.state.score, 2048)
  assert.deepEqual(outcome.state.board.slice(0, 4), [2048, 0, 0, 0])
  assert.equal(GameEngine.hasWon(outcome.state.board), true)
})

test('detects loss only when a full board has no adjacent equal tiles', () => {
  const deadlocked = [
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2
  ]
  assert.equal(GameEngine.isGameOver(deadlocked), true)
  assert.equal(GameEngine.isGameOver(Array(16).fill(2)), false)
  assert.equal(GameEngine.isGameOver(deadlocked.slice(0, 15).concat(0)), false)
})

test('reports game over after the last move fills a deadlocked board', () => {
  const state = gameWith(boardWith({
    0: 8, 2: 16, 3: 32,
    4: 64, 5: 128, 6: 256, 7: 512,
    8: 1024, 9: 4096, 10: 8192, 11: 16384,
    12: 32768, 13: 65536, 14: 131072, 15: 262144
  }))
  const outcome = GameEngine.move(state, 'right', randomSequence(0, 0.1))

  assert.equal(outcome.state.status, 'lost')
  assert.equal(outcome.state.board.includes(0), false)
})

test('restart creates a fresh board and resets the score', () => {
  const previous = gameWith(Array(16).fill(0).map((_, index) => index < 2 ? 2 : 0), 120)
  const restarted = GameEngine.createGame(randomSequence(0, 0.1, 0, 0.1))

  assert.equal(restarted.score, 0)
  assert.equal(restarted.status, 'playing')
  assert.equal(restarted.board.filter(value => value !== 0).length, 2)
  assert.notEqual(restarted.board, previous.board)
  assert.equal(previous.score, 120)
})

test('invalid directions and unchanged moves do not alter or spawn tiles', () => {
  const state = gameWith(boardWith({ 0: 2 }))
  const invalid = GameEngine.move(state, 'diagonal', () => {
    throw new Error('Invalid moves must not generate a tile')
  })
  const unchanged = GameEngine.move(state, 'left', () => {
    throw new Error('Unchanged moves must not generate a tile')
  })

  assert.equal(invalid.moved, false)
  assert.equal(unchanged.moved, false)
  assert.equal(invalid.state, state)
  assert.equal(unchanged.state, state)
  assert.equal(state.score, 0)
  assert.equal(state.board[0], 2)
})
