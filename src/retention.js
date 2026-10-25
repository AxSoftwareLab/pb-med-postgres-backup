import {
  S3Client,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { listAllObjects } from './s3Objects.js'
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

export async function cleanOldBackups() {
  const prefix = `${config.backup.subfolder}${config.backup.filePrefix}`
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - config.backup.retentionDays)

  const allObjects = await listAllObjects(s3, { Bucket: config.s3.bucket, Prefix: prefix })
  const expired = allObjects.filter((obj) => new Date(obj.LastModified) < cutoff)

  let freedBytes = 0
  for (const obj of expired) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: obj.Key }))
    freedBytes += obj.Size || 0
    console.log(`Deleted expired backup: ${obj.Key}`)
  }

  const remaining = allObjects.length - expired.length
  console.log(
    `Retention cleanup: ${expired.length} deleted, ${remaining} remaining` +
      (freedBytes ? ` (freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB)` : '')
  )

  return { deleted: expired.length, remaining, freedBytes }
}

export async function getBackupStats() {
  const prefix = `${config.backup.subfolder}${config.backup.filePrefix}`
  const objects = await listAllObjects(s3, { Bucket: config.s3.bucket, Prefix: prefix })
  if (!objects.length) return { totalBackups: 0, totalSizeMB: 0 }

  const totalSize = objects.reduce((sum, obj) => sum + (obj.Size || 0), 0)
  const sorted = objects.sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified))

  return {
    totalBackups: objects.length,
    totalSizeMB: +(totalSize / 1024 / 1024).toFixed(2),
    oldestBackup: sorted[0]?.LastModified,
    newestBackup: sorted[sorted.length - 1]?.LastModified,
  }
}
