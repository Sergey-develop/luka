import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const host = '127.0.0.1'
const port = 4173
const root = fileURLToPath(new URL('../dist/', import.meta.url))
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

try {
  const index = await stat(resolve(root, 'index.html'))
  if (!index.isFile()) throw new Error('No index')
} catch {
  console.error('[CoinW kiosk] Run npm run build before starting the kiosk server')
  process.exit(1)
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname)
  } catch {
    response.writeHead(400).end()
    return
  }

  const file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname)
  const location = relative(root, file)
  if (location === '..' || location.startsWith('..' + sep) || isAbsolute(location)) {
    response.writeHead(404).end()
    return
  }

  try {
    const entry = await stat(file)
    if (!entry.isFile()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': entry.size,
      'Cache-Control': location.startsWith('assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(file).on('error', () => response.destroy()).pipe(response)
  } catch {
    response.writeHead(404).end()
  }
})

server.on('error', error => {
  console.error('[CoinW kiosk] Server failed:', error.message)
  process.exitCode = 1
})

server.listen(port, host, () => console.info(`[CoinW kiosk] http://${host}:${port}/`))
