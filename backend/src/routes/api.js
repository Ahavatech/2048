import { Router } from 'express'
import { createLeaderboardController } from '../controllers/leaderboard-controller.js'
import { HttpError } from '../utils/http-error.js'
import { checkDatabase } from '../db/database.js'

export function createApiRouter({ db, service }) {
  const router = Router()
  const controller = createLeaderboardController(service)

  router.get('/health', (req, res, next) => {
    try {
      if (!checkDatabase(db)) {
        throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database health check failed.')
      }
      return res.json({ status: 'ok', database: 'ok' })
    } catch (error) {
      if (error instanceof HttpError) {
        return next(error)
      }
      return next(new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database health check failed.'))
    }
  })

  router.get('/leaderboard/rank', controller.getProjectedRank)
  router.post('/scores', controller.submitScore)
  router.get('/leaderboard', controller.getLeaderboard)

  return router
}
