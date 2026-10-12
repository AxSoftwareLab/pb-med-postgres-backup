# pb-med-postgres-backup — CLAUDE.md

## Proyecto
Microservicio de backups PostgreSQL para Paintball Medellín. Genera dumps en formato custom (`pg_dump -Fc`) de la DB de producción, los sube a un Railway Bucket S3 y expone una API HTTP autenticada para gestión y descarga.

## Stack
- **Runtime:** Node.js 24 (JavaScript puro, ES modules `"type": "module"`)
- **Framework:** Express 4.21
- **Storage:** AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
- **Cron:** node-cron 4.5 (backup semanal interno)
- **Dump:** pg_dump 17 (PostgreSQL client, vía Alpine `postgresql17-client`)
- **Auth:** Bearer token con `crypto.timingSafeEqual`
- **Container:** Docker multi-stage (Alpine)
- **Deploy:** Railway (Dockerfile builder)

## Arquitectura
```
Request → Express → authenticate (Bearer token) → Handler → pg_dump / S3
node-cron (0 7 * * 1) → dumpAndUpload() → cleanOldBackups()
```
- Sin TypeScript, sin Redis, sin base de datos propia
- Un solo servicio con API HTTP + cron interno
- Storage en Railway Bucket S3-compatible (`pb-med-backups`)

## Comandos
```bash
npm start    # node src/index.js (producción)
npm run dev  # node --watch src/index.js (desarrollo)
```

## Estructura
```
src/
├── index.js      # Entry point: detecta MODE (cron/server)
├── config.js     # Validación de env vars, exports config object
├── server.js     # Express app, 6 endpoints, cron schedule
├── backup.js     # pg_dump spawn, upload S3, stream, list, presigned URLs
└── retention.js  # Cleanup de backups expirados
Dockerfile        # Multi-stage Alpine con postgresql17-client
railway.toml      # Builder DOCKERFILE + startCommand
```

## Modos de operación
- **`MODE=server`** (default): Express API + cron interno (`node-cron`). El servicio corre 24/7.
- **`MODE=cron`**: Ejecuta un backup + cleanup y termina (`process.exit`). Para Railway native cron.

## Cron schedule
- Default: `0 7 * * 1` = cada lunes 7:00 UTC = 2:00 AM Colombia
- Configurable vía `CRON_SCHEDULE`
- Timezone: Medellín / Colombia (`America/Bogota` — IANA oficial)

## Formato de backup
- `pg_dump -Fc` (formato custom de PostgreSQL, no texto plano)
- Extensión: `.dump`
- Restaurar con: `pg_restore -d <url> --no-owner --no-acl --clean --if-exists file.dump`

## S3 Key format
```
{BUCKET_SUBFOLDER}{BACKUP_FILE_PREFIX}-{ISO-timestamp}.dump
```
Ejemplo: `postgres/pb-med-prod-2026-07-04T17-30-07-044Z.dump`

## Infraestructura Railway
- **Proyecto:** Paintball medellin dev (`8e27007c-d304-403f-b37c-1d81eda9f029`)
- **Servicio:** pb-med-postgres-backup (`9d2d0b8c-713b-4e35-b493-078ee53c4a2e`)
- **Bucket:** pb-med-backups
- **DB referencia:** Postgres (servicio en el mismo proyecto, conectado vía `DATABASE_URL` reference variable)
- **Dominio:** `pb-med-postgres-backup-production.up.railway.app`
- **Repo:** `PaintBall-Med/pb-med-postgres-backup`

## Variables de entorno requeridas
- `DATABASE_URL` — URL de PostgreSQL (referencia a Postgres del proyecto)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — Credenciales del bucket
- `S3_BUCKET` — Nombre del bucket (`pb-med-backups`)
- `SECRET_TOKEN` — Token Bearer para autenticación API
- `S3_ENDPOINT` — `https://storage.railway.app`

## Convenciones de código
- JavaScript puro ES modules (`import/export`)
- Sin semicolons, single quotes (Prettier defaults)
- Funciones exportadas individualmente (no clases)
- Logs con `console.log` / `console.error` (servicio simple, sin Pino)
- Timezone: Medellín / Colombia (`America/Bogota` — IANA oficial)

## Retención
- Default: 30 días (`BACKUP_RETENTION_DAYS`)
- Cleanup automático después de cada backup (cron o trigger manual)
- Cleanup manual vía `DELETE /backup/cleanup`
