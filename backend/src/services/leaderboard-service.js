import { HttpError } from '../utils/http-error.js'

export const LEADERBOARD_LIMIT = 100

function samePayload(existing, payload) {
  return existing.displayName === payload.displayName &&
    existing.score === payload.score &&
    existing.highestTile === payload.highestTile &&
    existing.moves === payload.moves &&
    existing.durationSeconds === payload.durationSeconds
}

export function createLeaderboardService(db) {
  const findExisting = db.prepare(`
    SELECT display_name AS displayName,
           score,
           highest_tile AS highestTile,
           moves,
           duration_seconds AS durationSeconds,
           submission_rank AS rank
    FROM scores
    WHERE idempotency_key = ?
  `)
  const insertScore = db.prepare(`
    INSERT INTO scores (
      display_name, score, highest_tile, moves, duration_seconds,
      submitted_at, idempotency_key, submission_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `)
  const countHigherScores = db.prepare('SELECT COUNT(*) AS count FROM scores WHERE score > ?')
  const updateRank = db.prepare('UPDATE scores SET submission_rank = ? WHERE id = ?')
  const findId = db.prepare('SELECT id FROM scores WHERE idempotency_key = ?')
  const getProjectedRank = db.prepare('SELECT COUNT(*) AS count FROM scores WHERE score > ?')
  const listEntries = db.prepare(`
    SELECT RANK() OVER (ORDER BY score DESC) AS rank,
           display_name AS displayName,
           score,
           highest_tile AS highestTile,
           submitted_at AS submittedAt
    FROM scores
    ORDER BY score DESC, submitted_at ASC, id ASC
    LIMIT ?
  `)

  const submitTransaction = db.transaction((payload, idempotencyKey) => {
    const existing = findExisting.get(idempotencyKey)
    if (existing) {
      if (!samePayload(existing, payload)) {
        throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different payload.')
      }
      return {
        statusCode: 200,
        result: {
          displayName: existing.displayName,
          score: existing.score,
          rank: existing.rank
        }
      }
    }

    insertScore.run(
      payload.displayName,
      payload.score,
      payload.highestTile,
      payload.moves,
      payload.durationSeconds,
      new Date().toISOString(),
      idempotencyKey
    )
    const id = findId.get(idempotencyKey).id
    const rank = countHigherScores.get(payload.score).count + 1
    updateRank.run(rank, id)

    return {
      statusCode: 201,
      result: { displayName: payload.displayName, score: payload.score, rank }
    }
  }).immediate

  return {
    getProjectedRank(score) {
      const rank = getProjectedRank.get(score).count + 1
      return {
        rank: rank <= LEADERBOARD_LIMIT ? rank : null,
        qualifies: rank <= LEADERBOARD_LIMIT,
        leaderboardLimit: LEADERBOARD_LIMIT
      }
    },

    submitScore(payload, idempotencyKey) {
      return submitTransaction(payload, idempotencyKey)
    },

    getLeaderboard() {
      return {
        entries: listEntries.all(LEADERBOARD_LIMIT),
        limit: LEADERBOARD_LIMIT
      }
    }
  }
}
