import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const stage = mkdtempSync(join(tmpdir(), 'deltakit-lambda-'))
const output = resolve('release/deltakit-lambda.zip')
try {
  cpSync('dist', join(stage, 'dist'), { recursive: true })
  cpSync('deploy/lambda.mjs', join(stage, 'index.mjs'))
  mkdirSync('release', { recursive: true })
  // Remove the previous generated archive so deleted assets cannot survive a rebuild.
  rmSync(output, { force: true })
  execFileSync('zip', ['-qr', output, 'index.mjs', 'dist'], { cwd: stage })
  console.log(`Lambda package: ${output}`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
