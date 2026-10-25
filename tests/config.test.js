import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const VALID_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AWS_ACCESS_KEY_ID: 'test-access-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'pb-med-backups-test',
  SECRET_TOKEN: 'test-secret-token',
}

/**
 * config.js valida en el import y corta con process.exit(1), así que cada caso
 * se evalúa en un proceso aparte.
 */
async function loadConfig(env, { expectFailure = false } = {}) {
  const script = 'import("./src/config.js").then(({ config }) => console.log(JSON.stringify(config)))'
  try {
    const { stdout } = await execFileAsync(process.execPath, ['-e', script], {
      cwd: root,
      env: { PATH: process.env.PATH, ...env },
    })
    if (expectFailure) assert.fail('se esperaba que config.js abortara')
    return JSON.parse(stdout)
  } catch (error) {
    if (!expectFailure) throw error
    return { failed: true, code: error.code, stderr: String(error.stderr || '') }
  }
}

test('aborta si falta alguna variable obligatoria', async () => {
  for (const key of ['DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET']) {
    const env = { ...VALID_ENV }
    delete env[key]
    const result = await loadConfig(env, { expectFailure: true })
    assert.equal(result.code, 1, `${key} debería abortar el arranque`)
    assert.match(result.stderr, new RegExp(`Missing required env vars: .*${key}`))
  }
})

test('en modo server exige SECRET_TOKEN', async () => {
  const env = { ...VALID_ENV }
  delete env.SECRET_TOKEN
  const result = await loadConfig(env, { expectFailure: true })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /SECRET_TOKEN is required in server mode/)
})

test('en modo cron no exige SECRET_TOKEN', async () => {
  const env = { ...VALID_ENV, MODE: 'cron' }
  delete env.SECRET_TOKEN
  const config = await loadConfig(env)
  assert.equal(config.mode, 'cron')
  assert.equal(config.secretToken, '')
})

test('aplica los valores por defecto documentados', async () => {
  const config = await loadConfig(VALID_ENV)
  assert.equal(config.mode, 'server')
  assert.equal(config.port, 3000)
  // Lunes 07:00 en Medellín = 12:00 UTC
  assert.equal(config.cronSchedule, '0 7 * * 1')
  assert.equal(config.backup.retentionDays, 30)
  assert.equal(config.backup.filePrefix, 'backup')
  assert.equal(config.backup.subfolder, 'postgres/')
  assert.equal(config.s3.region, 'auto')
  assert.equal(config.s3.endpoint, undefined)
})

test('respeta los overrides de entorno', async () => {
  const config = await loadConfig({
    ...VALID_ENV,
    PORT: '8080',
    CRON_SCHEDULE: '30 6 * * 2',
    BACKUP_RETENTION_DAYS: '7',
    BACKUP_FILE_PREFIX: 'pb-med-prod',
    BUCKET_SUBFOLDER: 'dumps/',
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'https://storage.railway.app',
  })
  assert.equal(config.port, 8080)
  assert.equal(config.cronSchedule, '30 6 * * 2')
  assert.equal(config.backup.retentionDays, 7)
  assert.equal(config.backup.filePrefix, 'pb-med-prod')
  assert.equal(config.backup.subfolder, 'dumps/')
  assert.equal(config.s3.region, 'us-east-1')
  assert.equal(config.s3.endpoint, 'https://storage.railway.app')
})

test('el cron por defecto es una expresión válida para node-cron', async () => {
  const { default: cron } = await import('node-cron')
  const config = await loadConfig(VALID_ENV)
  assert.equal(cron.validate(config.cronSchedule), true)
})


test('rechaza retenciones inválidas sin truncar ni reinterpretar valores', async () => {
  for (const value of ['-1', '0', '1.5', '30days', 'NaN', '', ' ', ' 7 ', '9007199254740992']) {
    const result = await loadConfig({ ...VALID_ENV, BACKUP_RETENTION_DAYS: value }, { expectFailure: true })
    assert.equal(result.code, 1, JSON.stringify(value))
    assert.match(result.stderr, /BACKUP_RETENTION_DAYS must be a positive safe integer/)
  }
})
