import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
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

  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: config.s3.bucket,
      Prefix: prefix,
    })
  )

  const allObjects = result.Contents || []
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
