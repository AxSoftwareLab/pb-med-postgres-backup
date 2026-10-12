// P2-PB-30 (PAINTBALLM-148): el token solo se acepta por cabecera Bearer y /health público no
// consulta S3 ni expone datos del bucket.
// Entorno sintético forzado con `=` antes de importar src/server.js: DATABASE_URL apunta a
// 127.0.0.1:1 (conexión rechazada, pg_dump no toca ninguna base), S3_ENDPOINT=http://s3.invalid y
// S3 simulado sobre S3Client.prototype.send. Todas las peticiones usan redirect: 'manual' y
// ninguna sigue ni imprime la URL firmada. Los archivos temporales van a un TMPDIR propio.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

const TOKEN = 'p2-pb-30-token-sintetico-solo-prueba'
const systemTmp = os.tmpdir()
const dumpsIn = (dir) => readdirSync(dir).filter((f) => /^pg-backup-.*\.dump$/.test(f))
const systemDumpsBefore = new Set(dumpsIn(systemTmp))
const suiteTmp = mkdtempSync(join(systemTmp, 'pb-backup-test-'))

process.env.TMPDIR = suiteTmp
process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:1/none'
process.env.AWS_ACCESS_KEY_ID = 'synthetic-access-key'
process.env.AWS_SECRET_ACCESS_KEY = 'synthetic-secret-key'
process.env.S3_BUCKET = 'synthetic-bucket'
process.env.S3_ENDPOINT = 'http://s3.invalid'
process.env.MODE = 'server'
process.env.SECRET_TOKEN = TOKEN
process.env.PORT = '0'

const { S3Client } = await import('@aws-sdk/client-s3')

const LISTING = [
  {
    Key: 'postgres/backup-2026-10-12T07-00-00-000Z.dump',
    Size: 1048576,
    LastModified: new Date(Date.now() - 3600_000),
  },
]
let s3Mode = 'ok'
const send = mock.method(S3Client.prototype, 'send', async (command) => {
  if (s3Mode === 'error') throw new Error('bucket caído (simulado)')
  if (command?.constructor?.name === 'ListObjectsV2Command') return { Contents: LISTING }
  return {}
})

const { startServer } = await import('../src/server.js')
const { server, cronTask } = startServer()
await new Promise((resolve) => server.once('listening', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`

test.after(async () => {
  await cronTask?.destroy?.()
  await new Promise((resolve) => server.close(resolve))
  mock.restoreAll()
  rmSync(suiteTmp, { recursive: true, force: true })
})

const ROUTES = [
  ['GET', '/backup'],
  ['POST', '/backup/trigger'],
  ['GET', '/backup/latest'],
  ['GET', '/backup/list'],
  ['DELETE', '/backup/cleanup'],
]

function call(method, route, { authorization, queryToken } = {}) {
  const url = new URL(route, baseUrl)
  if (queryToken !== undefined) url.searchParams.set('token', queryToken)
  return fetch(url, {
    method,
    headers: authorization ? { authorization } : {},
    redirect: 'manual',
  })
}

function resetS3(mode = 'ok') {
  s3Mode = mode
  send.mock.resetCalls()
}

test('CA-1: con el token válido solo en ?token= las 5 rutas responden 401 y S3 no se consulta', async () => {
  resetS3()
  for (const [method, route] of ROUTES) {
    const res = await call(method, route, { queryToken: TOKEN })
    assert.equal(res.status, 401, `${method} ${route}?token= debería exigir la cabecera Bearer`)
    assert.deepEqual(await res.json(), { error: 'Missing token' })
  }
  assert.equal(send.mock.callCount(), 0)
})

test('CA-1: otro esquema (Token o Basic) junto con ?token= válido responde 401', async () => {
  resetS3()
  const basic = `Basic ${Buffer.from(`user:${TOKEN}`).toString('base64')}`
  for (const [method, route] of ROUTES) {
    for (const authorization of [`Token ${TOKEN}`, basic]) {
      const res = await call(method, route, { authorization, queryToken: TOKEN })
      assert.equal(res.status, 401, `${method} ${route} con ${authorization.split(' ')[0]}`)
      assert.deepEqual(await res.json(), { error: 'Missing token' })
    }
  }
  assert.equal(send.mock.callCount(), 0)
})

test('CA-2: Bearer inválido junto con ?token= válido responde 403', async () => {
  resetS3()
  const sameLength = `${'x'.repeat(TOKEN.length - 1)}y`
  for (const [method, route] of ROUTES) {
    for (const bad of ['corto', sameLength]) {
      const res = await call(method, route, { authorization: `Bearer ${bad}`, queryToken: TOKEN })
      assert.equal(res.status, 403, `${method} ${route}`)
      assert.deepEqual(await res.json(), { error: 'Invalid token' })
    }
  }
  assert.equal(send.mock.callCount(), 0)
})

test('CA-2: otro esquema sin query responde 401', async () => {
  for (const authorization of [`Token ${TOKEN}`, `Basic ${TOKEN}`]) {
    const res = await call('GET', '/backup/list', { authorization })
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'Missing token' })
  }
})

test('CA-2: Bearer válido pasa el middleware con o sin ?token=', async () => {
  resetS3()
  const bearer = `Bearer ${TOKEN}`
  const expected = LISTING.map((o) => ({
    key: o.Key,
    size: o.Size,
    lastModified: o.LastModified.toISOString(),
  }))
  for (const queryToken of [undefined, TOKEN, 'otro']) {
    const list = await call('GET', '/backup/list', { authorization: bearer, queryToken })
    assert.equal(list.status, 200)
    assert.deepEqual(await list.json(), expected)
  }

  const latest = await call('GET', '/backup/latest', { authorization: bearer })
  assert.equal(latest.status, 302)
  const location = latest.headers.get('location')
  assert.ok(new URL(location).hostname.endsWith('s3.invalid'), 'el host es el S3_ENDPOINT sintético')

  const cleanup = await call('DELETE', '/backup/cleanup', { authorization: bearer })
  assert.equal(cleanup.status, 200)
  assert.equal((await cleanup.json()).deleted, 0)

  // pg_dump falla a propósito contra 127.0.0.1:1 (o no existe): 200 vacío o 500, nunca 401/403.
  for (const [method, route] of [
    ['GET', '/backup'],
    ['POST', '/backup/trigger'],
  ]) {
    const res = await call(method, route, { authorization: bearer })
    await res.arrayBuffer()
    assert.ok(![401, 403].includes(res.status), `${method} ${route}: ${res.status}`)
  }
})

test('CA-3: /health sin token responde solo {status, mode} y no consulta S3', async () => {
  resetS3('ok')
  const res = await call('GET', '/health')
  assert.deepEqual(
    { status: res.status, body: await res.json(), s3Calls: send.mock.callCount() },
    { status: 200, body: { status: 'ok', mode: 'server' }, s3Calls: 0 }
  )
})

test('CA-3: /health con S3 caído responde el mismo cuerpo, sin campos del bucket', async () => {
  resetS3('error')
  const res = await call('GET', '/health')
  assert.deepEqual(
    { status: res.status, body: await res.json(), s3Calls: send.mock.callCount() },
    { status: 200, body: { status: 'ok', mode: 'server' }, s3Calls: 0 }
  )
  resetS3('ok')
})

test('CA-4: la suite no deja /tmp/pg-backup-*.dump fuera de su TMPDIR propio', () => {
  const leaked = dumpsIn(systemTmp).filter((f) => !systemDumpsBefore.has(f))
  assert.deepEqual(leaked, [])
})
