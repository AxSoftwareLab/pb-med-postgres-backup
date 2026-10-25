Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  AWS_ACCESS_KEY_ID: 'test-access-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'pb-med-backups-test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_REGION: 'us-east-1',
  SECRET_TOKEN: 'test-secret-token-de-16',
  PORT: '0',
  MODE: 'server',
  BACKUP_RETENTION_DAYS: '30',
  BACKUP_FILE_PREFIX: 'backup',
  BUCKET_SUBFOLDER: 'postgres/',
})
