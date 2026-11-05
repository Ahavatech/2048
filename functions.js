document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('grid')
  const scoreDisplay = document.getElementById('score')
  const bestScoreDisplay = document.getElementById('best-score')
  const gameInfo = document.getElementById('game-info')
  const gameCredits = document.getElementById('game-credits')
  const statusDisplay = document.getElementById('game-status')
  const arcadeScreen = document.getElementById('arcade-screen')
  const arcadeHeading = document.getElementById('arcade-heading')
  const mockBadge = document.getElementById('mock-badge')
  const finalScoreDisplay = document.getElementById('final-score')
  const highestTileDisplay = document.getElementById('highest-tile')
  const moveCountDisplay = document.getElementById('move-count')
  const durationDisplay = document.getElementById('game-duration')
  const localBestDisplay = document.getElementById('local-best')
  const rankErrorTitle = document.getElementById('rank-error-title')
  const rankErrorMessage = document.getElementById('rank-error-message')
  const rankValue = document.getElementById('rank-value')
  const rankDescription = document.getElementById('rank-description')
  const rankInvitation = document.getElementById('rank-invitation')
  const notQualified = document.getElementById('not-qualified')
  const leaderboardLimit = document.getElementById('leaderboard-limit')
  const declined = document.getElementById('declined')
  const nameForm = document.getElementById('name-form')
  const nameInput = document.getElementById('display-name')
  const nameCounter = document.getElementById('name-counter')
  const nameError = document.getElementById('name-error')
  const submitButton = document.getElementById('submit-score')
  const submissionErrorMessage = document.getElementById('submission-error-message')
  const submissionResultTitle = document.getElementById('submission-result-title')
  const submissionResultNote = document.getElementById('submission-result-note')
  const submittedName = document.getElementById('submitted-name')
  const submittedScore = document.getElementById('submitted-score')
  const submittedRank = document.getElementById('submitted-rank')
  const leaderboardLink = document.getElementById('view-leaderboard')
  const leaderboardEntries = document.getElementById('leaderboard-entries')
  const leaderboardErrorMessage = document.getElementById('leaderboard-error-message')
  const cells = []
  const stages = [
    'rank-loading',
    'rank-error',
    'rank-result',
    'name-entry',
    'submission-loading',
    'submission-error',
    'submission-result',
    'leaderboard-view'
  ]
  const restartButton = document.getElementById('arcade-replay')
  let state = GameEngine.createGame()
  let inputEnabled = false
  let touchStart = null
  let moveCount = 0
  let startedAt = now()
  let gameEnded = false
  let gameId = 0
  let submissionId = null
  let submissionInFlight = false
  let submissionConfirmed = false
  let submissionPayload = null
  let rankResult = null
  let finalRun = null
  let bestScore = 0
  let storageAvailable = true
  let idSequence = 0
  const leaderboardStates = [
    'leaderboard-loading',
    'leaderboard-error',
    'leaderboard-empty',
    'leaderboard-list'
  ]

  try {
    const storedScore = Number(globalThis.localStorage.getItem('2048-best-score'))
    if (Number.isSafeInteger(storedScore) && storedScore >= 0) {
      bestScore = storedScore
    }
  } catch {
    storageAvailable = false
  }

  for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
    const row = document.createElement('div')
    row.className = 'grid-row'
    row.setAttribute('role', 'row')

    for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
      const cell = document.createElement('div')
      cell.className = 'tile'
      cell.setAttribute('role', 'gridcell')
      row.appendChild(cell)
      cells.push(cell)
    }

    grid.appendChild(row)
  }

  function render() {
    scoreDisplay.textContent = String(state.score)
    bestScoreDisplay.textContent = String(bestScore)

    state.board.forEach((value, index) => {
      const cell = cells[index]
      cell.dataset.value = String(value)
      cell.textContent = value === 0 ? '' : String(value)
      cell.setAttribute('aria-label', value === 0 ? 'Empty' : `${value} tile`)
    })
  }

  function now() {
    return globalThis.performance?.now?.() ?? Date.now()
  }

  function setStage(stage) {
    for (const id of stages) {
      document.getElementById(id).hidden = id !== stage
    }
  }

  function setInputEnabled(enabled) {
    if (inputEnabled === enabled) {
      return
    }

    inputEnabled = enabled
    touchStart = null
    const method = enabled ? 'addEventListener' : 'removeEventListener'
    document[method]('keydown', handleKeyDown)
    grid[method]('touchstart', handleTouchStart)
    grid[method]('touchend', handleTouchEnd)
    grid[method]('touchcancel', clearTouchStart)
  }

  function updateBestScore() {
    if (state.score <= bestScore) {
      return
    }

    bestScore = state.score
    bestScoreDisplay.textContent = String(bestScore)
    try {
      globalThis.localStorage.setItem('2048-best-score', String(bestScore))
    } catch {
      if (storageAvailable) {
        statusDisplay.textContent = 'Local storage is unavailable. Your best score will last only for this visit.'
      }
      storageAvailable = false
    }
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
  }

  function currentRun() {
    const durationSeconds = Math.max(0, Math.floor((now() - startedAt) / 1000))
    return {
      score: state.score,
      highestTile: Math.max(...state.board),
      moves: moveCount,
      durationSeconds
    }
  }

  function makeSubmissionId() {
    idSequence += 1
    const uuid = globalThis.crypto?.randomUUID?.()
    return `2048-${uuid || `${Date.now()}-${idSequence}-${Math.random().toString(36).slice(2)}`}`
  }

  function showMockSource(source) {
    mockBadge.hidden = source !== 'development-mock'
  }

  function showGameOver() {
    if (gameEnded) {
      return
    }

    gameEnded = true
    setInputEnabled(false)
    gameInfo.inert = true
    grid.inert = true
    gameCredits.inert = true
    document.body.classList.add('game-over-open')
    statusDisplay.className = 'game-status visually-hidden'
    arcadeScreen.hidden = false
    arcadeScreen.focus()
    arcadeHeading.textContent = 'GAME OVER'
    rankInvitation.hidden = true
    notQualified.hidden = true
    declined.hidden = true
    mockBadge.hidden = true
    const run = currentRun()
    finalRun = run
    finalScoreDisplay.textContent = String(run.score)
    highestTileDisplay.textContent = String(run.highestTile)
    moveCountDisplay.textContent = String(run.moves)
    durationDisplay.textContent = formatDuration(run.durationSeconds)
    localBestDisplay.textContent = String(bestScore)
    statusDisplay.textContent = `Game over. Final score: ${run.score}. Highest tile: ${run.highestTile}.`
    submissionId = makeSubmissionId()
    rankResult = null
    requestRank(gameId, run)
  }

  async function requestRank(forGameId, run) {
    setStage('rank-loading')
    rankErrorTitle.textContent = 'RANK UNAVAILABLE'

    try {
      const result = await LeaderboardAPI.getProjectedRank({ score: run.score })
      if (forGameId !== gameId || !gameEnded) {
        return
      }

      rankResult = result
      showMockSource(result.source)
      rankValue.textContent = result.rank
        ? (result.rank <= 10 ? `TOP 10 — GLOBAL RANK #${result.rank}` : `GLOBAL RANK #${result.rank}`)
        : `OUTSIDE THE TOP ${result.leaderboardLimit}`
      rankDescription.textContent = result.qualifies
        ? 'This score qualifies for the public leaderboard.'
        : `This score is outside the configured top ${result.leaderboardLimit}.`
      rankInvitation.hidden = !result.qualifies
      notQualified.hidden = result.qualifies
      declined.hidden = true
      leaderboardLimit.textContent = String(result.leaderboardLimit)
      setStage('rank-result')
    } catch (error) {
      if (forGameId !== gameId || !gameEnded) {
        return
      }

      rankErrorTitle.textContent = error.code === 'UNAVAILABLE'
        ? 'LEADERBOARD OFFLINE'
        : error.code === 'TIMEOUT'
          ? 'RANK CHECK TIMED OUT'
          : 'RANK CHECK FAILED'
      rankErrorMessage.textContent = error.code === 'UNAVAILABLE'
        ? 'The leaderboard is offline or not configured. Your score has not been submitted.'
        : error.code === 'TIMEOUT'
          ? 'The leaderboard did not respond in time. Check your connection and try again.'
          : 'The leaderboard could not confirm a rank. Please try again.'
      setStage('rank-error')
    }
  }

  function handleMove(direction) {
    if (!inputEnabled) {
      return
    }

    const outcome = GameEngine.move(state, direction)
    if (!outcome.moved) {
      return
    }

    state = outcome.state
    moveCount += 1
    render()
    updateBestScore()

    if (state.status !== 'playing') {
      showGameOver()
      return
    }

    statusDisplay.textContent = outcome.scoreDelta > 0
      ? `Tiles merged. Score: ${state.score}.`
      : `Score: ${state.score}.`
  }

  function handleKeyDown(event) {
    const directions = {
      ArrowLeft: 'left',
      a: 'left',
      A: 'left',
      ArrowUp: 'up',
      w: 'up',
      W: 'up',
      ArrowRight: 'right',
      d: 'right',
      D: 'right',
      ArrowDown: 'down',
      s: 'down',
      S: 'down'
    }
    const direction = directions[event.key]

    if (direction) {
      event.preventDefault()
      handleMove(direction)
    }
  }

  function handleTouchStart(event) {
    if (event.touches.length !== 1) {
      touchStart = null
      return
    }

    const touch = event.touches[0]
    touchStart = { x: touch.clientX, y: touch.clientY }
  }

  function handleTouchEnd(event) {
    if (!touchStart || event.changedTouches.length !== 1) {
      touchStart = null
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - touchStart.x
    const deltaY = touch.clientY - touchStart.y
    touchStart = null

    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 30) {
      return
    }

    const direction = Math.abs(deltaX) > Math.abs(deltaY)
      ? (deltaX < 0 ? 'left' : 'right')
      : (deltaY < 0 ? 'up' : 'down')
    handleMove(direction)
  }

  function clearTouchStart() {
    touchStart = null
  }

  function showNameError(message) {
    nameError.textContent = message
    nameError.hidden = false
    nameInput.setAttribute('aria-invalid', 'true')
    nameInput.focus()
  }

  function clearNameError() {
    nameError.textContent = ''
    nameError.hidden = true
    nameInput.removeAttribute('aria-invalid')
  }

  function updateNameCounter() {
    nameCounter.textContent = `${nameInput.value.length} / 12`
  }

  function enterName() {
    clearNameError()
    nameInput.value = submissionPayload?.displayName || ''
    nameInput.readOnly = Boolean(submissionPayload)
    updateNameCounter()
    setStage('name-entry')
    nameInput.focus()
  }

  function cancelName() {
    clearNameError()
    setStage('rank-result')
    rankInvitation.hidden = false
    declined.hidden = true
  }

  function declineName() {
    rankInvitation.hidden = true
    notQualified.hidden = true
    declined.hidden = false
    setStage('rank-result')
  }

  async function submitName() {
    if (submissionInFlight || submissionConfirmed) {
      return
    }

    if (!rankResult?.qualifies) {
      return
    }

    if (!submissionPayload) {
      const displayName = nameInput.value.trim()
      if (!displayName) {
        showNameError('Enter a display name before submitting.')
        return
      }
      if (displayName.length > 12) {
        showNameError('Display names must be 12 characters or fewer.')
        return
      }
      if (!/^[A-Za-z0-9 _-]+$/.test(displayName)) {
        showNameError('Use letters, numbers, spaces, hyphens or underscores only.')
        return
      }

      submissionPayload = { submissionId, displayName, ...finalRun }
      nameInput.value = displayName
      nameInput.readOnly = true
    }

    clearNameError()
    submissionInFlight = true
    submitButton.disabled = true
    setStage('submission-loading')
    const submittingGameId = gameId

    try {
      const result = await LeaderboardAPI.submitScore(submissionPayload)
      if (submittingGameId !== gameId || !gameEnded) {
        return
      }

      submissionConfirmed = true
      showMockSource(result.source)
      submittedName.textContent = result.displayName
      submittedScore.textContent = String(result.score)
      submittedRank.textContent = `#${result.rank}`
      if (result.source === 'development-mock') {
        submissionResultTitle.textContent = 'DEVELOPMENT MOCK — SCORE NOT SUBMITTED'
        submissionResultNote.textContent = 'This simulated result uses no real leaderboard and did not publish your score.'
        leaderboardLink.hidden = true
      } else {
        submissionResultTitle.textContent = 'SCORE RECORDED'
        submissionResultNote.textContent = 'The backend confirmed your score and rank.'
        leaderboardLink.hidden = !LeaderboardAPI.getLeaderboardUrl()
      }
      setStage('submission-result')
    } catch (error) {
      if (submittingGameId !== gameId || !gameEnded) {
        return
      }

      submissionErrorMessage.textContent = error.code === 'UNAVAILABLE'
        ? 'The leaderboard is offline. The score may have been saved; retry safely with the same game-run key.'
        : error.code === 'TIMEOUT'
          ? 'No confirmation arrived in time. The score may have been saved; retry safely with the same game-run key.'
          : `The backend did not confirm this score. ${error.message || 'Check the request and retry.'}`
      setStage('submission-error')
    } finally {
      if (submittingGameId === gameId) {
        submissionInFlight = false
        submitButton.disabled = false
      }
    }
  }

  function restartGame() {
    gameId += 1
    state = GameEngine.createGame()
    moveCount = 0
    startedAt = now()
    gameEnded = false
    submissionId = null
    submissionInFlight = false
    submissionConfirmed = false
    submissionPayload = null
    submitButton.disabled = false
    rankResult = null
    finalRun = null
    nameInput.value = ''
    nameInput.readOnly = false
    clearNameError()
    arcadeScreen.hidden = true
    gameInfo.inert = false
    grid.inert = false
    gameCredits.inert = false
    document.body.classList.remove('game-over-open')
    statusDisplay.className = 'game-status'
    leaderboardLink.hidden = true
    showMockSource('')
    render()
    statusDisplay.textContent = storageAvailable
      ? 'New game started. Score: 0.'
      : 'New game started. Local storage is unavailable; your best score will last only for this visit.'
    setInputEnabled(true)
    grid.focus()
  }

  function setLeaderboardState(stateId) {
    for (const id of leaderboardStates) {
      document.getElementById(id).hidden = id !== stateId
    }
  }

  function renderLeaderboard(entries) {
    leaderboardEntries.replaceChildren()
    const numberFormat = new Intl.NumberFormat()

    for (const entry of entries) {
      const row = document.createElement('tr')
      const values = [
        `#${entry.rank}`,
        entry.displayName,
        numberFormat.format(entry.score),
        numberFormat.format(entry.highestTile)
      ]
      for (const value of values) {
        const cell = document.createElement('td')
        cell.textContent = value
        row.appendChild(cell)
      }
      leaderboardEntries.appendChild(row)
    }
  }

  async function loadLeaderboard() {
    const requestedGameId = gameId
    setStage('leaderboard-view')
    setLeaderboardState('leaderboard-loading')

    try {
      const result = await LeaderboardAPI.getLeaderboard()
      if (requestedGameId !== gameId || !gameEnded) {
        return
      }

      renderLeaderboard(result.entries)
      setLeaderboardState(result.entries.length ? 'leaderboard-list' : 'leaderboard-empty')
    } catch (error) {
      if (requestedGameId !== gameId || !gameEnded) {
        return
      }

      leaderboardErrorMessage.textContent = error.message ||
        'The leaderboard could not be loaded. Check your connection and try again.'
      setLeaderboardState('leaderboard-error')
    }
  }

  document.getElementById('retry-rank').addEventListener('click', () => {
    if (gameEnded) {
      requestRank(gameId, finalRun)
    }
  })
  document.getElementById('enter-name').addEventListener('click', enterName)
  document.getElementById('decline-name').addEventListener('click', declineName)
  document.getElementById('cancel-name').addEventListener('click', cancelName)
  leaderboardLink.addEventListener('click', loadLeaderboard)
  document.getElementById('retry-leaderboard').addEventListener('click', loadLeaderboard)
  document.getElementById('back-to-result').addEventListener('click', () => {
    setStage('submission-result')
  })
  nameInput.addEventListener('input', () => {
    clearNameError()
    updateNameCounter()
  })
  nameForm.addEventListener('submit', event => {
    event.preventDefault()
    submitName()
  })
  document.getElementById('retry-submission').addEventListener('click', submitName)
  document.getElementById('cancel-submission').addEventListener('click', () => {
    nameInput.value = submissionPayload?.displayName || ''
    nameInput.readOnly = Boolean(submissionPayload)
    updateNameCounter()
    setStage('name-entry')
  })
  restartButton.addEventListener('click', restartGame)

  render()
  bestScoreDisplay.textContent = String(bestScore)
  statusDisplay.textContent = storageAvailable
    ? 'Use the arrow keys or WASD to move tiles. Swipe on the board to play.'
    : 'Local storage is unavailable; your best score will last only for this visit. Use the arrow keys or WASD to play.'
  setInputEnabled(true)
})
