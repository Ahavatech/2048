import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.resolve(root, process.argv[2] || 'pages-artifact')
const outputRelativePath = path.relative(root, outputDirectory)
const frontendFiles = [
  'index.html',
  'styles.css',
  'game-engine.js',
  'leaderboard-api.js',
  'functions.js'
]

function configuredApiOrigin(value) {
  if (!value) {
    throw new Error('Set the ARCADE_API_BASE_URL repository variable to the HTTPS API origin.')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('ARCADE_API_BASE_URL must be a valid HTTPS origin without a path.')
  }

  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error('ARCADE_API_BASE_URL must be an HTTPS origin without a path or trailing slash.')
  }

  return value
}

if (!outputRelativePath || outputRelativePath.startsWith('..') || path.isAbsolute(outputRelativePath)) {
  throw new Error('The Pages output directory must be inside the repository.')
}

const apiOrigin = configuredApiOrigin(process.env.ARCADE_API_BASE_URL)
fs.mkdirSync(outputDirectory, { recursive: true })

if (fs.readdirSync(outputDirectory).length > 0) {
  throw new Error('The Pages output directory must be empty.')
}

for (const file of frontendFiles) {
  const sourcePath = path.join(root, file)
  let contents = fs.readFileSync(sourcePath, 'utf8')

  if (file === 'index.html') {
    const metaTag = /<meta name="arcade-api-base" content="[^"]*">/g
    const matches = contents.match(metaTag)
    if (matches?.length !== 1) {
      throw new Error('Expected exactly one arcade-api-base meta tag in index.html.')
    }
    contents = contents.replace(metaTag, `<meta name="arcade-api-base" content="${apiOrigin}">`)
  }

  fs.writeFileSync(path.join(outputDirectory, file), contents)
}

console.log(`Prepared frontend-only Pages artifact at ${outputDirectory}`)
