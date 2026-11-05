import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import test from 'node:test'
import path from 'node:path'
import { loadConfig } from '../src/config/env.js'
import { createDatabase } from '../src/db/database.js'

test('production requires an explicit absolute database path', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    /DATABASE_PATH is required in production/
  )
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DATABASE_PATH: './data/2048.db' }),
    /DATABASE_PATH must be absolute in production/
  )

  const config = loadConfig({
    NODE_ENV: 'production',
    DATABASE_PATH: '/data/2048.db',
    PORT: '8080',
    CORS_ORIGINS: 'https://game.example.test',
    TRUST_PROXY_HOPS: '1'
  })
  assert.equal(config.databasePath, path.resolve('/data/2048.db'))
  assert.deepEqual(config.corsOrigins, ['https://game.example.test'])
  assert.equal(config.trustProxyHops, 1)
})

test('invalid configuration fails explicitly', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT must be a positive integer/)
  assert.throws(() => loadConfig({ RATE_LIMIT_MAX: '0' }), /RATE_LIMIT_MAX must be between/)
  assert.throws(() => loadConfig({ CORS_ORIGINS: '*' }), /invalid origin|exact HTTP\(S\) origins/)
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), /NODE_ENV must be/)
})

test('production database initialization never creates a missing volume directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2048-volume-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const missingVolume = path.join(root, 'volume', '2048.db')

  assert.throws(
    () => createDatabase(missingVolume, { production: true }),
    /Production database directory is unavailable/
  )
  assert.equal(fs.existsSync(path.dirname(missingVolume)), false)
})
