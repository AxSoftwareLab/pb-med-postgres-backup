import test from 'node:test'
import assert from 'node:assert/strict'
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { listAllObjects } from '../src/s3Objects.js'
await import('./helpers/env.js')
const { listBackups } = await import('../src/backup.js')
const { getBackupStats, cleanOldBackups } = await import('../src/retention.js')

const old = { Key: 'postgres/backup-old.dump', Size: 100, LastModified: new Date('2000-01-01') }
const fresh = { Key: 'postgres/backup-new.dump', Size: 200, LastModified: new Date() }

test('listado, estadísticas y retención incluyen todas las páginas', async (t) => {
  const deleted = []
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    if (command instanceof DeleteObjectCommand) { deleted.push(command.input.Key); return {} }
    assert.ok(command instanceof ListObjectsV2Command)
    return command.input.ContinuationToken
      ? { Contents: [fresh], IsTruncated: false }
      : { Contents: [old], IsTruncated: true, NextContinuationToken: 'page2' }
  })
  assert.deepEqual((await listBackups()).map(x => x.key), [fresh.Key, old.Key])
  const stats = await getBackupStats()
  assert.equal(stats.totalBackups, 2)
  assert.deepEqual(stats.newestBackup, fresh.LastModified)
  assert.deepEqual(await cleanOldBackups(), { deleted: 1, remaining: 1, freedBytes: 100 })
  assert.deepEqual(deleted, [old.Key])
})

test('fallo en una página posterior no permite borrar ningún objeto', async (t) => {
  let deleted = 0
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    if (command instanceof DeleteObjectCommand) { deleted++; return {} }
    if (command.input.ContinuationToken) throw new Error('storage unavailable')
    return { Contents: [old], IsTruncated: true, NextContinuationToken: 'page2' }
  })
  await assert.rejects(cleanOldBackups, /storage unavailable/)
  assert.equal(deleted, 0)
})

test('página vacía con continuación no termina prematuramente', async () => {
  let calls = 0
  const client = { send: async () => ++calls === 1
    ? { IsTruncated: true, NextContinuationToken: 'next' }
    : { Contents: [fresh] } }
  assert.deepEqual(await listAllObjects(client, {}), [fresh])
  assert.equal(calls, 2)
})

test('rechaza cursores ausentes o repetidos', async () => {
  for (const token of [undefined, '', 'repeat']) {
    const client = { send: async () => ({ IsTruncated: true, NextContinuationToken: token }) }
    await assert.rejects(listAllObjects(client, {}), /invalid continuation token/)
  }
})
