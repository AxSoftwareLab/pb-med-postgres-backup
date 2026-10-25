# pb-med-postgres-backup

Microservicio de backups PostgreSQL para Paintball Medellín. Genera dumps en formato custom (`pg_dump -Fc`) de la base de datos de producción, los sube a un Railway Bucket (S3) y expone una API HTTP autenticada para descarga y gestión.

## Arquitectura

```
node-cron (lunes 2AM COT)
        │
        ▼
  ┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
  │  pg_dump -Fc  │────▶│  Upload S3   │────▶│ Railway Bucket  │
  │  (PostgreSQL) │     │  (AWS SDK)   │     │ pb-med-backups  │
  └──────────────┘     └──────────────┘     └─────────────────┘
                                                     │
  ┌──────────────┐                                   │
  │  Express API  │◀──── Bearer token auth ──────────┘
  │  /backup/*    │      (presigned URLs 1h)
  └──────────────┘
```

- **Cron interno**: `node-cron` ejecuta backup + cleanup cada lunes a las 7:00 AM Colombia (12:00 UTC)
- **API HTTP**: Express con autenticación Bearer token para descargas bajo demanda
- **Storage**: Railway Bucket S3-compatible (`pb-med-backups`)
- **Retención**: 30 días por defecto, limpieza automática post-backup

## Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/health` | No | Status del servicio y estadísticas de backups |
| GET | `/backup` | Bearer | Stream directo de `pg_dump` (descarga en tiempo real) |
| POST | `/backup/trigger` | Bearer | Genera backup, sube al bucket y ejecuta cleanup |
| GET | `/backup/latest` | Bearer | Redirect 302 a presigned URL del último backup (1h) |
| GET | `/backup/list` | Bearer | JSON con todos los backups disponibles |
| DELETE | `/backup/cleanup` | Bearer | Fuerza limpieza de backups expirados |

## Uso

```bash
# Trigger backup manual
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup/trigger

# Descargar último backup
curl -L -H "Authorization: Bearer $TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup/latest \
  -o latest.dump

# Stream directo de pg_dump
curl -H "Authorization: Bearer $TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup \
  -o backup.dump

# Listar backups disponibles
curl -H "Authorization: Bearer $TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup/list

# Health check
curl https://pb-med-postgres-backup-production.up.railway.app/health
```

## Restaurar backup

```bash
# Restaurar en una base de datos local
pg_restore -d "postgresql://user:pass@localhost:5432/pb_local" \
  --no-owner --no-acl --clean --if-exists latest.dump

# Solo ver el contenido (sin restaurar)
pg_restore -l latest.dump
```

## Variables de entorno

| Variable | Requerida | Default | Descripción |
|----------|-----------|---------|-------------|
| `DATABASE_URL` | Si | — | URL de conexión PostgreSQL |
| `AWS_ACCESS_KEY_ID` | Si | — | Credenciales del bucket S3 |
| `AWS_SECRET_ACCESS_KEY` | Si | — | Credenciales del bucket S3 |
| `S3_BUCKET` | Si | — | Nombre del bucket |
| `SECRET_TOKEN` | Si (server) | — | Token Bearer para autenticación |
| `S3_ENDPOINT` | No | — | Endpoint S3 (Railway: `https://storage.railway.app`) |
| `S3_REGION` | No | `auto` | Región del bucket |
| `MODE` | No | `server` | `server` (API + cron interno) o `cron` (one-shot) |
| `PORT` | No | `3000` | Puerto del servidor Express |
| `CRON_SCHEDULE` | No | `0 7 * * 1` | Expresión cron (default: lunes 07:00 COT / 12:00 UTC) |
| `BACKUP_FILE_PREFIX` | No | `backup` | Prefijo de los archivos en S3 |
| `BUCKET_SUBFOLDER` | No | `postgres/` | Carpeta dentro del bucket |
| `BACKUP_RETENTION_DAYS` | No | `30` | Días antes de eliminar backups antiguos |

## Deploy en Railway

