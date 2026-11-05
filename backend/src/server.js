import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadConfig } from './config/env.js'

let server
let app

try {
  const config = loadConfig()
  app = createApp({ config })
  server = createServer(app)

  server.listen(config.port, config.host, () => {
    console.log(`2048 Arcade API listening on ${config.host}:${config.port}`)
  })
} catch (error) {
  console.error(`API startup failed: ${error.message}`)
  process.exitCode = 1
}

function shutdown(signal) {
  console.log(`${signal} received; shutting down.`)
  if (!server?.listening) {
    app?.locals.close()
    return
  }

  server.close(error => {
    app.locals.close()
    if (error) {
      console.error('HTTP server shutdown failed:', error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
