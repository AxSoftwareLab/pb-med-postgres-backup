import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { writeDump } from './dumpFile.js'
import { listAllObjects } from './s3Objects.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from './config.js'

const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  forcePathStyle: false,
})

function buildKey(timestamp) {
  const ts = timestamp.replace(/[:.]/g, '-')
  return `${config.backup.subfolder}${config.backup.filePrefix}-${ts}-${randomUUID()}.dump`
}

export async function dumpAndUpload() {
  const timestamp = new Date().toISOString()
  const key = buildKey(timestamp)
  const directory = await mkdtemp(join(tmpdir(), 'pg-backup-'))
  const tmpFile = join(directory, 'database.dump')
  let body
  try {
    await writeDump(config.databaseUrl, tmpFile)
    const stat = statSync(tmpFile)
    body = createReadStream(tmpFile)
    await s3.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentLength: stat.size,
      ContentType: 'application/octet-stream',
    }))
    console.log(`Backup uploaded: ${key} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`)
    return { key, size: stat.size, timestamp }
  } finally {
    body?.destroy()
    await rm(directory, { recursive: true, force: true })
  }
}

export function streamDump(res) {
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${config.backup.filePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.dump"`
  )

  const pg = spawn('pg_dump', [config.databaseUrl, '--no-password', '-Fc'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // No terminar una respuesta exitosa hasta confirmar la salida de pg_dump.
  pg.stdout.pipe(res, { end: false })
  pg.stderr.resume()
  const timeout = setTimeout(() => pg.kill('SIGKILL'), 10 * 60 * 1000)
  timeout.unref()
  let failed = false
  function fail() {
    if (failed || res.destroyed || res.writableEnded) return
    failed = true
    pg.stdout.unpipe(res)
    if (res.headersSent) {
      res.destroy()
    } else {
      res.removeHeader('Content-Disposition')
      res.status(500).json({ error: 'pg_dump failed' })
    }
  }
  pg.stdout.on('error', fail)
  pg.on('error', fail)
  pg.on('close', (code) => {
    clearTimeout(timeout)
    if (code !== 0) fail()
    else if (!failed && !res.destroyed && !res.writableEnded) res.end()
  })
  res.on('close', () => {
    clearTimeout(timeout)
    if (pg.exitCode == null && pg.signalCode == null) pg.kill('SIGKILL')
  })

}

export async function listBackups() {
  const prefix = `${config.backup.subfolder}${config.backup.filePrefix}`
  const objects = await listAllObjects(s3, { Bucket: config.s3.bucket, Prefix: prefix })
  const items = objects
    .map((obj) => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
    }))
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))

  return items
}

export async function getLatestBackupUrl() {
  const items = await listBackups()
  if (!items.length) return null

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: items[0].key }),
    { expiresIn: 3600 }
  )
  return { url, key: items[0].key, size: items[0].size }
}
