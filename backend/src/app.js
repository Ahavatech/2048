import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { loadConfig } from './config/env.js'
import { createDatabase } from './db/database.js'
import { createApiRouter } from './routes/api.js'
import { createLeaderboardService } from './services/leaderboard-service.js'
import { createCorsMiddleware } from './middleware/cors.js'
import { createRateLimitMiddleware } from './middleware/rate-limit.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { HttpError } from './utils/http-error.js'
import { openApiSpec } from './openapi.js'

export function createApp({ config = loadConfig(), database } = {}) {
  const db = database ?? createDatabase(config.databasePath, { production: config.nodeEnv === 'production' })
  const service = createLeaderboardService(db)
  const app = express()

  app.disable('x-powered-by')
  if (config.trustProxyHops > 0) {
    app.set('trust proxy', config.trustProxyHops)
  }

  app.use(createCorsMiddleware(config.corsOrigins))
  app.use(createRateLimitMiddleware({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax
  }))
  app.use(express.json({ limit: '8kb', strict: true }))

  app.get('/openapi.json', (req, res) => res.json(openApiSpec))
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    explorer: false,
    swaggerOptions: { displayRequestDuration: true }
  }))
  app.use('/api/v1', createApiRouter({ db, service }))
  app.use(notFoundHandler)
  app.use(errorHandler)

  app.locals.database = db
  app.locals.close = () => {
    if (db.open) {
      db.close()
    }
  }

  return app
}

export { HttpError }
