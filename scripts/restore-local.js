import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeDump } from '../src/dumpFile.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backend = resolve(process.env.PB_RESTORE_BACKEND_DIR || resolve(root, '../b-pb-med'))
const backendNode = process.env.PB_RESTORE_BACKEND_NODE || process.execPath
const runtime = process.env.PB_RESTORE_CONTAINER_RUNTIME || 'podman'
if (!['podman', 'docker'].includes(runtime)) throw new Error('Restore runtime must be podman or docker')
const startedAt = Date.now()
const name = `pbmed-restore-test-${randomBytes(6).toString('hex')}`
const password = randomBytes(18).toString('hex')
const directory = await mkdtemp(join(tmpdir(), 'pbmed-restore-'))
let created = false
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180000, ...options })
  if (result.error || result.status !== 0) {
    // No imprimir entorno, URL ni filas de las bases.
    throw new Error(`${command} failed (${result.status ?? result.error?.code})`)
  }
  return result.stdout.trim()
}
function sql(database, statement) {
  return run(runtime, ['exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'pb_restore', '-d', database, '-Atc', statement])
}
try {
  run(runtime, ['run', '-d', '--name', name, '--label', 'pbmed-purpose=isolated-restore-test',
    '-p', '127.0.0.1::5432', '-e', 'POSTGRES_USER=pb_restore', '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', 'POSTGRES_DB=source', 'docker.io/pgvector/pgvector:pg17'])
  created = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync(runtime, ['exec', name, 'pg_isready', '-U', 'pb_restore', '-d', 'source'], { stdio: 'ignore' })
    if (result.status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error('Local restore database did not become ready')
  const address = run(runtime, ['port', name, '5432/tcp'])
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Restore database is not loopback-only')
  const databaseUrl = database => `postgresql://pb_restore:${password}@${address}/${database}`
  const env = { ...process.env, DATABASE_URL: databaseUrl('source'), NODE_ENV: 'test',
    SEED_DEFAULT_PASSWORD: randomBytes(18).toString('hex') }
  run(backendNode, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: backend, env })
  // La prueba parte del historial completo, pero solo introduce datos sintéticos propios.
  sql('source', "CREATE TABLE restore_probe (id integer PRIMARY KEY, value text NOT NULL CHECK (length(value)>0)); INSERT INTO restore_probe VALUES (1,'synthetic');")
  sql('source', `
    INSERT INTO fields (id,name,slug,location,"googleCalendarId")
      VALUES ('restore-field','Campo sintético','restore-field','Local','synthetic-calendar');
    INSERT INTO users (id,name,role,"staffRole","assignedFieldId","allowedFieldIds","updatedAt")
      VALUES ('restore-manager','Operador sintético','FIELD_STAFF','MANAGER','restore-field',ARRAY['restore-field'],CURRENT_TIMESTAMP);
    INSERT INTO field_day_sessions (id,"fieldId",date,"managerId","inventoryLoaded","initialInventory")
      VALUES ('restore-day','restore-field','2026-09-06','restore-manager',true,'{"restore-item":10}');
    INSERT INTO field_inventories (id,"fieldId","itemName",unit,"currentStock","updatedAt")
      VALUES ('restore-item','restore-field','Bolas sintéticas','cajas',13,CURRENT_TIMESTAMP);
    INSERT INTO inventory_movements (id,"inventoryId",type,quantity,"userId","fieldDaySessionId",reason)
      VALUES ('restore-purchase','restore-item','PURCHASE',10,'restore-manager','restore-day','Saldo inicial sintético'),
             ('restore-transfer','restore-item','TRANSFER',5,'restore-manager','restore-day','Envío sintético'),
             ('restore-return','restore-item','TRANSFER',-2,'restore-manager','restore-day','Devolución sintética');
  `)
  const dumpFile = join(directory, 'database.dump')
  await writeDump('postgresql:///source?user=pb_restore', dumpFile, {
    spawnProcess: (_command, args) => spawn(runtime, ['exec', name, 'pg_dump', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }),
  })
  run(runtime, ['cp', dumpFile, `${name}:/tmp/restore-test.dump`])
  const inventory = run(runtime, ['exec', name, 'pg_restore', '--list', '/tmp/restore-test.dump'])
  if (!inventory.includes('campaign_contact_consents') || !inventory.includes('restore_probe')) throw new Error('Dump inventory missing required tables')
  sql('postgres', 'CREATE DATABASE restored')
  run(runtime, ['exec', name, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-U', 'pb_restore', '-d', 'restored', '/tmp/restore-test.dump'])
  const restoredEnv = { ...env, DATABASE_URL: databaseUrl('restored') }
  run(backendNode, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: backend, env: restoredEnv })
  run(backendNode, ['scripts/campaigns-backup-restore-check.js'], { cwd: backend, env: restoredEnv })
  const queries = {
    tables: "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    triggers: "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal",
    migrations: 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL',
    syntheticRows: 'SELECT count(*) FROM restore_probe',
  }
  const counts = {}
  for (const [key, query] of Object.entries(queries)) {
    const source = Number(sql('source', query))
    const restored = Number(sql('restored', query))
    if (!Number.isSafeInteger(source) || source !== restored) throw new Error(`Restore count mismatch: ${key}`)
    counts[key] = restored
  }
  const operationalQueries = {
    field: "SELECT to_jsonb(f)::text FROM fields f WHERE id='restore-field'",
    manager: "SELECT to_jsonb(u)::text FROM users u WHERE id='restore-manager'",
    day: "SELECT to_jsonb(d)::text FROM field_day_sessions d WHERE id='restore-day'",
    inventory: "SELECT to_jsonb(i)::text FROM field_inventories i WHERE id='restore-item'",
    movements: "SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM inventory_movements m WHERE \"inventoryId\"='restore-item'",
  }
  for (const [key, query] of Object.entries(operationalQueries)) {
    const source = sql('source', query)
    if (!source || source !== sql('restored', query)) throw new Error(`Restored operational data mismatch: ${key}`)
  }
  const stock = sql('restored', `SELECT i."currentStock" = 13 AND sum(m.quantity) = 13 AND count(*) = 3
    FROM field_inventories i JOIN inventory_movements m ON m."inventoryId"=i.id
    WHERE i.id='restore-item' GROUP BY i.id`)
  if (stock !== 't') throw new Error('Restored stock does not reconcile with its movements')
  sql('restored', `DO $$ BEGIN
    BEGIN
      INSERT INTO field_inventories (id,"fieldId","itemName",unit,"updatedAt")
        VALUES ('invalid-restore-item','missing-field','Invalid','cajas',CURRENT_TIMESTAMP);
      RAISE EXCEPTION 'inventory field foreign key missing';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  END $$;`)
  sql('restored', `DO $$ BEGIN
    BEGIN INSERT INTO restore_probe VALUES (1,'duplicate'); RAISE EXCEPTION 'primary key missing'; EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN INSERT INTO restore_probe VALUES (2,''); RAISE EXCEPTION 'check missing'; EXCEPTION WHEN check_violation THEN NULL; END;
  END $$;`)
  const report = { status: 'passed', postgresMajor: 17, format: 'custom', counts,
    containerRuntime: runtime, durationMs: Date.now() - startedAt,
    migrationReplay: 'passed', campaignsCheck: 'passed', constraints: 'passed',
    operationalData: 'passed', operationalEntities: Object.keys(operationalQueries), inventoryStock: 13, inventoryMovements: 3,
    scope: 'Disposable local databases; synthetic data only; no production recovery claimed' }
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2))
  if (process.env.PB_RESTORE_REPORT_PATH) {
    await writeFile(resolve(process.env.PB_RESTORE_REPORT_PATH), JSON.stringify(report, null, 2), { mode: 0o600 })
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  try {
    if (created) run(runtime, ['rm', '-f', '-v', name])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
