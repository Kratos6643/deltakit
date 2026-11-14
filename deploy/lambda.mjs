import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./dist/', import.meta.url))
const pages = new Set(['/', '/compare', '/convert', '/decode', '/lists', '/help'])
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// Serves the built app through a Lambda Function URL; comparison stays in the browser.
export async function handler(event) {
  const method = event.requestContext?.http?.method ?? 'GET'
  const headers = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
  if (method !== 'GET' && method !== 'HEAD') {
    return { statusCode: 405, headers: { ...headers, allow: 'GET, HEAD' }, body: 'Method not allowed' }
  }

  let path
  try {
    path = decodeURIComponent(event.rawPath ?? '/')
  } catch {
    return { statusCode: 400, headers, body: 'Invalid path' }
  }
  const file = resolve(root, `.${pages.has(path) ? '/index.html' : path}`)
  if (!file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    return { statusCode: 404, headers, body: 'Not found' }
  }

  try {
    const bytes = await readFile(file)
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'content-type': types[extname(file)] ?? 'application/octet-stream',
        'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      },
      isBase64Encoded: method !== 'HEAD',
      body: method === 'HEAD' ? '' : bytes.toString('base64'),
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') {
      return { statusCode: 404, headers, body: 'Not found' }
    }
    throw error
  }
}
