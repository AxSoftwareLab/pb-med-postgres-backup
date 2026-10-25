import assert from 'node:assert/strict'
import test from 'node:test'

const TOKEN = 'test-secret-token-de-16'

await import('./helpers/env.js')
const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3')
S3Client.prototype.send = async function (command) {
  assert.ok(command instanceof ListObjectsV2Command, 'unexpected storage operation')
  return { Contents: [], IsTruncated: false }
}

const { startServer } = await import('../src/server.js')

const { server, cronTask } = startServer({ schedule: false, host: '127.0.0.1' })
await new Promise((resolve) => server.once('listening', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`

test.after(async () => {
  await cronTask?.destroy?.()
  await new Promise((resolve) => server.close(resolve))
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

test('acepta el token válido por header y por query string', async () => {
  const viaHeader = await fetch(`${baseUrl}/backup/list`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  assert.equal(viaHeader.status, 200)
  assert.deepEqual(await viaHeader.json(), [])

  const viaQuery = await fetch(`${baseUrl}/backup/list?token=${encodeURIComponent(TOKEN)}`)
  assert.equal(viaQuery.status, 200)
  assert.deepEqual(await viaQuery.json(), [])
})

test('rechaza tokens query de tipo array u objeto', async () => {
  for (const query of ['token=a&token=b', 'token[x]=a']) {
    const res = await fetch(`${baseUrl}/backup/list?${query}`)
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'Invalid token' })
  }
})
