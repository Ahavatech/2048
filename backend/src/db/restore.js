import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

function assertIntegrity(db, label) {
  const results = db.pragma('integrity_check')
  if (results.length !== 1 || results[0].integrity_check !== 'ok') {
    throw new Error(`${label} failed SQLite integrity_check.`)
  }
}

export async function restoreDatabase(source, destination) {
  if (!source || !destination) {
    throw new Error('Provide a source backup and a new destination path.')
  }

  const sourcePath = path.resolve(source)
  const destinationPath = path.resolve(destination)
  if (sourcePath === destinationPath) {
    throw new Error('Restore destination must differ from the source backup.')
  }
  if (!fs.existsSync(path.dirname(destinationPath))) {
    throw new Error('Restore destination directory must already exist.')
  }
  if (fs.existsSync(destinationPath)) {
    throw new Error('Restore destination already exists; choose a new database path.')
  }

  const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    assertIntegrity(sourceDb, 'Source backup')
    await sourceDb.backup(destinationPath)
  } finally {
    sourceDb.close()
  }

  const restoredDb = new Database(destinationPath, { readonly: true, fileMustExist: true })
  try {
    assertIntegrity(restoredDb, 'Restored database')
  } finally {
    restoredDb.close()
  }

  return destinationPath
}

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  const [source, destination] = process.argv.slice(2)
  if (!source || !destination) {
    throw new Error('Usage: node src/db/restore.js <source-backup> <new-database-path>')
  }
  const restoredPath = await restoreDatabase(source, destination)
  console.log(`SQLite backup restored to ${restoredPath}`)
}
