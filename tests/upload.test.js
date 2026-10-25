import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
await import('./helpers/env.js')
const { dumpAndUpload } = await import('../src/backup.js')

async function executable(t, script) {
  const directory = await mkdtemp(join(tmpdir(), 'pb-fake-pg-'))
  await writeFile(join(directory, 'pg_dump'), `#!${process.execPath}\n${script}\n`, { mode: 0o700 })
  const oldPath = process.env.PATH
  process.env.PATH = `${directory}:${oldPath}`
  t.after(async () => { process.env.PATH = oldPath; await rm(directory, { recursive: true, force: true }) })
}

test('sube bytes completos con temporales únicos y los elimina después', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-06T12:00:00.000Z') })
  await executable(t, "process.stdout.write('synthetic-' + process.pid)")
  const paths = []
  const bytes = []
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    assert.ok(command instanceof PutObjectCommand)
    paths.push(command.input.Body.path)
    const parts = []
    for await (const chunk of command.input.Body) parts.push(chunk)
    const body = Buffer.concat(parts)
    assert.equal(body.length, command.input.ContentLength)
    bytes.push(body.toString())
    return {}
  })
  const results = await Promise.all([dumpAndUpload(), dumpAndUpload()])
  assert.equal(new Set(results.map(result => result.key)).size, 2, 'concurrent backups must not overwrite the same storage key')
  assert.equal(new Set(paths).size, 2)
  assert.equal(new Set(bytes).size, 2)
  assert.ok(results.every(result => result.size > 0 && result.key.endsWith('.dump')))
  for (const file of paths) await assert.rejects(access(dirname(file)), { code: 'ENOENT' })
})

test('fallo de subida elimina el archivo temporal y propaga el error', async (t) => {
  await executable(t, "process.stdout.write('complete')")
  let path
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    assert.ok(command instanceof PutObjectCommand)
    path = command.input.Body.path
    throw new Error('synthetic storage rejection')
  })
  await assert.rejects(dumpAndUpload(), /synthetic storage rejection/)
  await assert.rejects(access(dirname(path)), { code: 'ENOENT' })
})

test('fallo de dump no sube archivos ni deja directorios privados', async (t) => {
  await executable(t, "process.stdout.write('partial'); process.exitCode=1")
  let uploads = 0
  t.mock.method(S3Client.prototype, 'send', async () => { uploads++ })
  const before = (await readdir(tmpdir())).filter(name => name.startsWith('pg-backup-')).sort()
  await assert.rejects(dumpAndUpload(), /pg_dump exited 1/)
  assert.equal(uploads, 0)
  const after = (await readdir(tmpdir())).filter(name => name.startsWith('pg-backup-')).sort()
  assert.deepEqual(after, before)
})
