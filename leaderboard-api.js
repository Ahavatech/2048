(function (root, factory) {
  const api = factory(root)

  if (typeof module === 'object' && module.exports) {
    module.exports = api
  } else {
    root.LeaderboardAPI = api.createLeaderboardApi()
  }
})(globalThis, function (root) {
  class LeaderboardApiError extends Error {
    constructor(message, code, status = null) {
      super(message)
      this.name = 'LeaderboardApiError'
      this.code = code
      this.status = status
    }
  }

  function isLocalDevelopment(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1'
  }

  function readApiBaseUrl() {
    const config = root.document?.querySelector('meta[name="arcade-api-base"]')
    return config?.content.trim().replace(/\/+$/, '') || ''
  }

  function isInteger(value, minimum = 0) {
    return Number.isSafeInteger(value) && value >= minimum
  }

  function createLeaderboardApi(options = {}) {
    const baseUrl = options.baseUrl ?? readApiBaseUrl()
    const fetcher = options.fetch ?? root.fetch
    const hostname = options.hostname ?? root.location?.hostname ?? ''
    const search = options.search ?? root.location?.search ?? ''
    const timeoutMs = options.timeoutMs ?? 10_000
    const mockEnabled = isLocalDevelopment(hostname) &&
      new URLSearchParams(search).get('leaderboard') === 'mock'

    async function request(path, init) {
      if (!baseUrl || typeof fetcher !== 'function') {
        throw new LeaderboardApiError('Leaderboard service is not configured.', 'UNAVAILABLE')
      }

      const controller = typeof root.AbortController === 'function'
        ? new root.AbortController()
        : null
      let timeoutId
      const timeout = new Promise((resolve, reject) => {
        timeoutId = root.setTimeout(() => {
          controller?.abort()
          reject(new LeaderboardApiError('Leaderboard request timed out.', 'TIMEOUT'))
        }, timeoutMs)
      })

      const requestOperation = (async () => {
        let response
        try {
          response = await fetcher(`${baseUrl}${path}`, {
            ...init,
            credentials: 'omit',
            ...(controller ? { signal: controller.signal } : {})
          })
        } catch (error) {
          if (error?.name === 'AbortError') {
            throw new LeaderboardApiError('Leaderboard request timed out.', 'TIMEOUT')
          }
          throw new LeaderboardApiError('Leaderboard service could not be reached.', 'UNAVAILABLE')
        }

        let body
        try {
          body = await response.json()
        } catch {
          if (response.ok) {
            throw new LeaderboardApiError('Leaderboard service returned an invalid response.', 'INVALID_RESPONSE', response.status)
          }
        }

        if (!response.ok) {
          const status = response.status
          const unavailable = status === 502 || status === 503 || status === 504
          throw new LeaderboardApiError(
            body?.error?.message || (unavailable
              ? 'Leaderboard service is temporarily unavailable.'
              : 'Leaderboard service rejected the request.'),
            unavailable ? 'UNAVAILABLE' : (body?.error?.code || 'REQUEST_FAILED'),
            status
          )
        }
        return body
      })()

      try {
        return await Promise.race([requestOperation, timeout])
      } catch (error) {
        if (error instanceof LeaderboardApiError) {
          throw error
        }
        if (error?.name === 'AbortError') {
          throw new LeaderboardApiError('Leaderboard request timed out.', 'TIMEOUT')
        }
        throw new LeaderboardApiError('Leaderboard service could not be reached.', 'UNAVAILABLE')
      } finally {
        root.clearTimeout(timeoutId)
      }
    }

    async function withDevelopmentFallback(operation, mockResponse) {
      if (mockEnabled && !baseUrl) {
        return mockResponse()
      }

      try {
        return await operation()
      } catch (error) {
        if (mockEnabled && (error.code === 'UNAVAILABLE' || error.code === 'TIMEOUT')) {
          return mockResponse()
        }
        throw error
      }
    }

    function mockRank(score) {
      const qualifies = score >= 1000
      return {
        rank: qualifies ? 7 : null,
        qualifies,
        leaderboardLimit: 100,
        source: 'development-mock'
      }
    }

    function validateLeaderboard(result) {
      if (
        !result ||
        !Array.isArray(result.entries) ||
        !isInteger(result.limit, 1) ||
        result.entries.length > result.limit
      ) {
        throw new LeaderboardApiError('Leaderboard service returned an invalid leaderboard.', 'INVALID_RESPONSE')
      }

      for (const entry of result.entries) {
        if (
          !entry ||
          !isInteger(entry.rank, 1) ||
          typeof entry.displayName !== 'string' ||
          !isInteger(entry.score) ||
          !isInteger(entry.highestTile, 2) ||
          typeof entry.submittedAt !== 'string' ||
          Number.isNaN(Date.parse(entry.submittedAt))
        ) {
          throw new LeaderboardApiError('Leaderboard service returned an invalid leaderboard entry.', 'INVALID_RESPONSE')
        }
      }
      return { ...result, source: 'backend' }
    }

    return {
      getProjectedRank({ score }) {
        const query = new URLSearchParams({ score: String(score) })
        return withDevelopmentFallback(
          async () => {
            const result = await request(`/api/v1/leaderboard/rank?${query}`)
            if (
              !result ||
              typeof result.qualifies !== 'boolean' ||
              !isInteger(result.leaderboardLimit, 1) ||
              (result.qualifies
                ? (!isInteger(result.rank, 1) || result.rank > result.leaderboardLimit)
                : result.rank !== null)
            ) {
              throw new LeaderboardApiError('Leaderboard service returned an invalid rank.', 'INVALID_RESPONSE')
            }
            return { ...result, source: 'backend' }
          },
          () => mockRank(score)
        )
      },

      submitScore({ submissionId, displayName, score, highestTile, moves, durationSeconds }) {
        const payload = { displayName, score, highestTile, moves, durationSeconds }
        return withDevelopmentFallback(
          async () => {
            const result = await request('/api/v1/scores', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': submissionId
              },
              body: JSON.stringify(payload)
            })
            if (
              !result ||
              result.displayName !== displayName ||
              result.score !== score ||
              !isInteger(result.rank, 1)
            ) {
              throw new LeaderboardApiError('Leaderboard service returned an invalid submission result.', 'INVALID_RESPONSE')
            }
            return { ...result, source: 'backend' }
          },
          () => ({
            displayName,
            score,
            rank: mockRank(score).rank,
            source: 'development-mock'
          })
        )
      },

      getLeaderboard() {
        return request('/api/v1/leaderboard').then(validateLeaderboard)
      },

      getLeaderboardUrl() {
        return baseUrl ? `${baseUrl}/api/v1/leaderboard` : ''
      }
    }
  }

  return { createLeaderboardApi, LeaderboardApiError }
})
