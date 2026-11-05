import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url))
const migrations = [
  { version: 1, file: '001_initial.sql' }
]

export function createDatabase(databasePath, { production = false, busyTimeout = 5000 } = {}) {
  if (!databasePath) {
    throw new Error('DATABASE_PATH must be configured.')
  }

  const resolvedPath = path.resolve(databasePath)
  const directory = path.dirname(resolvedPath)
  if (production) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error('Production database directory is unavailable; verify the persistent volume mount.')
    }
  } else {
    fs.mkdirSync(directory, { recursive: true })
  }

  const db = new Database(resolvedPath)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma(`busy_timeout = ${busyTimeout}`)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `)

    const applied = new Set(
      db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version)
    )
    const recordMigration = db.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    )

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue
      }

      const sql = fs.readFileSync(path.join(migrationsDirectory, migration.file), 'utf8')
      db.transaction(() => {
        db.exec(sql)
        recordMigration.run(migration.version, new Date().toISOString())
      }).immediate()
    }

    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function checkDatabase(db) {
  return db.prepare('SELECT 1 AS healthy').get().healthy === 1
}
