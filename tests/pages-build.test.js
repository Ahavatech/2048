const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const script = path.join(root, 'scripts', 'prepare-pages.mjs')

test('Pages staging publishes only frontend files and injects the configured API origin', t => {
  const directory = fs.mkdtempSync(path.join(root, '.pages-build-test-'))
  const output = path.join(directory, 'artifact')
  const relativeOutput = path.relative(root, output)
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const result = spawnSync(process.execPath, [script, relativeOutput], {
    cwd: root,
    env: { ...process.env, ARCADE_API_BASE_URL: 'https://api.example.test' },
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fs.readdirSync(output).sort(), [
    'functions.js',
    'game-engine.js',
    'index.html',
    'leaderboard-api.js',
    'styles.css'
  ])
  assert.match(
    fs.readFileSync(path.join(output, 'index.html'), 'utf8'),
    /<meta name="arcade-api-base" content="https:\/\/api\.example\.test">/
  )
})

test('Pages staging rejects missing or non-origin API configuration', t => {
  const directory = fs.mkdtempSync(path.join(root, '.pages-build-invalid-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  for (const [index, apiOrigin] of [
    [0, undefined],
    [1, 'http://api.example.test'],
    [2, 'https://api.example.test/path']
  ]) {
    const output = path.join(directory, `artifact-${index}`)
    const relativeOutput = path.relative(root, output)
    const env = { ...process.env }
    delete env.ARCADE_API_BASE_URL
    if (apiOrigin) {
      env.ARCADE_API_BASE_URL = apiOrigin
    }

    const result = spawnSync(process.execPath, [script, relativeOutput], {
      cwd: root,
      env,
      encoding: 'utf8'
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ARCADE_API_BASE_URL/)
    assert.equal(fs.existsSync(output), false)
  }
})
