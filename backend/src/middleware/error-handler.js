import { HttpError } from '../utils/http-error.js'

export function notFoundHandler(req, res, next) {
  next(new HttpError(404, 'NOT_FOUND', 'The requested endpoint was not found.'))
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error)
  }

  if (error?.type === 'entity.parse.failed') {
    error = new HttpError(400, 'MALFORMED_JSON', 'Request body must contain valid JSON.')
  } else if (error?.type === 'entity.too.large') {
    error = new HttpError(413, 'REQUEST_TOO_LARGE', 'Request body exceeds the 8 KB limit.')
  } else if (error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED') {
    error = new HttpError(503, 'DATABASE_BUSY', 'The database is temporarily busy. Please retry.')
  } else if (error?.code?.startsWith('SQLITE_CONSTRAINT')) {
    error = new HttpError(409, 'DATABASE_CONFLICT', 'The request conflicts with an existing score.')
  }

  const status = Number.isInteger(error?.status) ? error.status : 500
  const code = error?.code || 'INTERNAL_ERROR'
  const message = status === 500
    ? 'An unexpected server error occurred.'
    : error.message

  if (status === 500) {
    console.error('Unhandled API error:', error)
  }

  const body = { error: { code, message } }
  if (Array.isArray(error?.details) && error.details.length) {
    body.error.details = error.details
  }
  return res.status(status).json(body)
}
