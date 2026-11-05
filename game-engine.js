(function (root, factory) {
  const engine = factory()

  if (typeof module === 'object' && module.exports) {
    module.exports = engine
  } else {
    root.GameEngine = engine
  }
})(globalThis, function () {
  const SIZE = 4
  const CELL_COUNT = SIZE * SIZE
  const DIRECTIONS = new Set(['up', 'down', 'left', 'right'])

  function createGame(random = Math.random) {
    let state = {
      board: Array(CELL_COUNT).fill(0),
      score: 0,
      status: 'playing'
    }

    state = generateTile(state, random)
    state = generateTile(state, random)
    return state
  }

  function generateTile(state, random = Math.random) {
    const emptyIndices = []
    state.board.forEach((value, index) => {
      if (value === 0) {
        emptyIndices.push(index)
      }
    })

    if (emptyIndices.length === 0) {
      return state
    }

    const randomIndex = Math.min(
      emptyIndices.length - 1,
      Math.floor(random() * emptyIndices.length)
    )
    const tile = random() < 0.6 ? 2 : 4
    const board = state.board.slice()
    board[emptyIndices[randomIndex]] = tile

    return { ...state, board }
  }

  function getLines(direction) {
    const lines = []

    for (let line = 0; line < SIZE; line += 1) {
      const indices = []
      for (let position = 0; position < SIZE; position += 1) {
        if (direction === 'left' || direction === 'right') {
          const column = direction === 'left' ? position : SIZE - 1 - position
          indices.push(line * SIZE + column)
        } else {
          const row = direction === 'up' ? position : SIZE - 1 - position
          indices.push(row * SIZE + line)
        }
      }
      lines.push(indices)
    }

    return lines
  }

  function move(state, direction, random = Math.random) {
    if (state.status !== 'playing' || !DIRECTIONS.has(direction)) {
      return { state, moved: false, scoreDelta: 0 }
    }

    const board = state.board.slice()
    let scoreDelta = 0

    for (const line of getLines(direction)) {
      const tiles = line.map(index => board[index]).filter(value => value !== 0)
      const merged = []

      for (let index = 0; index < tiles.length; index += 1) {
        if (tiles[index] === tiles[index + 1]) {
          const value = tiles[index] * 2
          merged.push(value)
          scoreDelta += value
          index += 1
        } else {
          merged.push(tiles[index])
        }
      }

      while (merged.length < SIZE) {
        merged.push(0)
      }

      line.forEach((boardIndex, position) => {
        board[boardIndex] = merged[position]
      })
    }

    const moved = board.some((value, index) => value !== state.board[index])
    if (!moved) {
      return { state, moved: false, scoreDelta: 0 }
    }

    let nextState = {
      board,
      score: state.score + scoreDelta,
      status: hasWon(board) ? 'won' : 'playing'
    }

    if (nextState.status === 'playing') {
      nextState = generateTile(nextState, random)
      if (isGameOver(nextState.board)) {
        nextState = { ...nextState, status: 'lost' }
      }
    }

    return { state: nextState, moved: true, scoreDelta }
  }

  function hasWon(board) {
    return board.includes(2048)
  }

  function isGameOver(board) {
    if (board.includes(0)) {
      return false
    }

    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        const index = row * SIZE + column
        if (
          (column < SIZE - 1 && board[index] === board[index + 1]) ||
          (row < SIZE - 1 && board[index] === board[index + SIZE])
        ) {
          return false
        }
      }
    }

    return true
  }

  return { createGame, generateTile, move, hasWon, isGameOver }
})
