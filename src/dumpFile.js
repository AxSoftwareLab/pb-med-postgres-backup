import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

export async function writeDump(databaseUrl, file, {
  spawnProcess = spawn,
  createOutput = createWriteStream,
  timeoutMs = 10 * 60 * 1000,
} = {}) {
  const pg = spawnProcess('pg_dump', [databaseUrl, '--no-password', '-Fc'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  pg.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192) })
  const finished = new Promise((resolve, reject) => {
    pg.once('error', reject)
    pg.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`pg_dump exited ${code}: ${stderr}`)))
  })
  const timeout = setTimeout(() => pg.kill('SIGKILL'), timeoutMs)
  timeout.unref()
  let copied
  try {
    copied = pipeline(pg.stdout, createOutput(file, { mode: 0o600, flags: 'wx' }))
    await Promise.all([finished, copied])
  } catch (error) {
    if (pg.exitCode == null && pg.signalCode == null) pg.kill('SIGKILL')
    pg.stdout.destroy()
    await Promise.allSettled([finished, copied])
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
