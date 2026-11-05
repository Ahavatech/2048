import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { createDatabase } from '../src/db/database.js'
import { restoreDatabase } from '../src/db/restore.js'

test('restores a valid backup to a new database and preserves its data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '2048-restore-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const sourcePath = path.join(directory, 'source.db')
  const backupPath = path.join(directory, 'backup.db')
  const restoredPath = path.join(directory, 'restored.db')
  const db = createDatabase(sourcePath)
  db.prepare(`
    INSERT INTO scores (
      display_name, score, highest_tile, moves, duration_seconds,
      submitted_at, idempotency_key, submission_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('ARCADE ACE', 2400, 2048, 38, 94, new Date().toISOString(), 'restore-test', 1)
  await db.backup(backupPath)
  db.close()

  assert.equal(await restoreDatabase(backupPath, restoredPath), restoredPath)
  const restoredDb = new Database(restoredPath, { readonly: true })
  try {
    assert.deepEqual(
      restoredDb.prepare('SELECT display_name, score FROM scores').get(),
      { display_name: 'ARCADE ACE', score: 2400 }
    )
  } finally {
    restoredDb.close()
  }
})

test('refuses to overwrite a database during restore', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '2048-restore-existing-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const sourcePath = path.join(directory, 'source.db')
  const destinationPath = path.join(directory, 'existing.db')
  const sourceDb = createDatabase(sourcePath)
  sourceDb.close()
  const destinationDb = createDatabase(destinationPath)
  destinationDb.close()

  await assert.rejects(
    restoreDatabase(sourcePath, destinationPath),
    /destination already exists/
  )
})
