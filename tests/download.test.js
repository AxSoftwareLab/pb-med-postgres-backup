import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
await import('./helpers/env.js')
const { streamDump } = await import('../src/backup.js')

async function fixture(t, script) {
  const directory = await mkdtemp(join(tmpdir(), 'pb-download-test-'))
  await writeFile(join(directory, 'pg_dump'), `#!${process.execPath}\n${script}\n`, { mode: 0o700 })
  const previousPath = process.env.PATH
  process.env.PATH = `${directory}:${previousPath}`
  const app = express()
  app.get('/dump', (_req, res) => streamDump(res))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    process.env.PATH = previousPath
    await rm(directory, { recursive: true, force: true })
  })
  return `http://127.0.0.1:${server.address().port}/dump`
}

test('descarga completa conserva bytes y cabeceras', async (t) => {
  const url = await fixture(t, "process.stdout.write('complete dump')")
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition'), /attachment; filename=.*\.dump/)
  assert.equal(await response.text(), 'complete dump')
})

test('fallo antes de generar datos devuelve 500 JSON', async (t) => {
  const url = await fixture(t, 'process.exitCode=2')
  const response = await fetch(url)
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('content-disposition'), null)
  assert.deepEqual(await response.json(), { error: 'pg_dump failed' })
})

test('stdout termina antes de fallo tardío: el cliente detecta descarga incompleta', async (t) => {
  const url = await fixture(t, "process.stdout.end('partial dump'); setTimeout(()=>process.exit(2), 100)")
  await assert.rejects(async () => {
    const response = await fetch(url)
    await response.arrayBuffer()
  })
})