1. Crear bucket `pb-med-backups` en el proyecto Railway
2. Crear servicio desde el repo `PaintBall-Med/pb-med-postgres-backup`
3. Configurar variables de entorno (ver tabla arriba)
4. El Dockerfile usa `pg_dump` v17 (debe coincidir con la versión de PostgreSQL en producción)
5. Generar dominio público para acceso a la API

## Desarrollo local

```bash
npm install
cp .env.example .env   # Llenar con valores reales
npm run dev             # Inicia con --watch
```

## Stack

- Node.js 24 (ES modules)
- Express 4.21
- AWS SDK v3 (S3)
- node-cron 4.5
- pg_dump 17 (vía Alpine `postgresql17-client`)
- Docker multi-stage (Alpine)

## Jira

Epic: [SCRUM-318](https://paintballmedellin.atlassian.net/browse/SCRUM-318) (Finalizado)

<!-- Push connectivity check from paintball workstation: 2026-08-09 -->

## Verificación aislada en DEV

- `npm test`: autenticación, configuración, paginación, retención, escritura y subida usando S3 simulado y procesos sintéticos. No necesita credenciales reales ni PostgreSQL.
- `npm run test:restore:local`: requiere Podman (o Docker con `PB_RESTORE_CONTAINER_RUNTIME=docker`), la imagen `docker.io/pgvector/pgvector:pg17` y el checkout vecino `b-pb-med` con dependencias instaladas. Crea dos bases desechables, aplica todo el historial de migraciones, genera un dump custom con el helper del servicio, restaura y ejecuta el checker Campaigns. Compara conteos de tablas, triggers y migraciones, filas completas de campo/operador/jornada/inventario/movimientos y conciliación de stock. Comprueba restricciones con datos sintéticos. Elimina su propio contenedor y temporales al terminar. No restaura ni altera bases existentes.

El simulacro local acredita compatibilidad del dump y del esquema; no acredita recuperación de datos de producción. La descarga directa y la disponibilidad del almacenamiento requieren sus propias verificaciones operativas.


### Restauración obligatoria en CI

El job `restore` descarga `PaintBall-Med/b-pb-med` desde `dev`, registra su commit y ejecuta el mismo simulacro con Docker y PostgreSQL 17. Usa la versión de Node definida por cada repositorio: migraciones y checker con el runtime del backend, dump y orquestación con el del backup. El informe JSON y el commit del backend quedan en el artefacto `postgres-restore-evidence` durante 14 días. No se suben dumps, credenciales ni filas de datos.

Antes de publicar este workflow, configurar en el repositorio de backup el secreto `BACKUP_RESTORE_BACKEND_TOKEN`: token de acceso fino, limitado a `PaintBall-Med/b-pb-med` y permiso **Contents: read**, con autorización de la organización si aplica. Se utiliza solo para checkout y no se conserva en la configuración Git. Si falta, el job falla con una explicación; la restauración no se omite silenciosamente. No necesita secretos de Railway, de PostgreSQL remoto ni de S3.

La evidencia se refiere a los dos commits descargados en esa ejecución. Un cambio posterior del backend exige una nueva ejecución; este workflow todavía no dispara pruebas desde el otro repositorio automáticamente.

Opciones del ejecutor local:

- `PB_RESTORE_CONTAINER_RUNTIME`: `podman` (predeterminado) o `docker`.
- `PB_RESTORE_BACKEND_DIR`: ruta del backend; por defecto el checkout vecino `../b-pb-med`.
- `PB_RESTORE_BACKEND_NODE`: ejecutable Node del backend; por defecto el mismo que inicia el simulacro.
- `PB_RESTORE_REPORT_PATH`: archivo opcional donde conservar el resultado JSON; su carpeta debe existir. Los temporales y el contenedor propios se eliminan igualmente.

El informe mide el tiempo del simulacro hasta completar las verificaciones. No representa un RTO de producción ni demuestra todavía recuperación de reservas, membresías o pagos reales.
