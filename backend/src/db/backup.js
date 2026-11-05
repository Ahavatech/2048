import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { loadConfig } from '../config/env.js'

const config = loadConfig()
const destination = process.argv[2]
if (!destination) {
  throw new Error('Provide a destination path for the SQLite online backup.')
}

const sourcePath = config.databasePath
const destinationPath = path.resolve(destination)
if (sourcePath === destinationPath) {
  throw new Error('Backup destination must differ from DATABASE_PATH.')
}

fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
const db = new Database(sourcePath, { readonly: true, fileMustExist: true })
try {
  db.pragma('busy_timeout = 5000')
  await db.backup(destinationPath)
  console.log(`SQLite backup created at ${destinationPath}`)
} finally {
  db.close()
}
