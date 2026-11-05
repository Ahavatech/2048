import { HttpError } from '../utils/http-error.js'

export function createRateLimitMiddleware({ windowMs, max }) {
  const clients = new Map()

  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip
    let client = clients.get(key)
    if (!client || now >= client.resetAt) {
      client = { count: 0, resetAt: now + windowMs }
      clients.set(key, client)
    }
    client.count += 1

    if (clients.size > 10_000) {
      for (const [clientKey, entry] of clients) {
        if (now >= entry.resetAt) {
          clients.delete(clientKey)
        }
      }
    }

    res.set('RateLimit-Limit', String(max))
    res.set('RateLimit-Remaining', String(Math.max(0, max - client.count)))
    res.set('RateLimit-Reset', String(Math.ceil(client.resetAt / 1000)))

    if (client.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((client.resetAt - now) / 1000))))
      return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please retry after the rate limit window.'))
    }
    return next()
  }
}
