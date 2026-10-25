const required = ['DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET']

const missing = required.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`)
  process.exit(1)
}

const mode = process.env.MODE || 'server'

if (mode === 'server' && !process.env.SECRET_TOKEN) {
  console.error('SECRET_TOKEN is required in server mode')
  process.exit(1)
}

const retentionValue = process.env.BACKUP_RETENTION_DAYS ?? '30'
const retentionDays = Number(retentionValue)
if (!/^[1-9][0-9]*$/.test(retentionValue) || !Number.isSafeInteger(retentionDays)) {
  console.error('BACKUP_RETENTION_DAYS must be a positive safe integer')
  process.exit(1)
}

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  mode,
  port: parseInt(process.env.PORT || '3000', 10),
  secretToken: process.env.SECRET_TOKEN || '',

  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
  },

  cronSchedule: process.env.CRON_SCHEDULE || '0 7 * * 1',

  backup: {
    filePrefix: process.env.BACKUP_FILE_PREFIX || 'backup',
    subfolder: process.env.BUCKET_SUBFOLDER || 'postgres/',
    retentionDays: retentionDays,
  },
}
