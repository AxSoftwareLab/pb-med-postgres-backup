import express from 'express'
import crypto from 'node:crypto'
import cron from 'node-cron'
import { config } from './config.js'
import { dumpAndUpload, streamDump, listBackups, getLatestBackupUrl } from './backup.js'
import { cleanOldBackups } from './retention.js'

const app = express()

// El token solo se acepta por `Authorization: Bearer <token>`. La query string nunca autentica,
// ni sola ni junto con otro esquema de cabecera (P2-PB-30).
function authenticate(req, res, next) {
  const header = req.headers.authorization
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!provided) return res.status(401).json({ error: 'Missing token' })

  const expected = Buffer.from(config.secretToken)
  const actual = Buffer.from(provided)

  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(403).json({ error: 'Invalid token' })
  }

  next()
}

// Health público: confirma que el proceso responde. No consulta S3 ni expone datos del bucket.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: config.mode })
})

app.get('/backup', authenticate, (req, res) => {
  streamDump(res)
})

app.post('/backup/trigger', authenticate, async (req, res) => {
  try {
    const result = await dumpAndUpload()
    const cleanup = await cleanOldBackups()
    res.json({ ...result, cleanup })
  } catch (err) {
    console.error('Backup trigger failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/backup/latest', authenticate, async (req, res) => {
  try {
    const result = await getLatestBackupUrl()
    if (!result) return res.status(404).json({ error: 'No backups found' })
    res.redirect(302, result.url)
  } catch (err) {
    console.error('Latest backup failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/backup/list', authenticate, async (req, res) => {
  try {
    const items = await listBackups()
    res.json(items)
  } catch (err) {
    console.error('List backups failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/backup/cleanup', authenticate, async (req, res) => {
  try {
    const result = await cleanOldBackups()
    res.json(result)
  } catch (err) {
    console.error('Cleanup failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

async function runScheduledBackup() {
  console.log(`[cron] Starting scheduled backup at ${new Date().toISOString()}`)
  try {
    const result = await dumpAndUpload()
    const cleanup = await cleanOldBackups()
    console.log(
      `[cron] Backup complete: ${result.key} (${(result.size / 1024 / 1024).toFixed(2)} MB) | cleanup: ${cleanup.deleted} deleted, ${cleanup.remaining} remaining`
    )
  } catch (err) {
    console.error('[cron] Scheduled backup failed:', err.message)
  }
}

/**
 * Devuelve el server http y la tarea de cron para que los tests puedan cerrar
 * ambos; en producción index.js ignora el retorno.
 */
export function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`Backup API listening on port ${server.address().port} (mode: ${config.mode})`)
  })

  let cronTask = null
  if (cron.validate(config.cronSchedule)) {
    cronTask = cron.schedule(config.cronSchedule, runScheduledBackup, {
      timezone: 'America/Bogota',
    })
    console.log(`Cron scheduled: "${config.cronSchedule}" (Medellín / America/Bogota)`)
  } else {
    console.warn(`Invalid CRON_SCHEDULE: "${config.cronSchedule}" — cron disabled`)
  }

  return { server, cronTask }
}
