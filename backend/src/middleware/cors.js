import { HttpError } from '../utils/http-error.js'

export function createCorsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins)

  return (req, res, next) => {
    const origin = req.get('Origin')
    res.vary('Origin')

    if (origin && !allowed.has(origin)) {
      return next(new HttpError(403, 'CORS_ORIGIN_DENIED', 'This origin is not allowed.'))
    }

    if (origin) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key')
      res.set('Access-Control-Max-Age', '600')
    }

    if (req.method === 'OPTIONS') {
      if (!origin) {
        return next(new HttpError(400, 'CORS_ORIGIN_REQUIRED', 'An Origin header is required for preflight requests.'))
      }
      return res.status(204).end()
    }

    return next()
  }
}
