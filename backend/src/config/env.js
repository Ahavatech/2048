import path from 'node:path'

function positiveInteger(value, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === '') {
    return fallback
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`)
  }
  return parsed
}

function nonNegativeInteger(value, name, fallback) {
  if (value === undefined || value === '') {
    return fallback
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer.`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a non-negative safe integer.`)
  }
  return parsed
}

function parseCorsOrigins(value = '') {
  return value.split(',').map(origin => origin.trim()).filter(Boolean).map(origin => {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`)
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`CORS_ORIGINS entries must be exact HTTP(S) origins: ${origin}`)
    }
    return parsed.origin
  })
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development'
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.')
  }

  const port = positiveInteger(env.PORT, 'PORT', 8080, 65535)
  const databasePath = env.DATABASE_PATH?.trim()
  if (nodeEnv === 'production' && !databasePath) {
    throw new Error('DATABASE_PATH is required in production; configure the mounted persistent volume.')
  }
  if (nodeEnv === 'production' && !path.isAbsolute(databasePath)) {
    throw new Error('DATABASE_PATH must be absolute in production and point to persistent storage.')
  }

  return {
    nodeEnv,
    port,
    host: '0.0.0.0',
    databasePath: databasePath
      ? path.resolve(databasePath)
      : path.resolve(process.cwd(), 'data', '2048.db'),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    rateLimitWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 100),
    trustProxyHops: nonNegativeInteger(env.TRUST_PROXY_HOPS, 'TRUST_PROXY_HOPS', 0)
  }
}
