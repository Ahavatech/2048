const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'string' } }
      }
    }
  }
}

const errorResponse = description => ({
  description,
  content: { 'application/json': { schema: errorSchema } }
})

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: '2048 Arcade Leaderboard API',
    version: '1.0.0',
    description: [
      'Guest-based 2048 score and public leaderboard API.',
      'Scores and game statistics are supplied by an untrusted browser; validation is not anti-cheat.',
      'CORS permits only exact configured origins, and public requests are rate limited.'
    ].join(' ')
  },
  servers: [{ url: '/', description: 'Current API host' }],
  tags: [
    { name: 'Leaderboard', description: 'Projected ranks and public scores' },
    { name: 'Scores', description: 'Opt-in arcade score submissions' },
    { name: 'Operations', description: 'Service health' }
  ],
  paths: {
    '/api/v1/leaderboard/rank': {
      get: {
        tags: ['Leaderboard'],
        operationId: 'getProjectedRank',
        summary: 'Calculate a score’s projected competition rank',
        description: 'Rank is 1 plus the number of persisted scores strictly greater than the candidate. Equal scores share a rank. Rank 100 qualifies, including ties at the cutoff. This operation does not insert a score.',
        parameters: [{
          in: 'query',
          name: 'score',
          required: true,
          description: 'Non-negative safe integer game score.',
          schema: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          example: 2400
        }],
        responses: {
          200: {
            description: 'Projected rank. Non-qualifying scores use rank null.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['rank', 'qualifies', 'leaderboardLimit'],
                  properties: {
                    rank: { type: 'integer', minimum: 1, nullable: true },
                    qualifies: { type: 'boolean' },
                    leaderboardLimit: { type: 'integer', enum: [100] }
                  }
                },
                examples: {
                  qualifying: { value: { rank: 7, qualifies: true, leaderboardLimit: 100 } },
                  outside: { value: { rank: null, qualifies: false, leaderboardLimit: 100 } }
                }
              }
            }
          },
          400: errorResponse('Invalid score parameter.'),
          403: errorResponse('Origin is not allowed.'),
          429: errorResponse('Rate limit exceeded.'),
          503: errorResponse('Database is temporarily busy.'),
          500: errorResponse('Unexpected server error.')
        }
      }
    },
    '/api/v1/scores': {
      post: {
        tags: ['Scores'],
        operationId: 'submitScore',
        summary: 'Submit an opted-in arcade score',
        description: 'A new successful submission returns 201 after transaction commit. A repeated identical idempotency key and payload returns the original response with 200. Reusing the key with a different payload returns 409. Names are NFC-normalized and trimmed, then restricted to 1–12 ASCII letters, numbers, spaces, hyphens, or underscores.',
        parameters: [{
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          description: 'Stable per-run request key. 1–128 characters: letters, numbers, dots, underscores, colons, or hyphens.',
          schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
          example: '2048-1730800000000-1'
        }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['displayName', 'score', 'highestTile', 'moves', 'durationSeconds'],
                properties: {
                  displayName: { type: 'string', minLength: 1, maxLength: 12, pattern: '^[A-Za-z0-9 _-]+$' },
                  score: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
                  highestTile: { type: 'integer', minimum: 2, maximum: Number.MAX_SAFE_INTEGER, description: 'A power of two.' },
                  moves: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
                  durationSeconds: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
                }
              },
              example: {
                displayName: 'ARCADE ACE',
                score: 2400,
                highestTile: 2048,
                moves: 38,
                durationSeconds: 94
              }
            }
          }
        },
        responses: {
          201: {
            description: 'New score persisted and ranked.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['displayName', 'score', 'rank'],
                  properties: {
                    displayName: { type: 'string' },
                    score: { type: 'integer' },
                    rank: { type: 'integer', minimum: 1 }
                  }
                },
                example: { displayName: 'ARCADE ACE', score: 2400, rank: 3 }
              }
            }
          },
          200: {
            description: 'Original result returned for an identical idempotent retry.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['displayName', 'score', 'rank'],
                  properties: {
                    displayName: { type: 'string' },
                    score: { type: 'integer' },
                    rank: { type: 'integer', minimum: 1 }
                  }
                }
              }
            }
          },
          400: errorResponse('Invalid JSON, field, or idempotency key.'),
          403: errorResponse('Origin is not allowed.'),
          409: errorResponse('Idempotency key reused with a different payload.'),
          413: errorResponse('Request body exceeds 8 KB.'),
          415: errorResponse('Content-Type must be application/json.'),
          429: errorResponse('Rate limit exceeded.'),
          503: errorResponse('Database is temporarily busy or unavailable.'),
          500: errorResponse('Unexpected server error.')
        }
      }
    },
    '/api/v1/leaderboard': {
      get: {
        tags: ['Leaderboard'],
        operationId: 'getLeaderboard',
        summary: 'Get the top 100 public scores',
        description: 'Entries are ordered by score descending, with UTC submission time and database insertion order as display tie-breakers. The rank field uses competition ranking, so equal scores share rank. At most 100 entries are returned.',
        responses: {
          200: {
            description: 'Public leaderboard entries; no database IDs or idempotency keys are exposed.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entries', 'limit'],
                  properties: {
                    entries: {
                      type: 'array',
                      maxItems: 100,
                      items: {
                        type: 'object',
                        required: ['rank', 'displayName', 'score', 'highestTile', 'submittedAt'],
                        properties: {
                          rank: { type: 'integer', minimum: 1 },
                          displayName: { type: 'string' },
                          score: { type: 'integer' },
                          highestTile: { type: 'integer' },
                          submittedAt: { type: 'string', format: 'date-time' }
                        }
                      }
                    },
                    limit: { type: 'integer', enum: [100] }
                  }
                },
                example: {
                  entries: [{
                    rank: 1,
                    displayName: 'ARCADE ACE',
                    score: 2400,
                    highestTile: 2048,
                    submittedAt: '2026-11-05T10:00:00.000Z'
                  }],
                  limit: 100
                }
              }
            }
          },
          403: errorResponse('Origin is not allowed.'),
          429: errorResponse('Rate limit exceeded.'),
          503: errorResponse('Database is temporarily busy.'),
          500: errorResponse('Unexpected server error.')
        }
      }
    },
    '/api/v1/health': {
      get: {
        tags: ['Operations'],
        operationId: 'getHealth',
        summary: 'Check API and database availability',
        responses: {
          200: {
            description: 'API and database are healthy.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'database'],
                  properties: {
                    status: { type: 'string', enum: ['ok'] },
                    database: { type: 'string', enum: ['ok'] }
                  }
                },
                example: { status: 'ok', database: 'ok' }
              }
            }
          },
          403: errorResponse('Origin is not allowed.'),
          429: errorResponse('Rate limit exceeded.'),
          503: errorResponse('Database is unavailable.')
        }
      }
    }
  }
}
