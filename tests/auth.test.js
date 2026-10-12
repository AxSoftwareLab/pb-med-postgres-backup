import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

const TOKEN = 'test-secret-token-de-16'

// P2-PB-30: valores sintéticos asignados con `=` (nunca ??=) para que un .env real exportado en la
// shell no se use: DATABASE_URL a 127.0.0.1:1 y S3_ENDPOINT inexistente. TMPDIR propio de la suite.
const suiteTmp = mkdtempSync(join(os.tmpdir(), 'pb-backup-test-'))
process.env.TMPDIR = suiteTmp
process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:1/none'
process.env.AWS_ACCESS_KEY_ID = 'synthetic-access-key'
process.env.AWS_SECRET_ACCESS_KEY = 'synthetic-secret-key'
process.env.S3_BUCKET = 'synthetic-bucket'
process.env.S3_ENDPOINT = 'http://s3.invalid'
process.env.MODE = 'server'
process.env.SECRET_TOKEN = TOKEN
process.env.PORT = '0'

const { startServer } = await import('../src/server.js')

const { server, cronTask } = startServer()
await new Promise((resolve) => server.once('listening', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`

test.after(async () => {
  await cronTask?.destroy?.()
  server.close()
  rmSync(suiteTmp, { recursive: true, force: true })
})

test('/health responde sin token', async () => {
  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, 'ok')
  assert.equal(body.mode, 'server')
})

test('las rutas protegidas rechazan la petición sin token', async () => {
  for (const [method, route] of [
    ['GET', '/backup'],
    ['POST', '/backup/trigger'],
    ['GET', '/backup/latest'],
    ['GET', '/backup/list'],
    ['DELETE', '/backup/cleanup'],
  ]) {
    const res = await fetch(`${baseUrl}${route}`, { method })
    assert.equal(res.status, 401, `${method} ${route} debería exigir token`)
    assert.deepEqual(await res.json(), { error: 'Missing token' })
  }
})

test('rechaza un token de largo distinto sin romper timingSafeEqual', async () => {
  const res = await fetch(`${baseUrl}/backup/list`, {
    headers: { authorization: 'Bearer corto' },
  })
  assert.equal(res.status, 403)
  assert.deepEqual(await res.json(), { error: 'Invalid token' })
})

test('rechaza un token del mismo largo pero distinto', async () => {
  const sameLength = `${'x'.repeat(TOKEN.length - 1)}y`
  assert.equal(sameLength.length, TOKEN.length)
  const res = await fetch(`${baseUrl}/backup/list`, {
    headers: { authorization: `Bearer ${sameLength}` },
  })
  assert.equal(res.status, 403)
})

test('acepta el token válido por cabecera Bearer', async () => {
  // La ruta pega contra S3 (S3_ENDPOINT inexistente) y falla, pero lo que se verifica acá es que el
  // middleware deja pasar: nunca 401 ni 403.
  const viaHeader = await fetch(`${baseUrl}/backup/list`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    redirect: 'manual',
  })
  assert.ok(![401, 403].includes(viaHeader.status), `header rechazado: ${viaHeader.status}`)
})

test('rechaza con 401 el token válido enviado solo por query string', async () => {
  const viaQuery = await fetch(`${baseUrl}/backup/list?token=${encodeURIComponent(TOKEN)}`, {
    redirect: 'manual',
  })
  assert.equal(viaQuery.status, 401)
  assert.deepEqual(await viaQuery.json(), { error: 'Missing token' })
})
