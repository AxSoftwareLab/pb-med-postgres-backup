import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { writeDump } from '../src/dumpFile.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pb-dump-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'dump')
}
function child(script) {
  return (_command, args, options) => {
    assert.deepEqual(args, ['postgresql://synthetic', '--no-password', '-Fc'])
    return spawn(process.execPath, ['-e', script], options)
  }
}

test('espera el cierre del archivo aunque pg_dump ya haya terminado', async (t) => {
  const file = await fixture(t)
  await writeDump('postgresql://synthetic', file, {
    spawnProcess: child("process.stdout.write('complete dump')"),
    createOutput: (path) => new Writable({
      write(chunk, _encoding, callback) {
        setTimeout(() => { appendFileSync(path, chunk); callback() }, 80)
      },
      final(callback) { setTimeout(() => { appendFileSync(path, '-flushed'); callback() }, 80) },
    }),
  })
  assert.equal(await readFile(file, 'utf8'), 'complete dump-flushed')
})

test('rechaza un dump incompleto aunque stdout cierre normalmente', async (t) => {
  const file = await fixture(t)
  await assert.rejects(writeDump('postgresql://synthetic', file, {
    spawnProcess: child("process.stdout.write('partial'); process.exitCode=2"),
  }), /pg_dump exited 2/)
})

test('error de destino termina el proceso hijo', async (t) => {
  const file = await fixture(t)
  let processHandle
  await assert.rejects(writeDump('postgresql://synthetic', file, {
    spawnProcess: (...args) => {
      processHandle = child("process.stdout.write('bytes'); setInterval(()=>{}, 1000)")(...args)
      return processHandle
    },
    createOutput: () => new Writable({ write(_chunk, _encoding, callback) { callback(new Error('disk full')) } }),
  }), /disk full/)
  assert.ok(processHandle.signalCode || processHandle.exitCode !== null)
})

test('ejecutable ausente falla sin promesas rechazadas pendientes', async (t) => {
  const file = await fixture(t)
  await assert.rejects(writeDump('postgresql://synthetic', file, {
    spawnProcess: (_cmd, _args, options) => spawn('/nonexistent-pb-pg-dump', [], options),
  }), /ENOENT/)
})

test('proceso bloqueado se termina por timeout', async (t) => {
  const file = await fixture(t)
  await assert.rejects(writeDump('postgresql://synthetic', file, {
    spawnProcess: child('setInterval(()=>{}, 1000)'), timeoutMs: 100,
  }), /pg_dump exited/)
})
